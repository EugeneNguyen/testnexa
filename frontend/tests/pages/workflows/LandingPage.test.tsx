import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import LandingPage from "../../../src/pages/workflows/LandingPage";
import { useAuth } from "../../../src/auth/AuthContext";
import * as apiClient from "../../../src/lib/api/client";

/**
 * LANDING-1 (ADR-0024): TC-LANDING-001..005. Same partial-mock pattern as
 * `Signup.test.tsx`/`AppHeader.test.tsx` — keep the real `AuthContext`
 * module intact, replace `useAuth` with a `vi.fn()` so the redirect branches
 * (`orgContext: "auto"`/`"picker"`) can be driven directly without a real
 * login round trip.
 */
vi.mock("../../../src/auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/auth/AuthContext")>();
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

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/signup" element={<div>Signup page</div>} />
        <Route path="/orgs/:orgId" element={<div>Org home</div>} />
        <Route path="/orgs/pick" element={<div>Org picker</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LandingPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // TC-LANDING-001
  it("renders the product name, pitch, and Log in / Sign up CTAs for a logged-out visitor", () => {
    mockAuth();
    renderLanding();

    expect(screen.getByRole("heading", { name: /testnexa/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /log in/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign up/i })).toBeInTheDocument();
  });

  // TC-LANDING-002
  it("'Log in' CTA points to /login", () => {
    mockAuth();
    renderLanding();

    expect(screen.getByRole("link", { name: /log in/i })).toHaveAttribute("href", "/login");
  });

  // TC-LANDING-003
  it("'Sign up' link points to /signup", () => {
    mockAuth();
    renderLanding();

    expect(screen.getByRole("link", { name: /sign up/i })).toHaveAttribute("href", "/signup");
  });

  // TC-LANDING-004 (auto branch)
  it("redirects to /orgs/{orgId} instead of rendering landing content when orgContext is 'auto' with 1 org", async () => {
    mockAuth({ orgContext: "auto", orgs: [{ id: "11111111-1111-1111-1111-111111111111", name: "Acme", slug: "acme" }] });
    renderLanding();

    expect(await screen.findByText(/org home/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /testnexa/i })).not.toBeInTheDocument();
  });

  // TC-LANDING-004 (picker branch)
  it("redirects to /orgs/pick instead of rendering landing content when orgContext is 'picker'", async () => {
    mockAuth({ orgContext: "picker", orgs: [] });
    renderLanding();

    expect(await screen.findByText(/org picker/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /testnexa/i })).not.toBeInTheDocument();
  });

  // TC-LANDING-005
  it("makes no apiFetch call when rendered logged-out", () => {
    const apiFetchSpy = vi.spyOn(apiClient, "apiFetch");
    mockAuth();
    renderLanding();

    expect(apiFetchSpy).not.toHaveBeenCalled();
  });
});
