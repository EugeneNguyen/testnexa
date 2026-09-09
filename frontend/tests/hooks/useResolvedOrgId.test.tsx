import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppBreadcrumb from "../../src/components/organisms/app-breadcrumb";
import AppSidebar from "../../src/components/organisms/app-sidebar";
import { useResolvedOrgId } from "../../src/hooks/useResolvedOrgId";
import { getProject } from "../../src/lib/api/projects";

/**
 * SHELL-9 (ADR-0049) — `useResolvedOrgId()`'s own unit coverage, plus
 * TC-SHELL-034 (fetch dedup).
 *
 * ## Why this file stubs `globalThis.fetch` rather than mocking `getProject`
 *
 * TC-SHELL-034's Expected-result cell is explicit: "Exactly 1 call, not 3
 * (sidebar + breadcrumb + page) — **counted via network inspection**, not
 * inferred from correct rendering", and test-design §39 names "a Vitest
 * fetch-mock call-count assertion" as the sanctioned technique at this layer.
 * Mocking `getProject` would count *module-function* calls, one abstraction
 * level above the thing the TC actually names. Stubbing `fetch` counts real
 * `GET /api/v1/projects/{id}` requests leaving `apiFetch`, which is literally
 * what the TC asks to be counted — and it exercises the real `lib/api/projects`
 * module and the real `apiFetch` in the process, rather than replacing them.
 *
 * The other tests in this file use the same stub for consistency, so the
 * hook's pending/error/success branches are driven by real (stubbed) HTTP
 * outcomes rather than by a hand-shaped module mock.
 */

const PROJECT_ID = "9f1d2c3b-4a5e-6f70-8192-a3b4c5d6e7f8";
const PROJECT_ORG_ID = "22222222-2222-2222-2222-222222222222";
const PROJECT_NAME = "Acme Payments Gateway";
const PROJECT_BODY = {
  id: PROJECT_ID,
  org_id: PROJECT_ORG_ID,
  name: PROJECT_NAME,
  standards_profile: null,
};

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

/** A minimal `Response`-shaped object — everything `apiFetch` actually reads. */
function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Every `GET /api/v1/projects/{id}` request this test's stub actually saw. */
function projectFetchCalls(): string[] {
  return fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes(`/api/v1/projects/${PROJECT_ID}`));
}

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Renders whatever `useResolvedOrgId()` returns, as inspectable text. */
function HookProbe() {
  const { orgId, projectId, project, status } = useResolvedOrgId();
  return (
    <div>
      <span data-testid="probe-org-id">{orgId ?? "(undefined)"}</span>
      <span data-testid="probe-project-id">{projectId ?? "(undefined)"}</span>
      <span data-testid="probe-project-name">{project?.name ?? "(undefined)"}</span>
      <span data-testid="probe-status">{status}</span>
    </div>
  );
}

function renderProbe(initialEntry: string) {
  return render(
    <QueryClientProvider client={newQueryClient()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/orgs/pick" element={<HookProbe />} />
          <Route path="/orgs/:orgId" element={<HookProbe />} />
          <Route path="/projects/:projectId" element={<HookProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("useResolvedOrgId", () => {
  it("returns the :orgId route param directly, issuing no fetch at all, on an org-scoped route", () => {
    renderProbe("/orgs/org-1");

    expect(screen.getByTestId("probe-org-id")).toHaveTextContent("org-1");
    expect(screen.getByTestId("probe-project-id")).toHaveTextContent("(undefined)");
    expect(screen.getByTestId("probe-project-name")).toHaveTextContent("(undefined)");
    // ADR-0049 Decision §1: "return it directly, no fetch" — the hook must cost
    // nothing beyond the `useParams` read it replaced on these routes.
    expect(screen.getByTestId("probe-status")).toHaveTextContent("success");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns undefined with no fetch when neither param is present (/orgs/pick)", () => {
    renderProbe("/orgs/pick");

    expect(screen.getByTestId("probe-org-id")).toHaveTextContent("(undefined)");
    expect(screen.getByTestId("probe-status")).toHaveTextContent("success");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves org_id and the ProjectSummary via GET /projects/{id} on a project-scoped route", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, PROJECT_BODY));

    renderProbe(`/projects/${PROJECT_ID}`);

    // Pending first — orgId genuinely unknown until the row comes back.
    expect(screen.getByTestId("probe-status")).toHaveTextContent("pending");
    expect(screen.getByTestId("probe-org-id")).toHaveTextContent("(undefined)");

    await waitFor(() => {
      expect(screen.getByTestId("probe-status")).toHaveTextContent("success");
    });
    expect(screen.getByTestId("probe-org-id")).toHaveTextContent(PROJECT_ORG_ID);
    expect(screen.getByTestId("probe-project-id")).toHaveTextContent(PROJECT_ID);
    // The ProjectSummary itself is returned so `AppBreadcrumb` needn't refetch
    // the same row for its name segment (ADR-0049 Decision §1).
    expect(screen.getByTestId("probe-project-name")).toHaveTextContent(PROJECT_NAME);
    expect(projectFetchCalls()).toHaveLength(1);
  });

  it("reports status 'error' with orgId undefined when the project 404s", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { code: "not_found", message: "Not Found" }));

    renderProbe(`/projects/${PROJECT_ID}`);

    await waitFor(() => {
      expect(screen.getByTestId("probe-status")).toHaveTextContent("error");
    });
    expect(screen.getByTestId("probe-org-id")).toHaveTextContent("(undefined)");
    expect(screen.getByTestId("probe-project-name")).toHaveTextContent("(undefined)");
  });

  // ------------------------------------------------------------------
  // TC-SHELL-034 — fetch dedup.
  // ------------------------------------------------------------------

  /**
   * Stands in for "a project-scoped screen that itself calls
   * `getProject(projectId)` under the shared `["project", projectId]` cache
   * key" — the TC's own literal precondition.
   *
   * Worth stating plainly rather than leaving implicit: **no shipped page
   * component does this today.** `ProjectDetail.tsx` loads releases/requirements
   * via `useState`/`useEffect` and never fetches its own `Project` row at all,
   * and `TestCycleDetail.tsx` calls `getProject` from a plain async handler, not
   * through react-query. (ADR-0049's Consequences section asserts "`ProjectDetail`
   * already does, for its own header" — that is inaccurate against the current
   * source; noted, not silently absorbed.) The TC's third consumer therefore has
   * to be constructed here. That is not a weakening of the test: the property
   * under test is that a third consumer using the documented shared key collapses
   * into the same single request, which is exactly what this asserts, and it is
   * the same react-query key any future page would use.
   */
  function PageThatFetchesItsOwnProject({ projectId }: { projectId: string }) {
    const { data } = useQuery({
      queryKey: ["project", projectId],
      queryFn: () => getProject(projectId),
    });
    return <div data-testid="page-project-name">{data?.name ?? "(loading)"}</div>;
  }

  it("TC-SHELL-034: sidebar + breadcrumb + the page's own query collapse to exactly one GET /projects/{id}", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, PROJECT_BODY));

    render(
      <QueryClientProvider client={newQueryClient()}>
        <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}`]}>
          <Routes>
            <Route
              path="/projects/:projectId"
              element={
                <>
                  {/* Consumer 1: the sidebar's own `useResolvedOrgId()`. */}
                  <AppSidebar />
                  {/* Consumer 2: the breadcrumb's own `useResolvedOrgId()`. */}
                  <AppBreadcrumb />
                  {/* Consumer 3: the page, under the same documented key. */}
                  <PageThatFetchesItsOwnProject projectId={PROJECT_ID} />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // All three consumers really did resolve — so this is one call serving
    // three readers, not one call because two of them silently no-op'd.
    await waitFor(() => {
      expect(screen.getByTestId("page-project-name")).toHaveTextContent(PROJECT_NAME);
    });
    // SHELL-10 (ADR-0049): on a project-scoped route the sidebar now renders
    // the project-mode nav, so the org nav's `sidebar-nav-projects` item is no
    // longer present here. The equivalent proof that the sidebar's own
    // `useResolvedOrgId()` really resolved `org_id` (rather than silently
    // no-op'ing and letting the page's query alone account for the single
    // fetch) is the "Back to Projects" link, which is built from that same
    // resolved `orgId` and is omitted entirely until it resolves. The dedup
    // property this TC actually asserts is unchanged.
    expect(screen.getByTestId("sidebar-nav-back-to-projects")).toHaveAttribute(
      "href",
      `/orgs/${PROJECT_ORG_ID}/projects`,
    );
    // Scoped to the breadcrumb specifically — the name also appears in the
    // page stub above, so an unscoped `getByText` would be a strict-mode
    // ambiguity rather than proof the breadcrumb itself resolved.
    const breadcrumb = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(breadcrumb).toHaveTextContent(PROJECT_NAME);
    expect(breadcrumb).toHaveTextContent("Projects");

    // The assertion the TC actually names: a count of real network requests.
    expect(projectFetchCalls()).toHaveLength(1);

    // Give any un-deduped straggler request a chance to fire before concluding
    // — a count taken the instant the first render settles could miss one.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(projectFetchCalls()).toHaveLength(1);
  });
});
