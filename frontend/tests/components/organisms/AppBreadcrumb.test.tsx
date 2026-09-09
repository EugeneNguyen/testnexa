import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppBreadcrumb from "../../../src/components/organisms/app-breadcrumb";
import { allEntities } from "../../../src/pages/admin/registry";
import { ApiError } from "../../../src/lib/api/client";
import { getProject } from "../../../src/lib/api/projects";

/**
 * SHELL-2 (ADR-0020) breadcrumb unit tests, TC-SHELL-007/008 plus the
 * 2026-09-07 route-coverage correction, extended by SHELL-9 (ADR-0049) with
 * TC-SHELL-032/033.
 *
 * Same per-route-pattern render approach as `AppSidebar.test.tsx`: mount
 * `AppBreadcrumb` as a `Route`'s element so `useLocation()`/`matchPath`
 * resolve against the same path patterns a real `ProtectedRoute` screen
 * would use.
 *
 * **SHELL-9 changed two things about this file, both structural:**
 *
 * 1. A `QueryClientProvider` is now mandatory around every render — the
 *    component calls `useResolvedOrgId()`, which calls `useQuery`
 *    unconditionally (a hook cannot sit behind a route-shape branch), so
 *    without a provider every test in this file throws "No QueryClient set"
 *    regardless of which route it exercises.
 * 2. **The three project-scoped route tests below previously asserted a bare,
 *    unlinked "Project" crumb — the exact behavior ADR-0049 replaces.** Those
 *    assertions are rewritten here to the resolved `Projects -> {project name}`
 *    trail, in the same change as the implementation, per ADR-0049's own
 *    Consequences ("every existing e2e/Vitest assertion on those trails' exact
 *    segment count/text needs updating"). They previously carried
 *    `TC-SHELL-016/017/019` labels; those IDs in
 *    `docs/test-cases/2026-09-03-test-cases.md` in fact belong to SHELL-6's
 *    org-switcher rows, not to any breadcrumb row — a pre-existing labelling
 *    drift this story did not create and does not renumber. The tests are
 *    relabelled here against the row that genuinely pins their (new) behavior,
 *    TC-SHELL-032, rather than carrying a wrong pointer forward.
 */

vi.mock("../../../src/lib/api/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/projects")>();
  return { ...actual, getProject: vi.fn() };
});

const mockGetProject = vi.mocked(getProject);

const PROJECT_ID = "9f1d2c3b-4a5e-6f70-8192-a3b4c5d6e7f8";
const PROJECT_ORG_ID = "22222222-2222-2222-2222-222222222222";
/**
 * A real, distinctive name — TC-SHELL-032 explicitly requires asserting against
 * "a seeded fixture's actual name string, not a placeholder", so that a
 * resolution which silently fell back to the old bare "Project" label fails
 * this file even though *a* breadcrumb still renders.
 */
const PROJECT_NAME = "Acme Payments Gateway";
const PROJECT_FIXTURE = {
  id: PROJECT_ID,
  org_id: PROJECT_ORG_ID,
  name: PROJECT_NAME,
  standards_profile: null,
};

function renderBreadcrumb(initialEntry: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/orgs/pick" element={<AppBreadcrumb />} />
          <Route path="/orgs/:orgId" element={<AppBreadcrumb />} />
          <Route path="/orgs/:orgId/projects" element={<AppBreadcrumb />} />
          <Route path="/orgs/:orgId/members" element={<AppBreadcrumb />} />
          <Route path="/orgs/:orgId/ui-elements/colors" element={<AppBreadcrumb />} />
          <Route path="/orgs/:orgId/admin/:entity" element={<AppBreadcrumb />} />
          <Route path="/orgs/:orgId/admin/:entity/:id/edit" element={<AppBreadcrumb />} />
          <Route path="/projects/:projectId" element={<AppBreadcrumb />} />
          <Route path="/projects/:projectId/test-plans/:testPlanId" element={<AppBreadcrumb />} />
          <Route
            path="/projects/:projectId/test-plans/:testPlanId/test-cycles/:testCycleId"
            element={<AppBreadcrumb />}
          />
          <Route path="/projects/:projectId/admin/:entity" element={<AppBreadcrumb />} />
          <Route path="/projects/:projectId/admin/:entity/:id/edit" element={<AppBreadcrumb />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The trail's crumb texts, in DOM order — used for exact-sequence assertions. */
function crumbTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll("ol.breadcrumb > li.breadcrumb-item")].map(
    (li) => li.textContent?.trim() ?? "",
  );
}

describe("AppBreadcrumb", () => {
  beforeEach(() => {
    mockGetProject.mockReset();
  });

  it("TC-SHELL-007: resolves known route segments on /orgs/:orgId/members", () => {
    renderBreadcrumb("/orgs/org-1/members");

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Members")).toBeInTheDocument();
    // The active (final) segment is plain text, not a link — only the
    // earlier "Dashboard" segment is clickable.
    expect(screen.getByText("Dashboard").closest("a")).toHaveAttribute("href", "/orgs/org-1");
    expect(screen.getByText("Members").closest("a")).toBeNull();
  });

  it("renders a single, non-linked segment on /orgs/:orgId", () => {
    renderBreadcrumb("/orgs/org-1");

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Dashboard").closest("a")).toBeNull();
  });

  it("PROJ-4: resolves Dashboard -> Projects on /orgs/:orgId/projects, Dashboard linked", () => {
    renderBreadcrumb("/orgs/org-1/projects");

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Dashboard").closest("a")).toHaveAttribute("href", "/orgs/org-1");
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Projects").closest("a")).toBeNull();
  });

  it("resolves a nested UI-elements route with 3 segments", () => {
    renderBreadcrumb("/orgs/org-1/ui-elements/colors");

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("UI Elements")).toBeInTheDocument();
    expect(screen.getByText("Colors")).toBeInTheDocument();
  });

  it("TC-SHELL-008: degrades gracefully on an unmapped/root route (/orgs/pick) — renders nothing, no raw param or undefined fragment", () => {
    const { container } = renderBreadcrumb("/orgs/pick");

    expect(container.querySelector(".breadcrumb")).not.toBeInTheDocument();
    expect(screen.queryByText("undefined")).not.toBeInTheDocument();
    expect(screen.queryByText("pick")).not.toBeInTheDocument();
  });

  it("TC-SHELL-018: resolves an org-scoped admin list route's entity label from the registry", () => {
    renderBreadcrumb("/orgs/org-1/admin/roles");

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    // The TC says "Dashboard" links — assert the href, not just its presence.
    expect(screen.getByText("Dashboard").closest("a")).toHaveAttribute("href", "/orgs/org-1");
    // "Roles" is the registry's own label for the `roles` key, not a
    // hardcoded string in this component.
    expect(allEntities.find((e) => e.key === "roles")?.label).toBe("Roles");
    expect(screen.getByText("Roles")).toBeInTheDocument();
    expect(screen.getByText("Roles").closest("a")).toBeNull();
  });

  // ------------------------------------------------------------------
  // SHELL-9 (ADR-0049) / TC-SHELL-032: the resolved project trail.
  //
  // The TC requires `/projects/:projectId` AND "each of its 4 nested route
  // patterns in turn", each asserted for its own full segment sequence per UI
  // Design Document §1b — not just the shared two-segment prefix checked once.
  // Each case below therefore asserts the ENTIRE ordered crumb list, so a trail
  // that grew or lost a segment fails rather than passing on a substring match.
  // ------------------------------------------------------------------

  it("TC-SHELL-032: /projects/:projectId resolves Projects (linked) -> {project name} (active)", async () => {
    mockGetProject.mockResolvedValue(PROJECT_FIXTURE);

    const { container } = renderBreadcrumb(`/projects/${PROJECT_ID}`);

    await waitFor(() => {
      expect(crumbTexts(container)).toEqual(["Projects", PROJECT_NAME]);
    });
    // "Projects" links to the resolved org's own list route — the whole point
    // of the story: a click-path back out of the project.
    expect(screen.getByText("Projects").closest("a")).toHaveAttribute(
      "href",
      `/orgs/${PROJECT_ORG_ID}/projects`,
    );
    // The project's real name is the active, unlinked final segment.
    const active = container.querySelector("li.breadcrumb-item.active")!;
    expect(active).toHaveTextContent(PROJECT_NAME);
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active.querySelector("a")).toBeNull();
    // "never the old bare unlinked 'Project' label" — the literal negative the
    // TC's own Expected-result cell names.
    expect(screen.queryByText("Project")).not.toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("TC-SHELL-032: /projects/:projectId/test-plans/:testPlanId resolves Projects -> {name} -> Test Plan", async () => {
    mockGetProject.mockResolvedValue(PROJECT_FIXTURE);

    const { container } = renderBreadcrumb(`/projects/${PROJECT_ID}/test-plans/plan-1`);

    await waitFor(() => {
      expect(crumbTexts(container)).toEqual(["Projects", PROJECT_NAME, "Test Plan"]);
    });
    expect(screen.getByText("Projects").closest("a")).toHaveAttribute(
      "href",
      `/orgs/${PROJECT_ORG_ID}/projects`,
    );
    // On a nested pattern the project's name links back to its own detail screen.
    expect(screen.getByText(PROJECT_NAME).closest("a")).toHaveAttribute(
      "href",
      `/projects/${PROJECT_ID}`,
    );
    expect(screen.getByText("Test Plan").closest("a")).toBeNull();
    expect(screen.queryByText("Project")).not.toBeInTheDocument();
  });

  it("TC-SHELL-032: the test-cycles route resolves Projects -> {name} -> Test Plan -> Test Cycle", async () => {
    mockGetProject.mockResolvedValue(PROJECT_FIXTURE);

    const { container } = renderBreadcrumb(
      `/projects/${PROJECT_ID}/test-plans/plan-1/test-cycles/cycle-1`,
    );

    await waitFor(() => {
      expect(crumbTexts(container)).toEqual([
        "Projects",
        PROJECT_NAME,
        "Test Plan",
        "Test Cycle",
      ]);
    });
    expect(screen.getByText("Projects").closest("a")).toHaveAttribute(
      "href",
      `/orgs/${PROJECT_ORG_ID}/projects`,
    );
    expect(screen.getByText(PROJECT_NAME).closest("a")).toHaveAttribute(
      "href",
      `/projects/${PROJECT_ID}`,
    );
    expect(screen.getByText("Test Plan").closest("a")).toHaveAttribute(
      "href",
      `/projects/${PROJECT_ID}/test-plans/plan-1`,
    );
    expect(screen.getByText("Test Cycle").closest("a")).toBeNull();
    expect(screen.queryByText("Project")).not.toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("TC-SHELL-032: a project-scoped admin list route resolves Projects -> {name} -> {entity label}", async () => {
    mockGetProject.mockResolvedValue(PROJECT_FIXTURE);

    const { container } = renderBreadcrumb(`/projects/${PROJECT_ID}/admin/test-cases`);

    // The entity label comes from the registry, not a hardcoded string here.
    const testCasesLabel = allEntities.find((e) => e.key === "test-cases")!.label;
    await waitFor(() => {
      expect(crumbTexts(container)).toEqual(["Projects", PROJECT_NAME, testCasesLabel]);
    });
    expect(screen.getByText(testCasesLabel).closest("a")).toBeNull();
    expect(screen.queryByText("Project")).not.toBeInTheDocument();
  });

  it("TC-SHELL-032: a project-scoped admin edit route resolves Projects -> {name} -> {entity label} -> Edit", async () => {
    mockGetProject.mockResolvedValue(PROJECT_FIXTURE);

    const { container } = renderBreadcrumb(`/projects/${PROJECT_ID}/admin/test-cases/tc-1/edit`);

    const testCasesLabel = allEntities.find((e) => e.key === "test-cases")!.label;
    await waitFor(() => {
      expect(crumbTexts(container)).toEqual(["Projects", PROJECT_NAME, testCasesLabel, "Edit"]);
    });
    expect(screen.getByText("Projects").closest("a")).toHaveAttribute(
      "href",
      `/orgs/${PROJECT_ORG_ID}/projects`,
    );
    expect(screen.getByText(PROJECT_NAME).closest("a")).toHaveAttribute(
      "href",
      `/projects/${PROJECT_ID}`,
    );
    expect(screen.getByText(testCasesLabel).closest("a")).toHaveAttribute(
      "href",
      `/projects/${PROJECT_ID}/admin/test-cases`,
    );
    expect(screen.getByText("Edit").closest("a")).toBeNull();
    expect(screen.queryByText("Project")).not.toBeInTheDocument();
  });

  // ------------------------------------------------------------------
  // SHELL-9 / TC-SHELL-033, breadcrumb half — two DISTINCT cases (pending vs.
  // a real 404), per test-design §39: "a resolver that only handles 'still
  // loading' but throws unhandled on a real 404 would pass a pending-only
  // check". The sidebar half lives in `AppSidebar.test.tsx`.
  // ------------------------------------------------------------------

  it("TC-SHELL-033(a): renders nothing at all (no partial trail, no raw id) while resolution is pending", () => {
    mockGetProject.mockReturnValue(new Promise(() => {}));

    const { container } = renderBreadcrumb(`/projects/${PROJECT_ID}/test-plans/plan-1`);

    // The existing `segments.length === 0 -> null` path — TC-SHELL-008's own
    // invariant, now proven to also cover this new failure source.
    expect(container.querySelector(".breadcrumb")).not.toBeInTheDocument();
    expect(container.querySelector("nav[aria-label='breadcrumb']")).not.toBeInTheDocument();
    // Specifically NOT a rootless partial trail ("Test Plan" with no ancestors).
    expect(screen.queryByText("Test Plan")).not.toBeInTheDocument();
    expect(screen.queryByText(PROJECT_ID)).not.toBeInTheDocument();
    expect(screen.queryByText("undefined")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("undefined");
  });

  it("TC-SHELL-033(b): renders nothing at all (no crash) when the project 404s", async () => {
    mockGetProject.mockRejectedValue(new ApiError("Not Found", 404, { code: "not_found" }));

    const { container } = renderBreadcrumb(`/projects/${PROJECT_ID}/test-plans/plan-1`);

    await waitFor(() => {
      expect(mockGetProject).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(container.querySelector(".breadcrumb")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Test Plan")).not.toBeInTheDocument();
    expect(screen.queryByText("Projects")).not.toBeInTheDocument();
    expect(screen.queryByText(PROJECT_ID)).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("undefined");
  });
});
