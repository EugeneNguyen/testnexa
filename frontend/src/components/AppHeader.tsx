/**
 * AUTH-3 app header, mounted once inside `AppShell` (via `ProtectedRoute`)
 * so every current and future protected page gets it for free without
 * wiring its own button (scope plan §1/§4.3). Brand label + sidebar
 * toggler + "Log out" button — no breadcrumbs or user-menu dropdown
 * (explicitly out-of-scope, see the AUTH-3 scope plan §1).
 *
 * SHELL-1 (ADR-0018) adds the `CHeaderToggler`: calls the `onToggleSidebar`
 * handler `AppShell` owns and passes down, flipping `AppSidebar`'s `visible`
 * state via CoreUI's own documented template pattern — no hand-built
 * breakpoint/media-query logic here.
 *
 * Built with CoreUI (ADR-0012) — `CHeader`/`CHeaderBrand`/`CHeaderToggler`/
 * `CContainer`/`CButton`/`CIcon` only, no hand-rolled nav markup, no
 * Tailwind classes.
 *
 * Clicking "Log out" calls `useAuth().logout()` (clears the token store +
 * org state, best-effort revokes the server-side refresh token — see
 * `AuthContext.tsx`/ADR-0014) and then navigates to `/login` via React
 * Router, matching `ProtectedRoute`'s client-side `<Navigate>` style rather
 * than `apiFetch`'s hard `window.location.assign` redirect (scope plan §1).
 *
 * SHELL-4 (ADR-0019, FR-SHELL-4/NFR-26) adds the dark/light color-mode
 * toggle: CoreUI's own `useColorModes` hook, no custom theme engine. The
 * hook itself owns `localStorage` persistence (default key
 * `coreui-react-color-scheme`) and applies the resolved mode as
 * `document.documentElement.dataset.coreuiTheme` — this component only
 * renders the dropdown UI and calls `setColorMode`. Three explicit choices
 * (Light/Dark/Auto), matching CoreUI's own free-template header control and
 * the test-design's 3 distinct equivalence classes (unset/auto vs.
 * explicit light vs. explicit dark) — not a single 2-state flip button.
 */
import { useNavigate } from "react-router-dom";
import {
  CButton,
  CContainer,
  CDropdown,
  CDropdownItem,
  CDropdownMenu,
  CDropdownToggle,
  CHeader,
  CHeaderBrand,
  CHeaderToggler,
  useColorModes,
} from "@coreui/react";
import { CIcon } from "@coreui/icons-react";
import { cilContrast, cilMenu, cilMoon, cilSun } from "@coreui/icons";
import { useAuth } from "../auth/AuthContext";

interface AppHeaderProps {
  onToggleSidebar: () => void;
}

const COLOR_MODE_ICON = {
  light: cilSun,
  dark: cilMoon,
  auto: cilContrast,
} as const;

function AppHeader({ onToggleSidebar }: AppHeaderProps) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { colorMode, setColorMode } = useColorModes();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const activeIcon = COLOR_MODE_ICON[colorMode as keyof typeof COLOR_MODE_ICON] ?? cilContrast;

  return (
    <CHeader>
      <CContainer fluid className="d-flex justify-content-between align-items-center">
        <div className="d-flex align-items-center">
          <CHeaderToggler data-testid="sidebar-toggler" onClick={onToggleSidebar}>
            <CIcon icon={cilMenu} size="lg" />
          </CHeaderToggler>
          <CHeaderBrand>TestNexa</CHeaderBrand>
        </div>
        <div className="d-flex align-items-center">
          <CDropdown alignment="end" className="me-2">
            <CDropdownToggle
              color="secondary"
              variant="outline"
              caret={false}
              data-testid="color-mode-toggle"
              aria-label="Toggle color mode"
            >
              <CIcon icon={activeIcon} size="lg" />
            </CDropdownToggle>
            <CDropdownMenu>
              <CDropdownItem
                active={colorMode === "light"}
                onClick={() => setColorMode("light")}
                data-testid="color-mode-light"
                style={{ cursor: "pointer" }}
              >
                <CIcon className="me-2" icon={cilSun} size="lg" />
                Light
              </CDropdownItem>
              <CDropdownItem
                active={colorMode === "dark"}
                onClick={() => setColorMode("dark")}
                data-testid="color-mode-dark"
                style={{ cursor: "pointer" }}
              >
                <CIcon className="me-2" icon={cilMoon} size="lg" />
                Dark
              </CDropdownItem>
              <CDropdownItem
                active={colorMode === "auto"}
                onClick={() => setColorMode("auto")}
                data-testid="color-mode-auto"
                style={{ cursor: "pointer" }}
              >
                <CIcon className="me-2" icon={cilContrast} size="lg" />
                Auto
              </CDropdownItem>
            </CDropdownMenu>
          </CDropdown>
          <CButton color="secondary" variant="outline" data-testid="logout-button" onClick={handleLogout}>
            Log out
          </CButton>
        </div>
      </CContainer>
    </CHeader>
  );
}

export default AppHeader;
