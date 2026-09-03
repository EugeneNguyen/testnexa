import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProtectedRoute from "../../src/auth/ProtectedRoute";
import { useAuth } from "../../src/auth/AuthContext";

// Partial mock: keep AuthProvider (unused here) intact, replace `useAuth` with
// a `vi.fn()` so each test can drive `isInitializing`/`accessToken` directly
// without spinning up a real boot-refresh cycle (that's AuthContext.test.tsx's
// job).
vi.mock("../../src/auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/auth/AuthContext")>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

const mockUseAuth = vi.mocked(useAuth);

function mockAuth(overrides: Partial<ReturnType<typeof useAuth>>) {
  mockUseAuth.mockReturnValue({
    accessToken: null,
    orgContext: null,
    orgs: [],
    isInitializing: false,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  });
}

function renderProtected() {
  return render(
    <MemoryRouter initialEntries={["/protected"]}>
      <Routes>
        <Route
          path="/protected"
          element={
            <ProtectedRoute>
              <div>Protected content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders a loading spinner while isInitializing", () => {
    mockAuth({ isInitializing: true, accessToken: null });

    renderProtected();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
  });

  it("renders children once initialized and authenticated", () => {
    mockAuth({ isInitializing: false, accessToken: "token-abc" });

    renderProtected();

    expect(screen.getByText("Protected content")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("redirects to /login once initialized and unauthenticated", () => {
    mockAuth({ isInitializing: false, accessToken: null });

    renderProtected();

    expect(screen.getByText("Login page")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });
});
