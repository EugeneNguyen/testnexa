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

  // ADR-0042: the header root moved from CoreUI's `.header` to AdminLTE's
  // `.app-header navbar navbar-expand`, which is one of `.app-wrapper`'s four
  // named CSS-grid areas. `data-lte-toggle="sidebar"` is AdminLTE's own
  // toggle-trigger attribute, kept for convention parity even though we don't
  // load the JS that listens for it (the React `onClick` above is what runs).
  it("renders the AdminLTE header shell contract", () => {
    const { container } = renderHeader();

    const header = container.querySelector("nav.app-header");
    expect(header).not.toBeNull();
    expect(header).toHaveClass("navbar", "navbar-expand");
    expect(container.querySelector(".header, .header-toggler, .header-brand")).toBeNull();

    expect(screen.getByTestId("sidebar-toggler")).toHaveAttribute("data-lte-toggle", "sidebar");
  });

  // FR-SHELL-4 / TC-SHELL-012's unit-level half. This is the migration's one
  // deliberate BREAKING change (ADR-0042 §4.3, matching
  // `admin-lte/src/ts/color-mode.ts`'s own `ATTRIBUTE_THEME`/`STORAGE_KEY`
  // constants): `<html data-coreui-theme>` → `<html data-bs-theme>`, and the
  // `coreui-react-color-scheme` localStorage key → `lte-theme`. Asserted here
  // because nothing at the unit layer covered it before — only the e2e spec
  // did, which meant the rename could have shipped unverified in CI.
  it("writes the chosen color mode to AdminLTE's data-bs-theme attribute and lte-theme key", () => {
    renderHeader();

    fireEvent.click(screen.getByTestId("color-mode-toggle"));
    fireEvent.click(screen.getByTestId("color-mode-dark"));

    expect(document.documentElement).toHaveAttribute("data-bs-theme", "dark");
    expect(localStorage.getItem("lte-theme")).toBe("dark");
    // The retired CoreUI names must be gone, not merely shadowed.
    expect(document.documentElement.hasAttribute("data-coreui-theme")).toBe(false);
    expect(localStorage.getItem("coreui-react-color-scheme")).toBeNull();

    fireEvent.click(screen.getByTestId("color-mode-toggle"));
    fireEvent.click(screen.getByTestId("color-mode-light"));

    expect(document.documentElement).toHaveAttribute("data-bs-theme", "light");
    expect(localStorage.getItem("lte-theme")).toBe("light");
  });

  // "auto" stays a distinct stored choice, resolved through
  // `prefers-color-scheme`. Characterization note: the resolution is
  // one-sided — `applyColorMode` writes "dark" only when the media query
  // matches and otherwise writes the raw mode through, so a non-dark system
  // yields the literal `data-bs-theme="auto"` rather than "light". That is
  // the pre-existing behavior of the `useColorModes` port (it wrote
  // `data-coreui-theme="auto"` the same way) and is deliberately NOT changed
  // by the ADR-0042 rename, which only retargets the attribute/key names.
  // jsdom's matchMedia stub (tests/setup.ts) always reports no match.
  it("keeps 'auto' as a distinct stored choice resolved via prefers-color-scheme", () => {
    renderHeader();

    fireEvent.click(screen.getByTestId("color-mode-toggle"));
    fireEvent.click(screen.getByTestId("color-mode-auto"));

    expect(localStorage.getItem("lte-theme")).toBe("auto");
    expect(document.documentElement).toHaveAttribute("data-bs-theme", "auto");
  });
});
