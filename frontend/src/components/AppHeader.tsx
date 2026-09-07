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
 * SHELL-4 (ADR-0020, FR-SHELL-4/NFR-28) adds the dark/light color-mode
 * toggle: CoreUI's own `useColorModes` hook, no custom theme engine. The
 * hook itself owns `localStorage` persistence (default key
 * `coreui-react-color-scheme`) and applies the resolved mode as
 * `document.documentElement.dataset.coreuiTheme` — this component only
 * renders the dropdown UI and calls `setColorMode`. Three explicit choices
 * (Light/Dark/Auto), matching CoreUI's own free-template header control and
 * the test-design's 3 distinct equivalence classes (unset/auto vs.
 * explicit light vs. explicit dark) — not a single 2-state flip button.
 *
 * SHELL-6 (ADR-0036, FR-SHELL-6/FR-AUTH-5) adds the organization-switcher
 * dropdown, immediately to the LEFT of the color-mode toggle (UI Design
 * Document §2's header order: toggler → brand → *spacer* → org switcher →
 * color mode → log out). Three deliberate behaviours, each with its own
 * test case, all of which would be easy to "simplify" away later:
 *
 * 1. **Lazy, uncached fetch** (TC-SHELL-016). `GET /auth/me/orgs` fires on
 *    `CDropdown`'s `onShow` — never on mount, and never reused between
 *    opens: each open resets to a loading state and issues a fresh request.
 *    Deliberately NOT read from `AuthContext.orgs`, which is populated only
 *    by `login()`/`signup()`/`acceptInvite()` and is therefore empty after
 *    any page reload (the AUTH-2 gap ADR-0035 deferred). A header control
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
 */
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CButton,
  CContainer,
  CDropdown,
  CDropdownHeader,
  CDropdownItem,
  CDropdownMenu,
  CDropdownToggle,
  CHeader,
  CHeaderBrand,
  CHeaderToggler,
  CSpinner,
  CTooltip,
  useColorModes,
} from "@coreui/react";
import { CIcon } from "@coreui/icons-react";
import { cilBuilding, cilContrast, cilMenu, cilMoon, cilSun } from "@coreui/icons";
import { useAuth } from "../auth/AuthContext";
import { getMyOrgs, type OrgSummary } from "../lib/api/auth";

interface AppHeaderProps {
  onToggleSidebar: () => void;
}

const COLOR_MODE_ICON = {
  light: cilSun,
  dark: cilMoon,
  auto: cilContrast,
} as const;

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

function AppHeader({ onToggleSidebar }: AppHeaderProps) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { colorMode, setColorMode } = useColorModes();

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

  function handleSelectOrg(targetOrgId: string) {
    navigate(`/orgs/${targetOrgId}`);
  }

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
          <CDropdown
            alignment="end"
            className="me-2"
            onShow={handleOrgDropdownShow}
            onHide={handleOrgDropdownHide}
          >
            {/*
              The `<span>` between `CTooltip` and `CDropdownToggle` is
              required, not stylistic. `CTooltip` positions itself by
              cloning its child with a ref, but `CDropdownToggle` is a plain
              function component (it takes its own ref from
              `CDropdownContext`, not `forwardRef`) — passing it a ref logs
              "Function components cannot be given refs" and leaves the
              tooltip's popper anchored to `null`. A host element in between
              accepts the ref, and the dropdown itself is unaffected since
              `CDropdownToggle` reaches its parent through React context,
              not through being a direct child.
            */}
            <CTooltip content="Switch organization">
              <span className="d-inline-block">
                <CDropdownToggle
                  color="secondary"
                  variant="outline"
                  caret={false}
                  data-testid="org-switcher-toggle"
                  aria-label="Switch organization"
                >
                  <CIcon icon={cilBuilding} size="lg" />
                </CDropdownToggle>
              </span>
            </CTooltip>
            <CDropdownMenu data-testid="org-switcher-menu">
              <CDropdownHeader>Switch organization</CDropdownHeader>
              {orgList.status === "loading" && (
                <CDropdownItem disabled data-testid="org-switcher-loading">
                  <CSpinner size="sm" className="me-2" />
                  Loading…
                </CDropdownItem>
              )}
              {orgList.status === "error" && (
                <CDropdownItem disabled data-testid="org-switcher-error">
                  Couldn&apos;t load organizations
                </CDropdownItem>
              )}
              {orgList.status === "loaded" && orgList.orgs.length === 0 && (
                <CDropdownItem disabled data-testid="org-switcher-empty">
                  No organizations
                </CDropdownItem>
              )}
              {orgList.status === "loaded" &&
                orgList.orgs.map((org) => {
                  const isCurrent = org.id === orgId;
                  return (
                    <CDropdownItem
                      key={org.id}
                      active={isCurrent}
                      // The current org is inert, not merely styled: clicking
                      // the org you are already in must be a no-op, so it
                      // gets no `onClick` at all rather than one that
                      // re-navigates to the route already rendered.
                      disabled={isCurrent}
                      onClick={isCurrent ? undefined : () => handleSelectOrg(org.id)}
                      data-testid={`org-switcher-item-${org.id}`}
                      style={{ cursor: isCurrent ? "default" : "pointer" }}
                    >
                      {org.name}
                    </CDropdownItem>
                  );
                })}
            </CDropdownMenu>
          </CDropdown>
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
