/**
 * AUTH-3 app header, mounted once inside `AppShell` (via `ProtectedRoute`)
 * so every current and future protected page gets it for free without
 * wiring its own button (scope plan §1/§4.3). Brand label + sidebar
 * toggler + "Log out" button — no breadcrumbs or user-menu dropdown
 * (explicitly out-of-scope, see the AUTH-3 scope plan §1).
 *
 * SHELL-1 (ADR-0018) adds the sidebar toggler button: calls the
 * `onToggleSidebar` handler `AppShell` owns and passes down, flipping
 * `AppSidebar`'s `visible` state.
 *
 * Clicking "Log out" calls `useAuth().logout()` (clears the token store +
 * org state, best-effort revokes the server-side refresh token — see
 * `AuthContext.tsx`/ADR-0014) and then navigates to `/login` via React
 * Router, matching `ProtectedRoute`'s client-side `<Navigate>` style rather
 * than `apiFetch`'s hard `window.location.assign` redirect (scope plan §1).
 *
 * SHELL-4 (ADR-0020, FR-SHELL-4/NFR-28) adds the dark/light color-mode
 * toggle: three explicit choices (Light/Dark/Auto), matching CoreUI's own
 * free-template header control and the test-design's 3 distinct
 * equivalence classes (unset/auto vs. explicit light vs. explicit dark) —
 * not a single 2-state flip button.
 *
 * SHELL-6 (ADR-0036, FR-SHELL-6/FR-AUTH-5) adds the organization-switcher
 * dropdown, immediately to the LEFT of the color-mode toggle (UI Design
 * Document §2's header order: toggler → brand → *spacer* → org switcher →
 * color mode → log out). Three deliberate behaviours, each with its own
 * test case, all of which would be easy to "simplify" away later:
 *
 * 1. **Lazy, uncached fetch** (TC-SHELL-016). Fires on open — never on
 *    mount, and never reused between opens: each open resets to a loading
 *    state and issues a fresh request. Deliberately NOT read from
 *    `AuthContext.orgs`, which is populated only by
 *    `login()`/`signup()`/`acceptInvite()` and is therefore empty after any
 *    page reload (the AUTH-2 gap ADR-0035 deferred). A header control
 *    present on every protected screen must survive a reload, so it owns
 *    its own fetch. ADR-0036 accepts the extra request per open as the
 *    cost of not having a cache-invalidation story yet.
 * 2. **Always rendered**, even at exactly one org (TC-SHELL-019) — no
 *    conditional hide/disable, which would otherwise shift the header
 *    layout as a side effect of how many orgs an account happens to have.
 * 3. **Empty and error states are distinct** (TC-SHELL-020): "No
 *    organizations" vs. "Couldn't load organizations". A failed fetch must
 *    never render as an empty list masquerading as "you have no orgs".
 *
 * Switching always navigates to the target org's ROOT (`/orgs/{id}`), never
 * an attempt to carry the current nested sub-route across (ADR-0036): a
 * nested resource id (project, test plan, ...) has no meaning in a different
 * org. The target org's own screens re-check permissions server-side on
 * their next fetch — there is no client-side permission cache to invalidate.
 *
 * Raw HTML per ADR-0037 (2026-09-07), not `@coreui/react` — this file
 * originally used `CDropdown`/`CDropdownToggle`/`CDropdownMenu`/
 * `CDropdownItem`/`CTooltip`/`CHeader`/`CHeaderBrand`/`CHeaderToggler`/
 * `CContainer`/`CButton`/`useColorModes`; every class name below was the exact
 * class those components rendered, confirmed by dumping their actual DOM
 * before removing the import:
 * - `useColorModes` (a `@coreui/react` hook) is replaced with `useColorMode`
 *   below, a faithful line-for-line port of that hook's own source (same
 *   `prefers-color-scheme` media-query listener for "auto", same
 *   read-storage-then-fall-back-to-system resolution) — not a
 *   simplification, just no longer imported from the library.
 * - Both dropdowns (color-mode, org-switcher) become a hand-rolled
 *   `useState` open/closed boolean toggling Bootstrap's own
 *   `.dropdown-menu.show` class (the same class `CDropdownMenu` itself
 *   toggled) plus a document-level click-outside listener to close each —
 *   deliberately NOT wired to `bootstrap.bundle.js`'s real `Dropdown` class
 *   (ADR-0037 floated that option): managing a vanilla-JS component
 *   instance's lifecycle (init on mount, dispose on unmount, ref plumbing)
 *   inside React is a well-known sharp edge for exactly this kind of small
 *   interaction, and a plain boolean toggle is both simpler and has an
 *   identical visual/behavioral result here. Closing the org-switcher also
 *   resets its fetch state to `idle` (same as `CDropdown`'s `onHide` did),
 *   preserving TC-SHELL-016's "no caching across opens" behaviour.
 * - The current-org row's `disabled` state is a literal `disabled` CSS
 *   class (Bootstrap's `.dropdown-item.disabled`), not an HTML `disabled`
 *   attribute — `<a>`/`<li>` have no native disabled semantics, and
 *   `CDropdownItem`'s own `disabled` prop rendered the class, not the
 *   attribute (confirmed via the same DOM dump); the existing unit tests
 *   assert `toHaveClass("disabled")`, not `toBeDisabled()`, for this reason.
 * - `CTooltip` (the org-switcher trigger's "Switch organization" hint) is a
 *   native `title` attribute instead of a hand-rolled Popper-positioned
 *   tooltip — no test (unit or e2e) asserts on the tooltip's own rendering,
 *   only on `aria-label`/`data-testid`, so reimplementing hover-positioning
 *   logic by hand would be pure risk for a behaviour nothing here verifies.
 * ## AdminLTE v4 (ADR-0042) — what changed
 *
 * - **The header root is `.app-header navbar navbar-expand`**, not CoreUI's
 *   `.header`. It is a direct child of `AppShell`'s `.app-wrapper` CSS grid
 *   and claims the `lte-app-header` grid area; an intermediate wrapper div
 *   would break that placement (see `AppShell.tsx`'s docstring).
 * - **The sidebar toggler no longer flips a prop on `AppSidebar`.** AdminLTE
 *   keeps sidebar state in `sidebar-collapse`/`sidebar-open` classes on
 *   `document.body`, so the button calls a handler `AppShell` owns and
 *   `AppShell` writes those classes. `data-lte-toggle="sidebar"` is kept on
 *   the button for convention parity with AdminLTE's own delegated listener
 *   — nothing is actually listening for it, because we don't load that JS.
 * - **Color mode is a deliberate breaking change**, not a rename for
 *   tidiness (ADR-0042 §4.3, matching `admin-lte/src/ts/color-mode.ts`'s own
 *   constants): the attribute written to `<html>` is **`data-bs-theme`** (was
 *   `data-coreui-theme`) and the `localStorage` key is **`lte-theme`** (was
 *   `coreui-react-color-scheme`). A user who had picked a theme before this
 *   migration therefore falls back to their system preference once, on their
 *   next visit, and re-picks — accepted, since the alternative (reading the
 *   old key as a fallback) would leave a dead CoreUI-named key in storage
 *   forever for a one-click cost. The three choices, their `data-testid`s and
 *   the `auto` → `prefers-color-scheme` resolution are all unchanged.
 * - **Icons are Font Awesome classes on an `<i>`**, not `CIcon` + a path
 *   array (ADR-0042 §3.2): `cilMenu`→`fa-bars`, `cilBuilding`→`fa-building`,
 *   `cilSun`→`fa-sun`, `cilMoon`→`fa-moon`,
 *   `cilContrast`→`fa-circle-half-stroke`. `size="lg"` → FA's own `fa-lg`.
 *   Each is `aria-hidden` — the buttons carry their own `aria-label`.
 *
 * Everything else in this file is deliberately unchanged, including the three
 * org-switcher behaviours enumerated above and the `.dropdown`/`.dropdown-menu`/
 * `.dropdown-item` markup — those are stock Bootstrap 5 classes, which
 * AdminLTE v4 is built on, so they need no translation at all.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../../auth/AuthContext";
import { getMyOrgs, type OrgSummary } from "../../../lib/api/auth";
import { BrandLogo } from "../../atoms/brand-logo";
import { Button } from "../../atoms/button";

interface AppHeaderProps {
  onToggleSidebar: () => void;
}

type ColorMode = "light" | "dark" | "auto";

/** `admin-lte/src/ts/color-mode.ts`'s own `STORAGE_KEY` constant. */
const COLOR_MODE_STORAGE_KEY = "lte-theme";

/** `admin-lte/src/ts/color-mode.ts`'s own `ATTRIBUTE_THEME` constant. */
const COLOR_MODE_ATTRIBUTE = "data-bs-theme";

const COLOR_MODE_ICON: Record<ColorMode, string> = {
  light: "fa-solid fa-sun",
  dark: "fa-solid fa-moon",
  auto: "fa-solid fa-circle-half-stroke",
};

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getStoredColorMode(): ColorMode | null {
  const stored = localStorage.getItem(COLOR_MODE_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : null;
}

function applyColorMode(mode: ColorMode) {
  document.documentElement.setAttribute(
    COLOR_MODE_ATTRIBUTE,
    mode === "auto" && prefersDark() ? "dark" : mode,
  );
}

/**
 * Faithful port of `@coreui/react`'s `useColorModes` hook, retargeted at
 * AdminLTE's own storage key/attribute — see this file's own docstring.
 */
function useColorMode() {
  const [colorMode, setColorMode] = useState<ColorMode>(() => getStoredColorMode() ?? (prefersDark() ? "dark" : "light"));

  useEffect(() => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, colorMode);
    applyColorMode(colorMode);
  }, [colorMode]);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange() {
      const stored = getStoredColorMode();
      if (stored !== "light" && stored !== "dark") {
        applyColorMode(colorMode);
      }
    }
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [colorMode]);

  return { colorMode, setColorMode };
}

/**
 * The org-list request's lifecycle. `idle` is the pre-first-open state and
 * is what every close resets to — modelling "not yet fetched" separately
 * from "fetched and empty" is what keeps TC-SHELL-020's two states honest.
 */
type OrgListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; orgs: OrgSummary[] }
  | { status: "error" };

/**
 * Shared shape for both header dropdowns (color-mode, org-switcher): an
 * open/closed boolean plus a ref-scoped document click-outside listener.
 * Extracted once both dropdowns needed the identical pattern rather than
 * duplicating the effect twice.
 */
function useDropdown<T extends HTMLElement>(onClose?: () => void) {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        onClose?.();
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose is a
    // fresh closure every render by design (it closes over per-render
    // state); re-subscribing on every render would be wasteful and isn't
    // needed since it only reads refs/setters that are stable.
  }, [open]);

  return { open, setOpen, ref };
}

function AppHeader({ onToggleSidebar }: AppHeaderProps) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { colorMode, setColorMode } = useColorMode();

  const colorModeDropdown = useDropdown<HTMLDivElement>();

  // `orgId` is undefined on any route that isn't under `/orgs/:orgId`
  // (e.g. `/projects/:projectId/...`) — in that case no row is marked
  // current, which is the intended behaviour, not a gap (test-design §31).
  const { orgId } = useParams();

  const [orgList, setOrgList] = useState<OrgListState>({ status: "idle" });

  // Guards against an out-of-order response when the dropdown is opened,
  // closed, and reopened faster than the first request completes: only the
  // most recent open's response is allowed to write state. Without this, a
  // slow first response could land after a fast second one and repopulate
  // the menu with a stale list.
  const requestSeqRef = useRef(0);

  async function handleOrgDropdownShow() {
    const seq = ++requestSeqRef.current;
    setOrgList({ status: "loading" });
    try {
      const { orgs } = await getMyOrgs();
      if (seq === requestSeqRef.current) {
        setOrgList({ status: "loaded", orgs });
      }
    } catch {
      // Every failure mode (network, 5xx, an unexpected 403) collapses to
      // the same visible state — there is nothing actionable for the user
      // to distinguish, and the one thing that must never happen (rendering
      // as "you have no orgs") is already excluded by not touching `loaded`.
      if (seq === requestSeqRef.current) {
        setOrgList({ status: "error" });
      }
    }
  }

  function handleOrgDropdownHide() {
    // Reset so the next open genuinely re-fetches rather than flashing the
    // previous open's list — "no caching across opens" (TC-SHELL-016) is a
    // behaviour this line enforces, not just a description of the fetch.
    setOrgList({ status: "idle" });
  }

  const orgSwitcherDropdown = useDropdown<HTMLDivElement>(handleOrgDropdownHide);

  function toggleOrgSwitcher() {
    const next = !orgSwitcherDropdown.open;
    orgSwitcherDropdown.setOpen(next);
    if (next) {
      void handleOrgDropdownShow();
    } else {
      handleOrgDropdownHide();
    }
  }

  function handleSelectOrg(targetOrgId: string) {
    orgSwitcherDropdown.setOpen(false);
    handleOrgDropdownHide();
    navigate(`/orgs/${targetOrgId}`);
  }

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  function selectColorMode(mode: ColorMode) {
    setColorMode(mode);
    colorModeDropdown.setOpen(false);
  }

  const activeIcon = COLOR_MODE_ICON[colorMode] ?? COLOR_MODE_ICON.auto;

  return (
    <nav className="app-header navbar navbar-expand bg-body">
      <div className="container-fluid d-flex justify-content-between align-items-center">
        <div className="d-flex align-items-center">
          <button
            type="button"
            className="btn btn-link nav-link px-2"
            // Convention parity with AdminLTE's own delegated click listener
            // (`push-menu.ts`'s `[data-lte-toggle="sidebar"]` selector). We
            // don't load that JS — `onClick` is what actually runs, calling
            // back into the state `AppShell` owns.
            data-lte-toggle="sidebar"
            data-testid="sidebar-toggler"
            aria-label="Toggle sidebar"
            onClick={onToggleSidebar}
          >
            <i className="fa-solid fa-bars fa-lg" aria-hidden="true" />
          </button>
          {/* BRAND-1 (ADR-0048 Decision §7): the header carries the small
              mark only, not the full lockup — it's a fixed-height single row,
              not a widening rail, so there is no full/small state to swap.
              The wordmark lives in the sidebar instead. */}
          <BrandLogo href="/dashboard" size="small" className="navbar-brand mb-0" />
        </div>
        <div className="d-flex align-items-center">
          <div
            className={orgSwitcherDropdown.open ? "dropdown me-2 show" : "dropdown me-2"}
            ref={orgSwitcherDropdown.ref}
          >
            <Button
              color="secondary"
              outline
              className={orgSwitcherDropdown.open ? "show" : undefined}
              aria-expanded={orgSwitcherDropdown.open}
              data-testid="org-switcher-toggle"
              aria-label="Switch organization"
              title="Switch organization"
              onClick={toggleOrgSwitcher}
            >
              <i className="fa-solid fa-building fa-lg" aria-hidden="true" />
            </Button>
            <ul
              className={
                orgSwitcherDropdown.open ? "dropdown-menu show dropdown-menu-end" : "dropdown-menu dropdown-menu-end"
              }
              role="menu"
              data-testid="org-switcher-menu"
            >
              <li className="dropdown-header">Switch organization</li>
              {orgList.status === "loading" && (
                <li className="dropdown-item disabled" data-testid="org-switcher-loading">
                  Loading…
                </li>
              )}
              {orgList.status === "error" && (
                <li className="dropdown-item disabled" data-testid="org-switcher-error">
                  Couldn&apos;t load organizations
                </li>
              )}
              {orgList.status === "loaded" && orgList.orgs.length === 0 && (
                <li className="dropdown-item disabled" data-testid="org-switcher-empty">
                  No organizations
                </li>
              )}
              {orgList.status === "loaded" &&
                orgList.orgs.map((org) => {
                  const isCurrent = org.id === orgId;
                  return (
                    <li
                      key={org.id}
                      className={isCurrent ? "dropdown-item active disabled" : "dropdown-item"}
                      // The current org is inert, not merely styled: clicking
                      // the org you are already in must be a no-op, so it
                      // gets no `onClick` at all rather than one that
                      // re-navigates to the route already rendered.
                      onClick={isCurrent ? undefined : () => handleSelectOrg(org.id)}
                      data-testid={`org-switcher-item-${org.id}`}
                      style={{ cursor: isCurrent ? "default" : "pointer" }}
                    >
                      {org.name}
                    </li>
                  );
                })}
            </ul>
          </div>
          <div
            className={colorModeDropdown.open ? "dropdown me-2 show" : "dropdown me-2"}
            ref={colorModeDropdown.ref}
          >
            <Button
              color="secondary"
              outline
              className={colorModeDropdown.open ? "show" : undefined}
              aria-expanded={colorModeDropdown.open}
              data-testid="color-mode-toggle"
              aria-label="Toggle color mode"
              onClick={() => colorModeDropdown.setOpen((prev) => !prev)}
            >
              <i className={`${activeIcon} fa-lg`} aria-hidden="true" />
            </Button>
            <ul
              className={
                colorModeDropdown.open ? "dropdown-menu show dropdown-menu-end" : "dropdown-menu dropdown-menu-end"
              }
              role="menu"
            >
              <li>
                <a
                  className={colorMode === "light" ? "dropdown-item active" : "dropdown-item"}
                  aria-current={colorMode === "light" ? "page" : undefined}
                  data-testid="color-mode-light"
                  style={{ cursor: "pointer" }}
                  onClick={() => selectColorMode("light")}
                >
                  <i className="fa-solid fa-sun fa-lg me-2" aria-hidden="true" />
                  Light
                </a>
              </li>
              <li>
                <a
                  className={colorMode === "dark" ? "dropdown-item active" : "dropdown-item"}
                  aria-current={colorMode === "dark" ? "page" : undefined}
                  data-testid="color-mode-dark"
                  style={{ cursor: "pointer" }}
                  onClick={() => selectColorMode("dark")}
                >
                  <i className="fa-solid fa-moon fa-lg me-2" aria-hidden="true" />
                  Dark
                </a>
              </li>
              <li>
                <a
                  className={colorMode === "auto" ? "dropdown-item active" : "dropdown-item"}
                  aria-current={colorMode === "auto" ? "page" : undefined}
                  data-testid="color-mode-auto"
                  style={{ cursor: "pointer" }}
                  onClick={() => selectColorMode("auto")}
                >
                  <i className="fa-solid fa-circle-half-stroke fa-lg me-2" aria-hidden="true" />
                  Auto
                </a>
              </li>
            </ul>
          </div>
          <Button color="secondary" outline data-testid="logout-button" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </div>
    </nav>
  );
}

export default AppHeader;
