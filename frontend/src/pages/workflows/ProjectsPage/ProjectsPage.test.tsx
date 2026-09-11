import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProjectsPage from "./ProjectsPage";
import { ApiError } from "../../../lib/api/client";
import { createProject, deleteProject, listProjects, updateProject } from "../../../lib/api/projects";

/**
 * PROJ-4 (ADR-0047): moved verbatim out of `OrgHome.test.tsx` — this file's
 * own tests, and the component under test, are byte-for-byte the same
 * PROJ-1/DASH-2/DS-2 behavior, just mounted at the new dedicated route
 * (`/orgs/:orgId/projects` instead of `/orgs/:orgId`) against `ProjectsPage`
 * instead of `OrgHome`. No assertion content changed; only the render
 * helper's route and the imported component did. See `OrgHome.test.tsx` for
 * what's left there (widgets/Members link only, no Project CRUD).
 *
 * Same partial-mock pattern as `Signup.test.tsx`: keep the real module
 * shape, replace only `createProject`/`updateProject`/`deleteProject`/
 * `listProjects` with `vi.fn()`s so the "New Project"/"Edit Project"/
 * delete-confirm modals and the initial list fetch can all be driven
 * without a real network call.
 */
vi.mock("../../../lib/api/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/projects")>();
  return {
    ...actual,
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    listProjects: vi.fn(),
  };
});

const mockCreateProject = vi.mocked(createProject);
const mockUpdateProject = vi.mocked(updateProject);
const mockDeleteProject = vi.mocked(deleteProject);
const mockListProjects = vi.mocked(listProjects);

mockListProjects.mockResolvedValue([]);

const ORG_ID = "11111111-1111-1111-1111-111111111111";

function renderProjectsPage(orgId = ORG_ID) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/orgs/${orgId}/projects`]}>
        <Routes>
          <Route path="/orgs/:orgId/projects" element={<ProjectsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function openNewProjectModal() {
  fireEvent.click(screen.getByRole("button", { name: /^new project$/i }));
}

describe("ProjectsPage — New Project modal", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Projects page with a New Project action and no projects initially", async () => {
    renderProjectsPage();

    expect(screen.getByRole("heading", { name: /^projects$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^new project$/i })).toBeInTheDocument();
    // `listProjects` resolves asynchronously (a real fetch, mocked to `[]`) —
    // the empty state only renders once that settles, not synchronously.
    expect(await screen.findByText(/no projects yet/i)).toBeInTheDocument();
  });

  it("opens the modal with name and standards profile fields", () => {
    renderProjectsPage();
    openNewProjectModal();

    expect(screen.getByRole("heading", { name: /^new project$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/standards profile/i)).toBeInTheDocument();
  });

  it("rejects an empty name client-side, without calling createProject()", async () => {
    renderProjectsPage();
    openNewProjectModal();

    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it("submits with standards_profile omitted when left blank, adds the result to the list, and closes the modal", async () => {
    mockCreateProject.mockResolvedValue({
      id: "proj-1",
      org_id: ORG_ID,
      name: "Checkout Revamp",
      standards_profile: null,
    });
    renderProjectsPage();
    openNewProjectModal();

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Checkout Revamp" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(mockCreateProject).toHaveBeenCalledTimes(1));
    expect(mockCreateProject).toHaveBeenCalledWith(ORG_ID, { name: "Checkout Revamp" });

    expect(await screen.findByText("Checkout Revamp")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^new project$/i })).not.toBeInTheDocument();
  });

  it("renders the full ID/Name/Standards profile/Actions column set (TC-PROJ-019)", async () => {
    mockListProjects.mockResolvedValueOnce([
      { id: "proj-cols", org_id: ORG_ID, name: "Column Check", standards_profile: null },
    ]);
    renderProjectsPage();
    await screen.findByText("Column Check");

    // Name is the default active sort (ascending) — its header carries a "▲"
    // decoration, same as any other sortable-header render; the column
    // *labels* are still exactly this set, decoration aside.
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["ID", "Name ▲", "Standards profile", ""]);
    expect(headers[3]).toHaveAccessibleName("Actions");
  });

  it("submits with standards_profile included when filled in", async () => {
    mockCreateProject.mockResolvedValue({
      id: "proj-2",
      org_id: ORG_ID,
      name: "Payments Migration",
      standards_profile: "ISO-29119",
    });
    renderProjectsPage();
    openNewProjectModal();

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Payments Migration" } });
    fireEvent.change(screen.getByLabelText(/standards profile/i), { target: { value: "ISO-29119" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(mockCreateProject).toHaveBeenCalledTimes(1));
    expect(mockCreateProject).toHaveBeenCalledWith(ORG_ID, {
      name: "Payments Migration",
      standards_profile: "ISO-29119",
    });

    expect(await screen.findByText("Payments Migration")).toBeInTheDocument();
    expect(await screen.findByText("ISO-29119")).toBeInTheDocument();
  });

  it("shows a 422 field_errors.name collision inline on the name field, keeping the modal open", async () => {
    mockCreateProject.mockRejectedValue(
      new ApiError("Validation failed.", 422, {
        code: "validation_error",
        message: "Validation failed.",
        field_errors: { name: "A project with this name already exists in this organization." },
      }),
    );
    renderProjectsPage();
    openNewProjectModal();

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Duplicate" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/already exists in this organization/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^new project$/i })).toBeInTheDocument();
  });

  it("shows a non-field ApiError (e.g. 403 permission_denied) inline as an alert", async () => {
    mockCreateProject.mockRejectedValue(
      new ApiError("You do not have permission to create a project in this organization.", 403, {
        code: "permission_denied",
        message: "You do not have permission to create a project in this organization.",
        field_errors: null,
      }),
    );
    renderProjectsPage();
    openNewProjectModal();

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "New Project X" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/do not have permission/i);
  });

  it("opens an Edit modal pre-filled with the project's name/standards_profile, and saves via updateProject()", async () => {
    mockCreateProject.mockResolvedValue({
      id: "proj-3",
      org_id: ORG_ID,
      name: "Mobile App",
      standards_profile: null,
    });
    mockUpdateProject.mockResolvedValue({
      id: "proj-3",
      org_id: ORG_ID,
      name: "Mobile App v2",
      standards_profile: "IEEE-829",
    });

    renderProjectsPage();
    openNewProjectModal();
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Mobile App" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await screen.findByText("Mobile App");

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByRole("heading", { name: /^edit project$/i })).toBeInTheDocument();
    const nameInputs = screen.getAllByLabelText(/^name$/i);
    const editNameInput = nameInputs[nameInputs.length - 1] as HTMLInputElement;
    expect(editNameInput.value).toBe("Mobile App");

    fireEvent.change(editNameInput, { target: { value: "Mobile App v2" } });
    const profileInputs = screen.getAllByLabelText(/standards profile/i);
    fireEvent.change(profileInputs[profileInputs.length - 1], { target: { value: "IEEE-829" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(mockUpdateProject).toHaveBeenCalledWith("proj-3", {
        name: "Mobile App v2",
        standards_profile: "IEEE-829",
      }),
    );
    expect(await screen.findByText("Mobile App v2")).toBeInTheDocument();
    expect(await screen.findByText("IEEE-829")).toBeInTheDocument();
  });

  /**
   * TC-PROJ-020 gap-fill (coverage audit, 2026-09-09).
   *
   * The test above proves the Edit round trip against a ONE-project fixture,
   * so three clauses of TC-PROJ-020's own literal wording had nothing to
   * assert against: "`PATCH /projects/{id}` called **once**", "modal closes",
   * and — the clause its own `Given` explicitly sets up ("2+ Projects exist,
   * one with a non-null `standards_profile`") — "the other row's values
   * unchanged". A single-row fixture structurally cannot catch a mutation
   * handler that rewrites every row instead of the edited one.
   */
  it("TC-PROJ-020: one PATCH carrying both fields, modal closes, the other row's values unchanged", async () => {
    mockListProjects.mockResolvedValueOnce([
      { id: "proj-edit-1", org_id: ORG_ID, name: "Alpha", standards_profile: "ISO-29119" },
      { id: "proj-edit-2", org_id: ORG_ID, name: "Beta", standards_profile: "IEEE-829" },
    ]);
    mockUpdateProject.mockResolvedValue({
      id: "proj-edit-1",
      org_id: ORG_ID,
      name: "Alpha Renamed",
      standards_profile: "ISTQB-CTFL-v4.0.1",
    });

    renderProjectsPage();
    await screen.findByText("Alpha");

    // Scoped to the target row specifically — with 2 rows there are 2 "Edit"
    // buttons, and an unscoped `getByRole` would be ambiguous.
    const alphaRow = screen.getByRole("row", { name: /Alpha/ });
    fireEvent.click(within(alphaRow).getByRole("button", { name: /^edit$/i }));
    expect(screen.getByRole("heading", { name: /^edit project$/i })).toBeInTheDocument();

    const nameInputs = screen.getAllByLabelText(/^name$/i);
    fireEvent.change(nameInputs[nameInputs.length - 1], { target: { value: "Alpha Renamed" } });
    const profileInputs = screen.getAllByLabelText(/standards profile/i);
    fireEvent.change(profileInputs[profileInputs.length - 1], {
      target: { value: "ISTQB-CTFL-v4.0.1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // ...called ONCE, with both fields in the same body.
    await waitFor(() => expect(mockUpdateProject).toHaveBeenCalledTimes(1));
    expect(mockUpdateProject).toHaveBeenCalledWith("proj-edit-1", {
      name: "Alpha Renamed",
      standards_profile: "ISTQB-CTFL-v4.0.1",
    });

    // ...the modal closes...
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /^edit project$/i })).not.toBeInTheDocument(),
    );

    // ...the edited row shows both new values (and neither old one)...
    expect(await screen.findByText("Alpha Renamed")).toBeInTheDocument();
    expect(screen.getByText("ISTQB-CTFL-v4.0.1")).toBeInTheDocument();
    expect(screen.queryByText("ISO-29119")).not.toBeInTheDocument();

    // ...and the other row is untouched, name and profile both.
    const betaRow = screen.getByRole("row", { name: /Beta/ });
    expect(within(betaRow).getByRole("link", { name: "Beta" })).toBeInTheDocument();
    expect(within(betaRow).getByText("IEEE-829")).toBeInTheDocument();
  });

  it("deletes a project via a confirm modal + deleteProject()", async () => {
    mockCreateProject.mockResolvedValue({
      id: "proj-4",
      org_id: ORG_ID,
      name: "To Delete",
      standards_profile: null,
    });
    mockDeleteProject.mockResolvedValue(undefined);

    renderProjectsPage();
    openNewProjectModal();
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "To Delete" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await screen.findByText("To Delete");

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(screen.getByRole("heading", { name: /^delete project$/i })).toBeInTheDocument();

    const confirmButtons = screen.getAllByRole("button", { name: /^delete$/i });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(mockDeleteProject).toHaveBeenCalledWith("proj-4"));
    await waitFor(() => expect(screen.queryByText("To Delete")).not.toBeInTheDocument());
  });

  /**
   * TC-PROJ-021's negative half.
   *
   * `DELETE /projects/{id}` is gated on `project.delete` (ADR-0022's generic
   * factory), which only `org_admin` holds today — a `test_manager`/
   * `test_engineer` caller gets a `403`. Per the UI Design Document §5, that
   * `403` surfaces as an alert *inside the still-open confirm modal*, and the
   * row must NOT be removed, so the user isn't left wondering whether the
   * delete silently no-op'd.
   */
  it("keeps the confirm modal open with a 403 alert and does NOT remove the row when the caller lacks project.delete", async () => {
    mockListProjects.mockResolvedValueOnce([
      { id: "proj-5", org_id: ORG_ID, name: "Undeletable", standards_profile: null },
    ]);
    mockDeleteProject.mockRejectedValue(
      new ApiError("You do not have permission to delete this project.", 403, {
        code: "permission_denied",
        message: "You do not have permission to delete this project.",
        field_errors: null,
      }),
    );

    renderProjectsPage();
    await screen.findByText("Undeletable");

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(screen.getByRole("heading", { name: /^delete project$/i })).toBeInTheDocument();

    const confirmButtons = screen.getAllByRole("button", { name: /^delete$/i });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(mockDeleteProject).toHaveBeenCalledWith("proj-5"));

    // The 403 surfaces inline as an alert...
    expect(await screen.findByRole("alert")).toHaveTextContent(/do not have permission to delete/i);
    // ...the modal stays open...
    expect(screen.getByRole("heading", { name: /^delete project$/i })).toBeInTheDocument();
    // ...and the row is still in the table. Asserted via the row's own link
    // (not `getByText`): the name deliberately appears twice at this point —
    // once in the surviving table row, once in the still-open modal's "Are you
    // sure you want to delete <name>?" copy — so a bare text query is
    // ambiguous. The link is unique to the table row.
    expect(screen.getByRole("link", { name: "Undeletable" })).toBeInTheDocument();
  });

  /**
   * TC-PROJ-021's positive half, gap-fill (coverage audit, 2026-09-09).
   *
   * The "deletes a project via a confirm modal" test above uses a ONE-project
   * fixture, so TC-PROJ-021's literal "`DELETE /projects/{id}` called for that
   * project's id **only**" and "**the other row remains**" clauses (its own
   * `Given` says "2+ Projects exist") had nothing to assert against — with one
   * row, "the row disappears" and "the whole list was cleared" are the same
   * observable outcome.
   */
  it("TC-PROJ-021 (positive half): deletes only the confirmed row's id, leaving the other row in the table", async () => {
    mockListProjects.mockResolvedValueOnce([
      { id: "proj-del-1", org_id: ORG_ID, name: "Doomed", standards_profile: null },
      { id: "proj-del-2", org_id: ORG_ID, name: "Survivor", standards_profile: null },
    ]);
    mockDeleteProject.mockResolvedValue(undefined);

    renderProjectsPage();
    await screen.findByText("Doomed");

    const doomedRow = screen.getByRole("row", { name: /Doomed/ });
    fireEvent.click(within(doomedRow).getByRole("button", { name: /^delete$/i }));
    expect(screen.getByRole("heading", { name: /^delete project$/i })).toBeInTheDocument();

    // The confirm button is the last "Delete" in DOM order — both modals
    // render after the table in `ProjectsPage`'s own JSX.
    const confirmButtons = screen.getAllByRole("button", { name: /^delete$/i });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(mockDeleteProject).toHaveBeenCalledTimes(1));
    expect(mockDeleteProject).toHaveBeenCalledWith("proj-del-1");

    // Asserted via each row's own link (unique to the table) rather than
    // `getByText`, matching the negative-half test's own reasoning below.
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Doomed" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "Survivor" })).toBeInTheDocument();
  });

  it("filters the list by name via the search box", async () => {
    mockListProjects.mockResolvedValueOnce([
      { id: "proj-a", org_id: ORG_ID, name: "Alpha", standards_profile: null },
      { id: "proj-b", org_id: ORG_ID, name: "Beta", standards_profile: null },
    ]);

    renderProjectsPage();
    await screen.findByText("Alpha");
    expect(screen.getByText("Beta")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/search projects/i), { target: { value: "alp" } });

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });

  /**
   * TC-PROJ-022's second clause, gap-fill (coverage audit, 2026-09-09).
   *
   * The filter test above only covers the "one row matches" case. TC-PROJ-022
   * also requires the DISTINCT zero-match empty state — "No projects match
   * your search." and specifically **not** "No projects yet." (which means
   * something different: the org genuinely has none). `ProjectsPage.tsx`
   * renders both strings from two different branches, and nothing anywhere in
    * `frontend/src/` (Vitest unit specs) or `e2e/tests/` (Playwright specs) asserted the search one until now.
   */
  it("TC-PROJ-022: a zero-match search shows 'No projects match your search.', never 'No projects yet.'", async () => {
    mockListProjects.mockResolvedValueOnce([
      { id: "proj-a", org_id: ORG_ID, name: "Alpha", standards_profile: null },
      { id: "proj-b", org_id: ORG_ID, name: "Beta", standards_profile: null },
    ]);

    renderProjectsPage();
    await screen.findByText("Alpha");

    fireEvent.change(screen.getByLabelText(/search projects/i), { target: { value: "zzz" } });

    expect(screen.getByText("No projects match your search.")).toBeInTheDocument();
    expect(screen.queryByText(/no projects yet/i)).not.toBeInTheDocument();
    // The table itself is replaced by the empty state, not left rendered empty.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    // Clearing the search restores the full list — proves the empty state is
    // filter-driven, not a terminal state the component gets stuck in.
    fireEvent.change(screen.getByLabelText(/search projects/i), { target: { value: "" } });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("sorts by Name descending on header click, toggling back to ascending on a second click", async () => {
    mockListProjects.mockResolvedValueOnce([
      { id: "proj-a", org_id: ORG_ID, name: "Alpha", standards_profile: null },
      { id: "proj-b", org_id: ORG_ID, name: "Beta", standards_profile: null },
    ]);

    renderProjectsPage();
    await screen.findByText("Alpha");

    const rowsOrder = () => screen.getAllByRole("row").slice(1).map((row) => row.textContent);
    expect(rowsOrder()[0]).toContain("Alpha");

    fireEvent.click(screen.getByRole("columnheader", { name: /^name/i }));
    expect(rowsOrder()[0]).toContain("Beta");

    fireEvent.click(screen.getByRole("columnheader", { name: /^name/i }));
    expect(rowsOrder()[0]).toContain("Alpha");
  });

  /**
   * TC-PROJ-023's third clause, gap-fill (coverage audit, 2026-09-09).
   *
   * The sort test above covers "click `Name` once, then again" but never
   * clicks the `ID` header, so TC-PROJ-023's own final clause — "clicking
   * `ID` resets to ascending on `ID`, **not carrying over `Name`'s
   * direction**" — was entirely unasserted. That branch is real code
   * (`ProjectsPage.tsx`'s `handleSort` sets `sortDir` back to `"asc"` only
   * when the field changes), and a regression dropping the reset would have
   * gone unnoticed.
   *
   * Fixture is chosen so ID order and BOTH Name directions are three
   * different sequences — an ID-ascending assertion can't pass by accident.
   */
  it("TC-PROJ-023: clicking the ID header resets to ascending on ID rather than carrying Name's direction", async () => {
    mockListProjects.mockResolvedValueOnce([
      { id: "proj-1", org_id: ORG_ID, name: "Charlie", standards_profile: null },
      { id: "proj-2", org_id: ORG_ID, name: "Alpha", standards_profile: null },
      { id: "proj-3", org_id: ORG_ID, name: "Bravo", standards_profile: null },
    ]);

    renderProjectsPage();
    await screen.findByText("Alpha");

    // Actual rendered row order, read from each row's own name link.
    const order = () =>
      screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getByRole("link").textContent);

    const nameHeader = () => screen.getByRole("columnheader", { name: /^name/i });
    const idHeader = () => screen.getByRole("columnheader", { name: /^id/i });

    // Default active sort: Name ascending.
    expect(order()).toEqual(["Alpha", "Bravo", "Charlie"]);

    fireEvent.click(nameHeader()); // first click -> descending
    expect(order()).toEqual(["Charlie", "Bravo", "Alpha"]);

    fireEvent.click(nameHeader()); // second click -> reverses back to ascending
    expect(order()).toEqual(["Alpha", "Bravo", "Charlie"]);

    // Third step of TC-PROJ-023's literal sequence: switch to the ID column.
    // id asc = proj-1/proj-2/proj-3 = Charlie/Alpha/Bravo — a sequence neither
    // Name direction produces.
    fireEvent.click(idHeader());
    expect(order()).toEqual(["Charlie", "Alpha", "Bravo"]);

    // The "not carrying over Name's direction" half specifically: leave Name
    // in DESCENDING, then switch to ID and assert ID-*ascending*. Without the
    // reset this would render ID-descending (Bravo, Alpha, Charlie).
    fireEvent.click(nameHeader()); // field change -> Name ascending
    fireEvent.click(nameHeader()); // -> Name descending
    expect(order()).toEqual(["Charlie", "Bravo", "Alpha"]);

    fireEvent.click(idHeader());
    expect(order()).toEqual(["Charlie", "Alpha", "Bravo"]);
    expect(order()).not.toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("paginates the list at 10 rows per page", async () => {
    const manyProjects = Array.from({ length: 12 }, (_, i) => ({
      id: `proj-${i}`,
      org_id: ORG_ID,
      name: `Project ${String(i).padStart(2, "0")}`,
      standards_profile: null,
    }));
    mockListProjects.mockResolvedValueOnce(manyProjects);

    renderProjectsPage();
    await screen.findByText("Project 00");

    expect(screen.getAllByRole("row")).toHaveLength(11); // 10 data rows + 1 header row
    expect(screen.queryByText("Project 11")).not.toBeInTheDocument();

    // ADR-0042: `container/Table.tsx`'s pagination is raw Bootstrap markup —
    // always a real `<button class="page-link">`.
    fireEvent.click(screen.getByText("2", { selector: "button.page-link" }));

    expect(await screen.findByText("Project 11")).toBeInTheDocument();
    expect(screen.queryByText("Project 00")).not.toBeInTheDocument();
  });

  /**
   * TC-PROJ-024 gap-fill (coverage audit, 2026-09-09).
   *
   * The pagination test above proves the 12-project split only partially — it
   * checks one row's presence/absence per page, not TC-PROJ-024's literal
   * "page 1 shows exactly its first 10, **none of the last 2**; page 2 shows
   * **the remaining 2**, none of the first 10."
   *
   * Its second sentence — "A ≤10-project fixture renders **no pagination
   * control at all**" — had no Vitest coverage either. The nearest existing
   * assertion (`ds2-table-container.spec.ts`) proves the control disappears
   * when the *page-size selector* is raised to 25, which exercises the same
   * `totalPages > 1` gate but is not the ≤10-fixture case the TC names.
   */
  const twelveProjects = () =>
    Array.from({ length: 12 }, (_, i) => ({
      id: `proj-${String(i).padStart(2, "0")}`,
      org_id: ORG_ID,
      name: `Project ${String(i).padStart(2, "0")}`,
      standards_profile: null,
    }));

  it("TC-PROJ-024: page 1 holds exactly the first 10 and page 2 exactly the remaining 2", async () => {
    mockListProjects.mockResolvedValueOnce(twelveProjects());

    renderProjectsPage();
    await screen.findByText("Project 00");

    // Page 1: exactly its first 10, NONE of the last 2.
    expect(screen.getAllByRole("row")).toHaveLength(11); // header + 10 data rows
    expect(screen.queryByText("Project 10")).not.toBeInTheDocument();
    expect(screen.queryByText("Project 11")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("2", { selector: "button.page-link" }));

    // Page 2: exactly the remaining 2, none of the first 10.
    expect(await screen.findByText("Project 11")).toBeInTheDocument();
    expect(screen.getByText("Project 10")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 data rows
    expect(screen.queryByText("Project 00")).not.toBeInTheDocument();
    expect(screen.queryByText("Project 09")).not.toBeInTheDocument();
  });

  it("TC-PROJ-024: a 10-project fixture renders no pagination control at all", async () => {
    mockListProjects.mockResolvedValueOnce(twelveProjects().slice(0, 10));

    renderProjectsPage();
    await screen.findByText("Project 00");

    expect(screen.getAllByRole("row")).toHaveLength(11); // header + all 10 data rows
    expect(screen.getByText("Project 09")).toBeInTheDocument();
    // `container/Table.tsx` gates the whole pagination row — nav AND the
    // page-size selector that shares it — on `totalPages > 1`, so at exactly
    // the threshold neither renders.
    expect(screen.queryByTestId("project-table-pagination")).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-table-page-size")).not.toBeInTheDocument();
  });
});

describe("ProjectsPage — project list persists across a remount (bug fix, 2026-09-07, PROJ-1)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Reproduces the reported bug directly: create a project, then unmount
   * `ProjectsPage` (navigating into a project's detail page and back does
   * exactly this — it's a route change, not a page reload) and remount it.
   * `listProjects` is mocked to actually return the project on the second
   * mount, proving the list is sourced from a real fetch, not carried over
   * via component state a remount would reset.
   */
  it("re-fetches and shows an existing project after the component unmounts and remounts", async () => {
    mockListProjects.mockResolvedValueOnce([
      { id: "proj-9", org_id: ORG_ID, name: "Persisted Project", standards_profile: null },
    ]);

    const { unmount } = renderProjectsPage();
    expect(await screen.findByText("Persisted Project")).toBeInTheDocument();

    unmount();
    mockListProjects.mockResolvedValueOnce([
      { id: "proj-9", org_id: ORG_ID, name: "Persisted Project", standards_profile: null },
    ]);
    renderProjectsPage();

    expect(await screen.findByText("Persisted Project")).toBeInTheDocument();
    expect(mockListProjects).toHaveBeenCalledTimes(2);
  });

  it("shows a loading state, then an error alert, on a failed fetch — never a false empty list", async () => {
    mockListProjects.mockRejectedValueOnce(new ApiError("Server error.", 500, null));

    renderProjectsPage();

    expect(screen.getByText(/loading projects/i)).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(/unable to load projects/i);
    expect(screen.queryByText(/no projects yet/i)).not.toBeInTheDocument();
  });
});
