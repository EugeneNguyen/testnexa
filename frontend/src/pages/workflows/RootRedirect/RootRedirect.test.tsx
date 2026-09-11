import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import RootRedirect from "./RootRedirect";
import { useAuth } from "../../../auth/AuthContext";

/**
 * DASH-1 (ADR-0035) root guard: TC-DASH-001, TC-DASH-003, TC-DASH-004, and
 * the unit-level half of TC-DASH-006.
 *
 * Same partial-mock pattern as `ProtectedRoute.test.tsx` (whose guard this
 * one mirrors) — keep the real `AuthContext` module intact, replace `useAuth`
 * with a `vi.fn()` so `isInitializing`/`accessToken` can be driven directly
 * without a real boot-refresh round trip.
 *
 * The full reload-with-a-real-cookie proof for TC-DASH-006 is
 * `e2e/tests/root-redirect.spec.ts` — a real browser reload is the only place
 * the AUTH-2 boot-refresh gap actually reproduces. What this file proves is
 * the narrower, sufficient unit fact underneath it: the guard's decision does
 * not read `orgContext`/`orgs` at all, so their post-reload `null`/`[]` state
 * cannot change where it routes.
 */
vi.mock("../../../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../auth/AuthContext")>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

const mockUseAuth = vi.mocked(useAuth);

function mockAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  mockUseAuth.mockReturnValue({
    accessToken: null,
    orgContext: null,
    orgs: [],
    isInitializing: false,
    login: vi.fn(),
    signup: vi.fn(),
    acceptInvite: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  });
}

function renderRoot() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/dashboard" element={<div>Dashboard page</div>} />
        <Route path="/orgs/:orgId" element={<div>Org home</div>} />
        <Route path="/orgs/pick" element={<div>Org picker</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RootRedirect", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // TC-DASH-004: "Spinner renders; neither /login nor /dashboard navigation
  // fires until isInitializing settles."
  it("renders a spinner and fires neither redirect while isInitializing", () => {
    mockAuth({ isInitializing: true, accessToken: null });

    renderRoot();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  });

  // TC-DASH-004, the other side of the boundary: an access token already
  // present must still not short-circuit the spinner while the boot refresh
  // is in flight — `isInitializing` is checked first, on purpose.
  it("renders a spinner while isInitializing even when an access token is already present", () => {
    mockAuth({ isInitializing: true, accessToken: "token-abc" });

    renderRoot();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  });

  // TC-DASH-001 (unit level; the e2e spec covers the real-browser case)
  it("redirects to /login once settled with no access token, rendering no landing content", () => {
    mockAuth({ isInitializing: false, accessToken: null });

    renderRoot();

    expect(screen.getByText("Login page")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // The deleted LandingPage's own content must not render at `/` anymore.
    expect(screen.queryByRole("heading", { name: /testnexa/i })).not.toBeInTheDocument();
  });

  // TC-DASH-003 (unit level)
  it("redirects to /dashboard once settled with an access token", () => {
    mockAuth({ isInitializing: false, accessToken: "token-abc" });

    renderRoot();

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
  });

  // TC-DASH-006 (unit level): the post-reload state the AUTH-2 boot-refresh
  // gap actually produces — access token restored from the refresh cookie,
  // but `orgContext`/`orgs` still unresolved (`null`/`[]`). Under ADR-0024's
  // superseded `orgContext`-branching root logic this fell through to the
  // landing page; here it must reach /dashboard.
  it("redirects to /dashboard with an access token but unresolved orgContext/orgs (the AUTH-2 reload gap)", () => {
    mockAuth({ isInitializing: false, accessToken: "token-abc", orgContext: null, orgs: [] });

    renderRoot();

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
    expect(screen.queryByText("Org picker")).not.toBeInTheDocument();
  });

  // The guard must branch on `accessToken` only — a resolved `orgContext`
  // must not divert it to `Login.tsx`'s org-scoped destinations, which is the
  // behavior ADR-0035 deliberately removed from this route.
  it("routes to /dashboard regardless of a resolved orgContext, never to an org route", () => {
    mockAuth({
      isInitializing: false,
      accessToken: "token-abc",
      orgContext: "auto",
      orgs: [{ id: "11111111-1111-1111-1111-111111111111", name: "Acme", slug: "acme" }],
    });

    renderRoot();

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("Org home")).not.toBeInTheDocument();
    expect(screen.queryByText("Org picker")).not.toBeInTheDocument();
  });

  it("routes to /login regardless of a resolved orgContext when there is no access token", () => {
    mockAuth({
      isInitializing: false,
      accessToken: null,
      orgContext: "picker",
      orgs: [],
    });

    renderRoot();

    expect(screen.getByText("Login page")).toBeInTheDocument();
    expect(screen.queryByText("Org picker")).not.toBeInTheDocument();
  });
});
