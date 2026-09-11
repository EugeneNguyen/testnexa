import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppHeader from ".";
import { useAuth } from "../../../auth/AuthContext";

// Partial mock, same pattern as ProtectedRoute.test.tsx: keep the real
// AuthContext module intact, replace `useAuth` with a `vi.fn()` so this test
// can drive `logout()` directly without a real boot-refresh cycle.
vi.mock("../../../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../auth/AuthContext")>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

const mockUseAuth = vi.mocked(useAuth);

function renderHeader(
  logout = vi.fn().mockResolvedValue(undefined),
  onToggleSidebar = vi.fn(),
) {
  mockUseAuth.mockReturnValue({
    accessToken: "token-abc",
    orgContext: "auto",
    orgs: [],
    isInitializing: false,
    login: vi.fn(),
    signup: vi.fn(),
    acceptInvite: vi.fn(),
    logout,
  });

  return {
    ...render(
      <MemoryRouter>
        <AppHeader onToggleSidebar={onToggleSidebar} />
      </MemoryRouter>,
    ),
    logout,
    onToggleSidebar,
  };
}

describe("AppHeader", () => {
  afterEach(() => {
    vi.clearAllMocks();
    // The color-mode hook writes to <html> and localStorage, neither of which
    // RTL's own cleanup touches — reset both so test order can't leak a theme.
    document.documentElement.removeAttribute("data-bs-theme");
    localStorage.clear();
  });

  // TC-DS-026 (BRAND-1, ADR-0048 Decision §7 — revised 2026-09-09, direct CTO
  // instruction). BRAND-1 originally put the small mark here; that was
  // reversed the same day after a manual look at the running app — the
  // sidebar (always visible) is now the single source of the brand mark, and
  // the header carries none at all. This asserts the negative explicitly
  // (not just "no crash") so a future re-add doesn't silently duplicate the
  // sidebar's own mark without anyone noticing.
  it("TC-DS-026: renders no brand mark/link (sidebar is the sole brand mount) and a Log out button", () => {
    renderHeader();

    expect(screen.queryByRole("link", { name: /TestNexa home/i })).toBeNull();
    expect(screen.queryByTestId("brand-logo")).toBeNull();
    expect(screen.queryByTestId("brand-logo-mark")).toBeNull();
    expect(screen.queryByText("TestNexa")).toBeNull();

    expect(screen.getByTestId("logout-button")).toBeInTheDocument();
    expect(screen.getByTestId("logout-button")).toHaveTextContent(/log out/i);
  });

  it("calls useAuth().logout() when the Log out button is clicked", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    renderHeader(logout);

    fireEvent.click(screen.getByTestId("logout-button"));

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("calls the onToggleSidebar prop when the sidebar toggler is clicked", () => {
    const onToggleSidebar = vi.fn();
    renderHeader(undefined, onToggleSidebar);

    expect(screen.getByTestId("sidebar-toggler")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("sidebar-toggler"));

    expect(onToggleSidebar).toHaveBeenCalledTimes(1);
  });

  // ADR-0054: the header root moved from AdminLTE's `.app-header navbar
  // navbar-expand` to Tabler's own `header.navbar.navbar-expand-md
  // d-print-none` — no `data-lte-toggle` attribute at all now (this
  // button's state is fully React-owned; not setting a `data-bs-toggle`
  // attribute is what keeps Tabler's own loaded JS from also reacting to
  // this click, per ADR-0054's own duplicate-listener note).
  it("renders the Tabler header shell contract", () => {
    const { container } = renderHeader();

    const header = container.querySelector("header.navbar");
    expect(header).not.toBeNull();
    expect(header).toHaveClass("navbar-expand-md", "d-print-none");
    expect(container.querySelector(".app-header")).toBeNull();

    expect(screen.getByTestId("sidebar-toggler")).not.toHaveAttribute("data-lte-toggle");
    expect(screen.getByTestId("sidebar-toggler")).not.toHaveAttribute("data-bs-toggle");
    expect(screen.getByTestId("sidebar-toggler")).toHaveClass("navbar-toggler");
  });

  // FR-SHELL-4 / TC-SHELL-012's unit-level half. ADR-0054 renames the
  // storage key a second time (AdminLTE's `lte-theme` → Tabler's own
  // documented `tabler-theme` convention); the `data-bs-theme` attribute
  // itself is unchanged — both AdminLTE and Tabler are Bootstrap-5-based and
  // read the same attribute.
  it("writes the chosen color mode to data-bs-theme and the tabler-theme key", () => {
    renderHeader();

    fireEvent.click(screen.getByTestId("color-mode-toggle"));
    fireEvent.click(screen.getByTestId("color-mode-dark"));

    expect(document.documentElement).toHaveAttribute("data-bs-theme", "dark");
    expect(localStorage.getItem("tabler-theme")).toBe("dark");
    // The retired AdminLTE key must be gone, not merely shadowed.
    expect(localStorage.getItem("lte-theme")).toBeNull();

    fireEvent.click(screen.getByTestId("color-mode-toggle"));
    fireEvent.click(screen.getByTestId("color-mode-light"));

    expect(document.documentElement).toHaveAttribute("data-bs-theme", "light");
    expect(localStorage.getItem("tabler-theme")).toBe("light");
  });

  // "auto" stays a distinct stored choice, resolved through
  // `prefers-color-scheme`. Characterization note: the resolution is
  // one-sided — `applyColorMode` writes "dark" only when the media query
  // matches and otherwise writes the raw mode through, so a non-dark system
  // yields the literal `data-bs-theme="auto"` rather than "light". Unchanged
  // by ADR-0054's rename, which only retargets the storage key name.
  // jsdom's matchMedia stub (tests/setup.ts) always reports no match.
  it("keeps 'auto' as a distinct stored choice resolved via prefers-color-scheme", () => {
    renderHeader();

    fireEvent.click(screen.getByTestId("color-mode-toggle"));
    fireEvent.click(screen.getByTestId("color-mode-auto"));

    expect(localStorage.getItem("tabler-theme")).toBe("auto");
    expect(document.documentElement).toHaveAttribute("data-bs-theme", "auto");
  });
});
