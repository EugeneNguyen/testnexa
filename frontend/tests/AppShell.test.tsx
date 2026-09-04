import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppShell from "../src/components/AppShell";
import { useAuth } from "../src/auth/AuthContext";

// Partial mock, same pattern as AppHeader.test.tsx: keep the real
// AuthContext module intact, replace `useAuth` with a `vi.fn()` so this test
// can render `AppShell` (which mounts `AppHeader`) without a real boot-refresh
// cycle.
vi.mock("../src/auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/AuthContext")>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

const mockUseAuth = vi.mocked(useAuth);

function renderShell() {
  mockUseAuth.mockReturnValue({
    accessToken: "token-abc",
    orgContext: "auto",
    orgs: [],
    isInitializing: false,
    login: vi.fn(),
    signup: vi.fn(),
    acceptInvite: vi.fn(),
    logout: vi.fn(),
  });

  return render(
    <MemoryRouter initialEntries={["/orgs/org-1"]}>
      <Routes>
        <Route path="/orgs/:orgId" element={<AppShell>{"page content"}</AppShell>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppShell", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the sidebar, header, and page content together", () => {
    renderShell();

    expect(document.querySelector(".sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("logout-button")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-org-home")).toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("flips the sidebar's visible state when the header toggler is clicked", () => {
    renderShell();

    const sidebar = document.querySelector(".sidebar") as HTMLElement;
    // Sidebar starts visible: CSidebar's own `hide` class is absent.
    expect(sidebar.className).not.toMatch(/\bhide\b/);

    fireEvent.click(screen.getByTestId("sidebar-toggler"));
    expect(sidebar.className).toMatch(/\bhide\b/);

    fireEvent.click(screen.getByTestId("sidebar-toggler"));
    expect(sidebar.className).not.toMatch(/\bhide\b/);
  });
});
