import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppShell from "./app-shell";
import { useAuth } from "../../auth/AuthContext";

// Partial mock, same pattern as AppHeader.test.tsx: keep the real
// AuthContext module intact, replace `useAuth` with a `vi.fn()` so this test
// can render `AppShell` (which mounts `AppHeader`) without a real boot-refresh
// cycle.
vi.mock("../../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../auth/AuthContext")>();
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

  // SHELL-9 (ADR-0050): `AppShell` mounts `AppSidebar`/`AppBreadcrumb`, both of
  // which now call `useResolvedOrgId()` -> `useQuery`, so this tree needs a
  // `QueryClientProvider` exactly like the real app's `main.tsx` supplies. This
  // route is org-scoped, so the hook short-circuits without ever fetching — the
  // provider is required for the hook to *mount*, not for any network call.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/orgs/org-1"]}>
        <Routes>
          <Route path="/orgs/:orgId" element={<AppShell>{"page content"}</AppShell>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AppShell", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the sidebar, header, and page content together", () => {
    renderShell();

    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("logout-button")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-org-home")).toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  // ADR-0054: Tabler's `.page` layout has no CSS-grid named areas the way
  // AdminLTE's `.app-wrapper` did — this asserts the DOM order/nesting the
  // Tabler "Sidebar layout" doc requires instead: the vertical navbar and
  // `.page-wrapper` are direct children of `.page` (aside first), and
  // header/main/footer are, in order, direct children of `.page-wrapper`.
  it("renders aside + page-wrapper as direct children of .page, in the Tabler-required order", () => {
    const { container } = renderShell();

    const page = container.querySelector(":scope > .page") ?? container.querySelector(".page");
    expect(page).not.toBeNull();

    const children = Array.from(page!.children);
    expect(children[0]).toHaveClass("navbar-vertical");
    expect(children[1]).toHaveClass("page-wrapper");

    const pageWrapper = children[1];
    const wrapperChildren = Array.from(pageWrapper.children);
    expect(wrapperChildren[0].tagName).toBe("HEADER");
    expect(wrapperChildren[1].tagName).toBe("MAIN");
    expect(wrapperChildren[1]).toHaveClass("page-body");
    expect(wrapperChildren[2].tagName).toBe("FOOTER");

    // The breadcrumb/content regions must be INSIDE `main.page-body`.
    const main = wrapperChildren[1];
    expect(main.querySelector(".app-content-header")).not.toBeNull();
    expect(main.querySelector(".app-content")).not.toBeNull();
  });

  // ADR-0054: no CSS-grid off-canvas sidebar and no `.sidebar-overlay` scrim
  // — Tabler's vertical navbar collapses its own `.navbar-collapse` in
  // normal flow, so there's nothing to click outside of to dismiss.
  it("renders no .sidebar-overlay (retired with the AdminLTE grid shell)", () => {
    const { container } = renderShell();

    expect(container.querySelector(".sidebar-overlay")).toBeNull();
  });

  it("toggles the sidebar's mobile-open state (a local prop, not a body class) when the header toggler is clicked", () => {
    renderShell();

    const sidebarMenu = document.getElementById("sidebar-menu");
    expect(sidebarMenu).not.toBeNull();
    expect(sidebarMenu).not.toHaveClass("show");

    fireEvent.click(screen.getByTestId("sidebar-toggler"));
    expect(sidebarMenu).toHaveClass("show");

    fireEvent.click(screen.getByTestId("sidebar-toggler"));
    expect(sidebarMenu).not.toHaveClass("show");
  });

  // ADR-0054: unlike AdminLTE's body-level classes (which leaked across
  // unmount and had to be manually cleaned up in a `useEffect`), Tabler's
  // shell writes nothing to `document.body` at all — `mobileOpen` is plain
  // component state, so there is nothing to leak.
  it("writes no layout classes to document.body (unlike the retired AdminLTE shell)", () => {
    const { unmount } = renderShell();

    for (const adminLteClass of [
      "layout-fixed",
      "sidebar-expand-lg",
      "sidebar-mini",
      "app-loaded",
      "sidebar-collapse",
      "sidebar-open",
    ]) {
      expect(document.body).not.toHaveClass(adminLteClass);
    }

    unmount();
    for (const adminLteClass of ["layout-fixed", "sidebar-expand-lg", "sidebar-mini", "app-loaded"]) {
      expect(document.body).not.toHaveClass(adminLteClass);
    }
  });
});
