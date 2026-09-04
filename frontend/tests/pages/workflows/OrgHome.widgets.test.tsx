import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import OrgHome from "../../../src/pages/workflows/OrgHome";
import { getActiveMemberTotal, getProjectsTotal } from "../../../src/lib/api/dashboard";

/**
 * SHELL-3 (ADR-0020, FR-SHELL-3/NFR-27) dashboard stat-widget unit tests,
 * TC-SHELL-010 (real count)/TC-SHELL-011 (zero-state vs. error-state).
 *
 * `lib/api/dashboard.ts`'s two count functions are mocked directly (same
 * partial-mock pattern `OrgHome.test.tsx` already uses for
 * `createProject`/`updateProject`) — the widgets' own `widgetValue()`
 * loading/error/success branching is what's under test here, not the real
 * HTTP call (that's the E2E suite's job against a live, seeded backend,
 * TC-SHELL-010).
 */
vi.mock("../../../src/lib/api/dashboard", () => ({
  getProjectsTotal: vi.fn(),
  getActiveMemberTotal: vi.fn(),
}));

const mockGetProjectsTotal = vi.mocked(getProjectsTotal);
const mockGetActiveMemberTotal = vi.mocked(getActiveMemberTotal);

const ORG_ID = "11111111-1111-1111-1111-111111111111";

function renderOrgHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/orgs/${ORG_ID}`]}>
        <Routes>
          <Route path="/orgs/:orgId" element={<OrgHome />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OrgHome dashboard stat widgets", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("TC-SHELL-010: shows the real resolved counts once both queries settle", async () => {
    mockGetProjectsTotal.mockResolvedValue(3);
    mockGetActiveMemberTotal.mockResolvedValue(5);

    renderOrgHome();

    await waitFor(() => expect(screen.getByTestId("widget-project-count")).toHaveTextContent("3"));
    expect(screen.getByTestId("widget-active-member-count")).toHaveTextContent("5");
  });

  it("TC-SHELL-011: a real zero count renders \"0\", not the error/loading state", async () => {
    mockGetProjectsTotal.mockResolvedValue(0);
    mockGetActiveMemberTotal.mockResolvedValue(0);

    renderOrgHome();

    await waitFor(() => expect(screen.getByTestId("widget-project-count")).toHaveTextContent("0"));
    expect(screen.getByTestId("widget-active-member-count")).toHaveTextContent("0");
    expect(screen.queryByText(/unable to load/i)).not.toBeInTheDocument();
  });

  it("TC-SHELL-011: a failed fetch shows an explicit error state, never a false \"0\"", async () => {
    mockGetProjectsTotal.mockRejectedValue(new Error("404"));
    mockGetActiveMemberTotal.mockResolvedValue(2);

    renderOrgHome();

    await waitFor(() =>
      expect(screen.getByTestId("widget-project-count")).toHaveTextContent(/unable to load/i),
    );
    expect(screen.getByTestId("widget-project-count")).not.toHaveTextContent(/^0$/);
    // The other widget is unaffected — each is its own independent query.
    expect(screen.getByTestId("widget-active-member-count")).toHaveTextContent("2");
  });

  it("TC-SHELL-011: renders a distinct loading state before either query settles", () => {
    mockGetProjectsTotal.mockReturnValue(new Promise(() => {})); // never resolves
    mockGetActiveMemberTotal.mockReturnValue(new Promise(() => {}));

    renderOrgHome();

    expect(screen.getByTestId("widget-project-count")).toHaveTextContent(/loading/i);
    expect(screen.getByTestId("widget-active-member-count")).toHaveTextContent(/loading/i);
  });
});
