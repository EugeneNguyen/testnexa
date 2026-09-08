/**
 * SHELL-1 (ADR-0018) admin shell: composes `AppSidebar` + `AppHeader` +
 * `AppBreadcrumb` + `AppFooter` + page content, replacing AUTH-3's bare
 * `<AppHeader/>{children}` mount in `ProtectedRoute`.
 *
 * ## AdminLTE v4 (ADR-0042) — what replaced the CoreUI composition
 *
 * The whole shell is now AdminLTE v4's `.app-wrapper` CSS grid, not a
 * `d-flex` row wrapping a `flex-column` content column:
 *
 *   .app-wrapper { display: grid;
 *     grid-template-areas: "lte-app-sidebar lte-app-header"
 *                          "lte-app-sidebar lte-app-main"
 *                          "lte-app-sidebar lte-app-footer";
 *     grid-template-rows: min-content 1fr min-content;
 *     grid-template-columns: auto 1fr; min-height: 100vh; }
 *
 * `.app-header` / `.app-sidebar` / `.app-main` / `.app-footer` each claim one
 * of those named grid areas, so **all four must be direct children of
 * `.app-wrapper`** — any intermediate wrapper div breaks the grid placement
 * entirely (the child would become the grid item and the four regions would
 * stack in normal flow). DOM order among them does not matter; the grid
 * places them. `.app-content-header` (breadcrumb) and `.app-content` (page
 * content) are compiled as `.app-main .app-content-header` / `.app-main
 * .app-content`, so they must be *inside* `.app-main`, not siblings of it.
 *
 * ### Historical note — why the CoreUI version looked the way it did
 *
 * The pre-ADR-0042 version owned a `sidebarVisible` boolean and round-tripped
 * `CSidebar`'s `onVisibleChange` back into it, because `CSidebar` forced
 * itself closed on a mobile-breakpoint transition and derived that from an
 * `isInViewport(element)` geometry check (`getBoundingClientRect()` vs.
 * `window.innerHeight`), which in turn required `AppSidebar` to carry
 * `vh-100` so a `d-flex` row's `align-items: stretch` couldn't grow the
 * sidebar taller than the viewport and make the geometry check report "not
 * visible" on every scrollable page. None of that survives: AdminLTE's grid
 * gives the sidebar its own row-spanning area with no stretch coupling to a
 * sibling column, `vh-100` is gone, and the sidebar's open/closed state is no
 * longer a prop on the sidebar element at all (see below). The reasoning is
 * kept here because it explains why the old shape existed, not because any of
 * it still applies.
 *
 * ## Sidebar state lives on `<body>`, not on the sidebar element
 *
 * AdminLTE's `push-menu.ts` keeps sidebar state in classes on
 * `document.body`, and its CSS reads them from there
 * (`.sidebar-expand-lg.sidebar-open .app-sidebar { margin-left: 0 }`). Since
 * this SPA's `#root` sits *inside* `<body>`, JSX cannot express those classes
 * — they are written with a `useEffect` against `document.body.classList` and
 * **removed again on unmount**: `<body>` is outside React's tree, so a leaked
 * class survives a logout, a route change, and (in Vitest) the next test in
 * the same file.
 *
 * We do NOT load AdminLTE's own JS (ADR-0042 ground rule: no jQuery, no
 * vendored plugin bundle), so the state machine below is a faithful React
 * port of `push-menu.ts`'s own methods, read from that file's source:
 * - `expand()`  — remove `sidebar-collapse`; **add `sidebar-open` only when
 *   mobile** (it is a no-op class above the breakpoint).
 * - `collapse()` — remove `sidebar-open`, add `sidebar-collapse`.
 * - `toggle()`  — `expand()` if currently collapsed, else `collapse()`.
 * - `updateStateByResponsiveLogic()` — on mobile, collapse unless explicitly
 *   open; on desktop, expand unless (mini && collapsed). We never set
 *   `sidebar-mini`, so the desktop branch always expands.
 *
 * **The desktop/mobile asymmetry is the trap here**: desktop defaults *open*
 * (closing it means adding `sidebar-collapse`), mobile defaults *closed*
 * (opening it means adding `sidebar-open`). It is one boolean pair, not two
 * independent switches, and the initial state itself is whatever
 * `updateStateByResponsiveLogic()` decides at mount — exactly what
 * `push-menu.ts`'s `init()` does.
 *
 * Breakpoint changes are observed with `matchMedia("(max-width: 991.98px)")`
 * + its `change` event, **not a raw `resize` handler** — same choice
 * `push-menu.ts` makes, and for its own stated reason: `matchMedia` fires
 * only on an actual crossing, so a height-only resize (mobile URL bar, soft
 * keyboard) or a same-side width change never clobbers a state the user
 * chose. 991.98px is AdminLTE's own `sidebarBreakpoint` default and the value
 * `.sidebar-expand-lg::before` publishes as `content: "991.98px"`.
 *
 * `.sidebar-overlay` (the mobile click-outside-to-close scrim) is normally
 * *injected at runtime* by `push-menu.ts` into `.app-wrapper`. We don't load
 * that JS, so nothing creates it unless we render it — it is the last child
 * of `.app-wrapper` below, with an `onClick` that collapses. It is invisible
 * except under `.sidebar-expand-lg.sidebar-open` at mobile widths.
 *
 * `app-loaded` is added a frame after mount rather than in the same commit:
 * while it is absent, AdminLTE forces `transition: none` on all four regions
 * (`body:not(.app-loaded) .app-header, …`), which conveniently suppresses a
 * first-paint slide of the off-canvas sidebar as `sidebar-expand-lg` lands.
 *
 * ## Page content is deliberately NOT wrapped in a container here
 *
 * Pixel-parity note (2026-09-07), still load-bearing under AdminLTE: this
 * component does not wrap `{children}` in a `container`/`container-fluid`.
 * Each page owns its own `<div className="container-fluid px-4">` (see
 * `AppBreadcrumb.tsx`'s docstring for why `fluid` specifically). Several
 * pages (`OrgHome`, `OrgMembers`, `ProjectDetail`, `TestPlanDetail`,
 * `TestCycleDetail`) paint a full-bleed `min-vh-100 bg-body-secondary`
 * background *outside* their own container — wrapping `{children}` in a
 * container at this level would nest that background inside the container's
 * padding, shrinking the painted area rather than just the content.
 * `.app-content` itself contributes only `padding: 0 .5rem`, which does not
 * change that conclusion (it insets a full-bleed background by 8px per side,
 * a cosmetic delta, not the containment regression the container would be).
 *
 * `flex-grow-1` on `.app-content` preserves DASH-2's content-fills-the-column
 * behavior: `.app-main` is `display: flex; flex-direction: column` and is
 * stretched by the grid to the `1fr` row, so `flex-grow-1` gives the content
 * area a *definite* height for pages that size themselves with `h-100`
 * against it (see `frontend/CLAUDE.md`'s `h-100`-vs-flex note). Without it
 * `.app-content` would be content-height and those pages would silently stop
 * filling.
 */
import { ReactNode, useCallback, useEffect, useState } from "react";
import AppBreadcrumb from "../../organisms/app-breadcrumb";
import AppFooter from "../../organisms/app-footer";
import AppHeader from "../../organisms/app-header";
import AppSidebar from "../../organisms/app-sidebar";

/**
 * AdminLTE's own `sidebarBreakpoint` default (`push-menu.ts`), and the value
 * `.sidebar-expand-lg::before` publishes as `content: "991.98px"`. The `.98`
 * is deliberate: it matches the Bootstrap `breakpoint-max = breakpoint - .02`
 * convention so a viewport of exactly 992px is "desktop" to both CSS and JS.
 */
const MOBILE_MEDIA_QUERY = "(max-width: 991.98px)";

/** Layout modifiers that are constant for this app's whole shell lifetime. */
const BASE_BODY_CLASSES = ["layout-fixed", "sidebar-expand-lg"] as const;

/** State classes written per-transition; also part of the unmount cleanup. */
const STATE_BODY_CLASSES = ["sidebar-collapse", "sidebar-open"] as const;

/**
 * The two independent flags `push-menu.ts` keeps on `<body>`. Modelled as one
 * object so a transition can set both atomically — `collapse()` must clear
 * `open` in the same update, not in a follow-up effect.
 */
interface SidebarState {
  collapsed: boolean;
  open: boolean;
}

function isMobileViewport(): boolean {
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

/** `PushMenu.expand()` — note `sidebar-open` is added on mobile only. */
function expand(state: SidebarState): SidebarState {
  return { collapsed: false, open: isMobileViewport() ? true : state.open };
}

/** `PushMenu.collapse()`. */
function collapse(): SidebarState {
  return { collapsed: true, open: false };
}

/**
 * `PushMenu.updateStateByResponsiveLogic()`. The `isMiniMode() && isCollapsed()`
 * guard on the desktop branch is inlined as "always expand" because this app
 * never sets `sidebar-mini`; kept named here so the correspondence to the
 * upstream method is greppable.
 */
function applyResponsiveLogic(state: SidebarState): SidebarState {
  if (isMobileViewport()) {
    return state.open ? state : collapse();
  }
  return expand(state);
}

interface AppShellProps {
  children: ReactNode;
}

function AppShell({ children }: AppShellProps) {
  // Same initial resolution as `PushMenu.init()`: persistence is off, nothing
  // is collapsed yet, so the responsive logic decides — expanded on desktop,
  // collapsed on mobile.
  const [sidebar, setSidebar] = useState<SidebarState>(() =>
    applyResponsiveLogic({ collapsed: false, open: false }),
  );

  const toggleSidebar = useCallback(() => {
    setSidebar((prev) => (prev.collapsed ? expand(prev) : collapse()));
  }, []);

  const collapseSidebar = useCallback(() => {
    setSidebar(collapse());
  }, []);

  // Base layout modifiers + `app-loaded`. Separate from the state-class effect
  // below so the state classes can churn on every toggle without re-adding
  // (and re-animating) the base ones.
  useEffect(() => {
    const { body } = document;
    body.classList.add(...BASE_BODY_CLASSES);
    // A frame later, not in this same commit: while `app-loaded` is absent
    // AdminLTE forces `transition: none`, so deferring it swallows the
    // first-paint slide caused by `sidebar-expand-lg` landing.
    const frame = requestAnimationFrame(() => body.classList.add("app-loaded"));
    return () => {
      cancelAnimationFrame(frame);
      body.classList.remove(...BASE_BODY_CLASSES, "app-loaded", ...STATE_BODY_CLASSES);
    };
  }, []);

  useEffect(() => {
    const { body } = document;
    body.classList.toggle("sidebar-collapse", sidebar.collapsed);
    body.classList.toggle("sidebar-open", sidebar.open);
  }, [sidebar]);

  useEffect(() => {
    const query = window.matchMedia(MOBILE_MEDIA_QUERY);
    function handleBreakpointChange() {
      setSidebar((prev) => applyResponsiveLogic(prev));
    }
    query.addEventListener("change", handleBreakpointChange);
    return () => query.removeEventListener("change", handleBreakpointChange);
  }, []);

  return (
    <div className="app-wrapper">
      <AppHeader onToggleSidebar={toggleSidebar} />
      <AppSidebar />
      <main className="app-main">
        <div className="app-content-header">
          <AppBreadcrumb />
        </div>
        <div className="app-content flex-grow-1">{children}</div>
      </main>
      <AppFooter />
      {/* AdminLTE's push-menu.ts injects this node itself at runtime; we don't
          load that JS, so it exists only because it is rendered here. Must be
          a direct child of `.app-wrapper` (its compiled selector is
          `.sidebar-expand-lg.sidebar-open .sidebar-overlay`). */}
      <div className="sidebar-overlay" onClick={collapseSidebar} />
    </div>
  );
}

export default AppShell;
