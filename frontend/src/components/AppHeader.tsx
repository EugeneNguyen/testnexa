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
 * Raw HTML per ADR-0037 (2026-09-07), not `@coreui/react`:
 * - `CHeader`/`CHeaderBrand`/`CHeaderToggler`/`CContainer`/`CButton` become
 *   raw `<div class="header">`/`<a class="header-brand">`/
 *   `<button class="header-toggler">`/`<div class="container-fluid ...">`/
 *   `<button class="btn btn-outline-secondary">` — same classes, confirmed
 *   by dumping their actual rendered DOM before removing the import.
 * - `useColorModes` (a `@coreui/react` hook) is replaced with `useColorMode`
 *   below, a faithful line-for-line port of that hook's own source
 *   (`localStorage` key `coreui-react-color-scheme` unchanged, so an
 *   already-set preference from before this migration still applies; same
 *   `prefers-color-scheme` media-query listener for "auto"; same
 *   `document.documentElement.dataset.coreuiTheme` write) — not a
 *   simplification, just no longer imported from the library.
 * - `CDropdown`/`CDropdownToggle`/`CDropdownMenu`/`CDropdownItem` (the
 *   color-mode menu) become a hand-rolled `useState` open/closed boolean
 *   toggling Bootstrap's own `.dropdown-menu.show` class (the same class
 *   `CDropdownMenu` itself toggled) plus a document-level click-outside
 *   listener to close it — deliberately NOT wired to `bootstrap.bundle.js`'s
 *   real `Dropdown` class (ADR-0037 floated that option): managing a
 *   vanilla-JS component instance's lifecycle (init on mount, dispose on
 *   unmount, ref plumbing) inside React is a well-known sharp edge for
 *   exactly this kind of small interaction, and a plain boolean toggle is
 *   both simpler and has an identical visual/behavioral result here.
 * - `CIcon` (`@coreui/icons-react`) is kept as-is — it's a leaf SVG
 *   renderer, not a layout/markup-mediating component, so it isn't the
 *   class of dependency ADR-0037 is about; reimplementing `@coreui/icons`'
 *   own path-array format by hand would be pure duplicated risk for zero
 *   benefit.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CIcon } from "@coreui/icons-react";
import { cilContrast, cilMenu, cilMoon, cilSun } from "@coreui/icons";
import { useAuth } from "../auth/AuthContext";

interface AppHeaderProps {
  onToggleSidebar: () => void;
}

type ColorMode = "light" | "dark" | "auto";

const COLOR_MODE_STORAGE_KEY = "coreui-react-color-scheme";

const COLOR_MODE_ICON = {
  light: cilSun,
  dark: cilMoon,
  auto: cilContrast,
} as const;

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getStoredColorMode(): ColorMode | null {
  const stored = localStorage.getItem(COLOR_MODE_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : null;
}

function applyColorMode(mode: ColorMode) {
  document.documentElement.setAttribute("data-coreui-theme", mode === "auto" && prefersDark() ? "dark" : mode);
}

/**
 * Faithful port of `@coreui/react`'s `useColorModes` hook — see this file's
 * own docstring for why it's no longer imported from the library.
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

function AppHeader({ onToggleSidebar }: AppHeaderProps) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { colorMode, setColorMode } = useColorMode();
  const [menuOpen, setMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  function selectColorMode(mode: ColorMode) {
    setColorMode(mode);
    setMenuOpen(false);
  }

  const activeIcon = COLOR_MODE_ICON[colorMode] ?? cilContrast;

  return (
    <div className="header">
      <div className="container-fluid d-flex justify-content-between align-items-center">
        <div className="d-flex align-items-center">
          <button
            type="button"
            className="header-toggler"
            data-testid="sidebar-toggler"
            onClick={onToggleSidebar}
          >
            <CIcon icon={cilMenu} size="lg" />
          </button>
          <a className="header-brand">TestNexa</a>
        </div>
        <div className="d-flex align-items-center">
          <div className={menuOpen ? "dropdown me-2 show" : "dropdown me-2"} ref={dropdownRef}>
            <button
              className={menuOpen ? "btn btn-outline-secondary show" : "btn btn-outline-secondary"}
              type="button"
              aria-expanded={menuOpen}
              data-testid="color-mode-toggle"
              aria-label="Toggle color mode"
              onClick={() => setMenuOpen((prev) => !prev)}
            >
              <CIcon icon={activeIcon} size="lg" />
            </button>
            <ul className={menuOpen ? "dropdown-menu show dropdown-menu-end" : "dropdown-menu dropdown-menu-end"} role="menu">
              <li>
                <a
                  className={colorMode === "light" ? "dropdown-item active" : "dropdown-item"}
                  aria-current={colorMode === "light" ? "page" : undefined}
                  data-testid="color-mode-light"
                  style={{ cursor: "pointer" }}
                  onClick={() => selectColorMode("light")}
                >
                  <CIcon className="me-2" icon={cilSun} size="lg" />
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
                  <CIcon className="me-2" icon={cilMoon} size="lg" />
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
                  <CIcon className="me-2" icon={cilContrast} size="lg" />
                  Auto
                </a>
              </li>
            </ul>
          </div>
          <button
            className="btn btn-outline-secondary"
            type="button"
            data-testid="logout-button"
            onClick={handleLogout}
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}

export default AppHeader;
