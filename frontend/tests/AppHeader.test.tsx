import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppHeader from "../src/components/AppHeader";
import { useAuth } from "../src/auth/AuthContext";

// Partial mock, same pattern as ProtectedRoute.test.tsx: keep the real
// AuthContext module intact, replace `useAuth` with a `vi.fn()` so this test
// can drive `logout()` directly without a real boot-refresh cycle.
vi.mock("../src/auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/AuthContext")>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

const mockUseAuth = vi.mocked(useAuth);

function renderHeader(logout = vi.fn().mockResolvedValue(undefined)) {
  mockUseAuth.mockReturnValue({
    accessToken: "token-abc",
    orgContext: "auto",
    orgs: [],
    isInitializing: false,
    login: vi.fn(),
    logout,
  });

  return { ...render(
    <MemoryRouter>
      <AppHeader />
    </MemoryRouter>,
  ), logout };
}

describe("AppHeader", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the TestNexa brand and a Log out button", () => {
    renderHeader();

    expect(screen.getByText("TestNexa")).toBeInTheDocument();
    expect(screen.getByTestId("logout-button")).toBeInTheDocument();
    expect(screen.getByTestId("logout-button")).toHaveTextContent(/log out/i);
  });

  it("calls useAuth().logout() when the Log out button is clicked", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    renderHeader(logout);

    fireEvent.click(screen.getByTestId("logout-button"));

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
