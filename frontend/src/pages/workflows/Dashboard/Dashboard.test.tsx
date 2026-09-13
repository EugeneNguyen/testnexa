import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";
import * as authApi from "../../../lib/api/auth";
import * as organizationsApi from "../../../lib/api/organizations";
import { ApiError } from "../../../lib/api/client";

/**
 * DASH-3 dashboard org list + chooser (ADR-0063, supersedes DASH-1's empty
 * placeholder). Covers TC-DASH-007..010 (count-branching + fresh-fetch),
 * TC-DASH-011's unit-level half (mounting with a fresh `getMyOrgs` mock
 * simulates "reload with a stale/absent `AuthContext.orgs`" — the full
 * real-browser reload proof lives in `e2e/tests/root-redirect.spec.ts`).
 *
 * `getMyOrgs`/`createOrg` are mocked at the `lib/api/*` module boundary
 * (not `apiFetch` itself) — same posture other bespoke-screen tests in this
 * codebase take when the module under test calls a named API function
 * directly, per `frontend/CLAUDE.md`'s own caution that a green Vitest run
 * against a mock only proves internal consistency, not real backend
 * agreement (that proof is `e2e/`'s job here).
 */
function OrgIdProbe() {
  const { orgId } = useParams<{ orgId: string }>();
  return <div data-testid="landed-org-id">{orgId}</div>;
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/orgs/:orgId" element={<OrgIdProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Dashboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TC-DASH-007
  it("exactly 1 org: navigates straight to /orgs/{id}, no intermediate render, no click", async () => {
    vi.spyOn(authApi, "getMyOrgs").mockResolvedValue({
      orgs: [{ id: "org-1", name: "Acme Corp", slug: "acme-corp" }],
    });

    renderDashboard();

    await waitFor(() => expect(screen.getByTestId("landed-org-id")).toHaveTextContent("org-1"));

    // No card list, no "Select an organization" heading ever rendered.
    expect(screen.queryByText(/select an organization/i)).not.toBeInTheDocument();
  });

  // TC-DASH-008 + TC-DASH-011 (unit half)
  it("fetches the org list fresh via getMyOrgs on every mount", async () => {
    const getMyOrgsSpy = vi.spyOn(authApi, "getMyOrgs").mockResolvedValue({
      orgs: [
        { id: "org-1", name: "Acme Corp", slug: "acme-corp" },
        { id: "org-2", name: "Beta Testing", slug: "beta-testing" },
      ],
    });

    renderDashboard();

    await screen.findByText(/select an organization/i);
    expect(getMyOrgsSpy).toHaveBeenCalledTimes(1);
  });

  // TC-DASH-009
  it("2+ orgs: renders a 'Select an organization' card list, clicking one navigates to /orgs/{id}", async () => {
    vi.spyOn(authApi, "getMyOrgs").mockResolvedValue({
      orgs: [
        { id: "org-1", name: "Acme Corp", slug: "acme-corp" },
        { id: "org-2", name: "Beta Testing", slug: "beta-testing" },
      ],
    });

    renderDashboard();

    await screen.findByText(/select an organization/i);
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Beta Testing")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Beta Testing"));

    await waitFor(() => expect(screen.getByTestId("landed-org-id")).toHaveTextContent("org-2"));
  });

  // TC-DASH-010
  it("0 orgs: renders an empty state with a 'Create organization' CTA, not the literal word Dashboard as heading", async () => {
    vi.spyOn(authApi, "getMyOrgs").mockResolvedValue({ orgs: [] });

    renderDashboard();

    await screen.findByText(/no organizations yet/i);
    expect(screen.queryByRole("heading", { name: /^dashboard$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create organization/i })).toBeInTheDocument();
  });

  it("0 orgs: the create-organization CTA opens a modal that calls createOrg and navigates to the new org", async () => {
    vi.spyOn(authApi, "getMyOrgs").mockResolvedValue({ orgs: [] });
    vi.spyOn(organizationsApi, "createOrg").mockResolvedValue({
      id: "new-org-id",
      name: "New Co",
      slug: "new-co",
    });

    renderDashboard();

    await screen.findByText(/no organizations yet/i);
    fireEvent.click(screen.getByRole("button", { name: /create organization/i }));

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "New Co" } });
    fireEvent.change(screen.getByLabelText(/^slug$/i), { target: { value: "new-co" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(screen.getByTestId("landed-org-id")).toHaveTextContent("new-org-id"));
  });

  it("2+ orgs: the create-organization affordance is also available alongside the list", async () => {
    vi.spyOn(authApi, "getMyOrgs").mockResolvedValue({
      orgs: [
        { id: "org-1", name: "Acme Corp", slug: "acme-corp" },
        { id: "org-2", name: "Beta Testing", slug: "beta-testing" },
      ],
    });

    renderDashboard();

    await screen.findByText(/select an organization/i);
    expect(screen.getByRole("button", { name: /create organization/i })).toBeInTheDocument();
  });

  it("shows a loading spinner while the org list is in flight", () => {
    vi.spyOn(authApi, "getMyOrgs").mockReturnValue(new Promise(() => {}));

    renderDashboard();

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an error state, distinct from the 0-org empty state, if the fetch fails", async () => {
    vi.spyOn(authApi, "getMyOrgs").mockRejectedValue(new ApiError("boom", 500));

    renderDashboard();

    await screen.findByText(/couldn't load your organizations/i);
    expect(screen.queryByText(/no organizations yet/i)).not.toBeInTheDocument();
  });
});
