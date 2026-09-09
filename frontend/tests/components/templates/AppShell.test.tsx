import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppShell from "../../../src/components/templates/app-shell";
import { useAuth } from "../../../src/auth/AuthContext";

// Partial mock, same pattern as AppHeader.test.tsx: keep the real
// AuthContext module intact, replace `useAuth` with a `vi.fn()` so this test
// can render `AppShell` (which mounts `AppHeader`) without a real boot-refresh
// cycle.
vi.mock("../../../src/auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/auth/AuthContext")>();
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

    expect(document.querySelector(".app-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("logout-button")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-org-home")).toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  // ADR-0042: `.app-wrapper` is a CSS grid whose four named areas
  // (`lte-app-sidebar`/`-header`/`-main`/`-footer`) are matched by the
  // `.app-sidebar`/`.app-header`/`.app-main`/`.app-footer` classes — any
  // intermediate wrapper element makes *that* element the grid item instead
  // and collapses the whole layout into normal flow. This asserts the
  // direct-child relationship specifically, not merely that the four exist.
  it("renders the four AdminLTE regions as DIRECT children of .app-wrapper", () => {
    const { container } = renderShell();

    const wrapper = container.querySelector(".app-wrapper");
    expect(wrapper).not.toBeNull();
    for (const region of [".app-header", ".app-sidebar", ".app-main", ".app-footer"]) {
      expect(wrapper!.querySelector(`:scope > ${region}`)).not.toBeNull();
    }
    // The breadcrumb/content regions are the inverse case: their compiled
    // selectors are `.app-main .app-content-header` / `.app-main .app-content`,
    // so they must be INSIDE `.app-main`, not siblings of it.
    const main = wrapper!.querySelector(":scope > .app-main")!;
    expect(main.querySelector(".app-content-header")).not.toBeNull();
    expect(main.querySelector(".app-content")).not.toBeNull();
  });

  // AdminLTE's push-menu.ts injects `.sidebar-overlay` itself at runtime; we
  // don't load that JS, so nothing creates it unless AppShell renders it.
  it("renders a .sidebar-overlay that collapses the sidebar when clicked", () => {
    const { container } = renderShell();

    const overlay = container.querySelector(".app-wrapper > .sidebar-overlay") as HTMLElement;
    expect(overlay).not.toBeNull();

    fireEvent.click(overlay);
    expect(document.body).toHaveClass("sidebar-collapse");
    expect(document.body).not.toHaveClass("sidebar-open");
  });

  it("owns the AdminLTE layout classes on <body> and removes every one on unmount", async () => {
    const { unmount } = renderShell();

    expect(document.body).toHaveClass("layout-fixed");
    expect(document.body).toHaveClass("sidebar-expand-lg");
    // SHELL-7 (ADR-0044).
    expect(document.body).toHaveClass("sidebar-mini");
    // `app-loaded` is added a frame after mount (while absent, AdminLTE forces
    // `transition: none`, which suppresses a first-paint slide).
    await waitFor(() => expect(document.body).toHaveClass("app-loaded"));

    unmount();

    // <body> is outside React's tree — a leaked class survives logout and, in
    // Vitest, the next test in this file.
    for (const leaked of [
      "layout-fixed",
      "sidebar-expand-lg",
      "sidebar-mini",
      "app-loaded",
      "sidebar-collapse",
      "sidebar-open",
    ]) {
      expect(document.body).not.toHaveClass(leaked);
    }
  });

  // TC-SHELL-022 (class-application half). The *width* half of that TC —
  // "the rail computes to AdminLTE's narrow width" — is deliberately NOT
  // asserted here: jsdom does no layout, so any `getBoundingClientRect()` in
  // this file would read 0 and prove nothing (root CLAUDE.md's CSS-layout
  // rule). It is covered live in `e2e/tests/shell7-sidebar-mini.spec.ts`.
  // What this layer CAN prove, and does, is that `sidebar-mini` is applied as
  // a constant base modifier — present from mount, surviving both directions
  // of the collapse toggle (it is not a state class), and removed on unmount
  // along with the rest (a leaked class outlives logout and, in Vitest, the
  // next test in this file).
  it("SHELL-7: sidebar-mini is a constant base class, unaffected by collapse/expand toggling", () => {
    renderShell();

    expect(document.body).toHaveClass("sidebar-mini");
    expect(document.body).not.toHaveClass("sidebar-collapse");

    fireEvent.click(screen.getByTestId("sidebar-toggler"));
    expect(document.body).toHaveClass("sidebar-collapse");
    // The whole point of the story: mini stays put, so "collapsed" now paints
    // as an icon rail rather than a hidden sidebar.
    expect(document.body).toHaveClass("sidebar-mini");

    fireEvent.click(screen.getByTestId("sidebar-toggler"));
    expect(document.body).not.toHaveClass("sidebar-collapse");
    expect(document.body).toHaveClass("sidebar-mini");
  });

  it("toggles AdminLTE's body-level sidebar state when the header toggler is clicked", () => {
    renderShell();

    // jsdom's `matchMedia` stub (tests/setup.ts) always reports `matches:
    // false`, i.e. a desktop viewport — where AdminLTE's push-menu defaults
    // the sidebar to EXPANDED, so neither state class is set at mount.
    expect(document.body).not.toHaveClass("sidebar-collapse");
    expect(document.body).not.toHaveClass("sidebar-open");

    // Desktop collapse adds `sidebar-collapse`; `sidebar-open` is a
    // mobile-only class and must stay off (the desktop/mobile asymmetry).
    fireEvent.click(screen.getByTestId("sidebar-toggler"));
    expect(document.body).toHaveClass("sidebar-collapse");
    expect(document.body).not.toHaveClass("sidebar-open");

    fireEvent.click(screen.getByTestId("sidebar-toggler"));
    expect(document.body).not.toHaveClass("sidebar-collapse");
    expect(document.body).not.toHaveClass("sidebar-open");
  });
});
