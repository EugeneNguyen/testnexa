/**
 * SHELL-2 (ADR-0020) route-derived breadcrumb, mounted once inside
 * `AppShell` alongside `AppFooter` so both join `AppSidebar`/`AppHeader` in
 * completing the free-template shell shape (FR-SHELL-2).
 *
 * Route -> label mapping is a small, explicit, ordered table
 * (`ROUTE_BREADCRUMBS`), matched with React Router's own `matchPath` — not a
 * bespoke path-parsing regex. Order matters: `/orgs/pick` is listed BEFORE
 * the generic `/orgs/:orgId` pattern, because `:orgId` is a plain path
 * param that would otherwise happily match the literal string "pick" too
 * (`orgId = "pick"`) — `Array.prototype.find` returns the FIRST match, so
 * the literal, more-specific entry has to come first to win that ambiguity.
 * `/orgs/pick` itself maps to an empty segment list (the org-picker screen
 * has no meaningful breadcrumb trail), which renders nothing, same as a
 * route with no table entry at all.
 *
 * Graceful degradation (TC-SHELL-008): any path with no matching table
 * entry — or a matched entry whose `segments()` returns `[]` — renders
 * `null`. There is no fallback branch that echoes a raw route param or
 * builds a label from an unmapped path segment, so an unmapped/root route
 * never produces a raw param or `undefined` fragment.
 *
 * The final (`active`) segment in a resolved trail is rendered as plain
 * text on an `<li class="breadcrumb-item active" aria-current="page">` (no
 * link); earlier segments are wrapped in a real React Router `<Link>` so
 * clicking one is client-side navigation, not a full page reload.
 *
 * Coverage extended (2026-09-07) to the remaining routed screens
 * (`ProjectDetail`/`TestPlanDetail`/`TestCycleDetail`, generic admin
 * list/edit) that had no table entry at all — they silently rendered no
 * breadcrumb (same as any unmapped route, per the graceful-degradation
 * paragraph above) rather than anything visibly broken, which is what let
 * the gap go unnoticed. Two things worth noting about the entries added:
 *
 * - `/projects/:projectId` carries no `orgId` route param (org is only
 *   resolvable via a `GET /projects/{id}` fetch, which this component
 *   deliberately does not do), so the Project/TestPlan/TestCycle chain
 *   below nests under `projectId`/`testPlanId` only — no "Dashboard" parent
 *   link, same posture as `/orgs/:orgId`'s own single, unlinked crumb.
 * - Admin list/edit routes label the `:entity` segment via
 *   `entityConfigByKey`/`allEntities` (`pages/admin/registry.ts`) — the
 *   same registry `AppSidebar`/routing already use — rather than a second,
 *   hand-maintained slug->label table.
 *
 * Alignment fix (2026-09-07): this originally wrapped `CBreadcrumb` in a
 * raw `px-3` flush-padding div, then in a plain (non-fluid, centered)
 * `<CContainer>` — both wrong. The literal CoreUI free-template markup for
 * this exact element (`docs`'s own reference, confirmed against the
 * template source) is:
 *
 *   <div class="container-fluid px-4">
 *     <nav aria-label="breadcrumb">
 *       <ol class="breadcrumb my-0">...</ol>
 *     </nav>
 *   </div>
 *
 * i.e. `container-fluid` (Bootstrap's 100%-width container — padding only,
 * no centering/max-width), not a plain `container` (which centers with a
 * per-breakpoint max-width). Every bespoke page's own content wrapper
 * (`OrgHome`, `OrgMembers`, `ProjectDetail`, `TestPlanDetail`,
 * `TestCycleDetail`) is fixed to match in the same pass — see each file's
 * own `<CContainer fluid className="px-4">`. `container-fluid`'s box is a
 * pure function of its parent's width, so any two instances at the same
 * width land at the same left/right edge without either side needing to
 * know about the other — confirmed via `getBoundingClientRect()` against a
 * running page post-fix.
 *
 * Vertical-gap fix (2026-09-07): `px-4 pt-3` (top-only padding) left the
 * breadcrumb text's bottom edge pixel-identical to where page content
 * started right below it — confirmed via `getBoundingClientRect()`: both
 * were `y: 97` on a running page, i.e. zero gap. The demo's own bar isn't
 * plain padding at all (it's `display: flex; align-items: center;
 * min-height: 48px`, vertically centering the text inside a fixed-height
 * bar that's itself a second row inside the same `<header>` as the
 * icon/search bar above it), which doesn't map 1:1 onto this app's
 * `AppBreadcrumb`/`AppHeader` being separate sibling components — `py-3`
 * (symmetric top+bottom padding) is the pragmatic equivalent: it stops the
 * text from being flush against whatever sits below it without adopting
 * the demo's fixed-height-bar structure wholesale.
 *
 * Raw HTML per ADR-0037 (2026-09-07), not `@coreui/react` — this is the
 * component whose three rounds of `@coreui/react`-vs-demo pixel mismatches
 * (above) drove that ADR in the first place. Only the returned JSX changed
 * (`<CContainer>`/`<CBreadcrumb>`/`<CBreadcrumbItem>` -> raw `<div
 * class="container-fluid px-4 py-3">`/`<nav aria-label="breadcrumb">`/`<ol
 * class="breadcrumb my-0">`/`<li class="breadcrumb-item">`) — the
 * `ROUTE_BREADCRUMBS` table and `matchPath` resolution logic above are
 * byte-for-byte unchanged. `aria-current="page"` on the active `<li>`
 * replaces what `CBreadcrumbItem`'s own `active` prop set automatically.
 *
 * AdminLTE v4 (ADR-0042): the `ROUTE_BREADCRUMBS` table, the `matchPath`
 * resolution, all 15 route patterns, `nav[aria-label="breadcrumb"]`,
 * `ol.breadcrumb`, `li.breadcrumb-item[.active]` and `aria-current="page"`
 * are ALL unchanged — `.breadcrumb` is stock Bootstrap 5, which AdminLTE v4
 * is built on, and four e2e specs assert on that exact structure. The only
 * change is the outer wrapper: this component now renders inside
 * `AppShell`'s `.app-content-header` (compiled selector
 * `.app-main .app-content-header`), which supplies the vertical rhythm the
 * old hand-tuned `py-3` was standing in for and the horizontal inset that
 * `px-4` was. Both utilities are therefore dropped and only the bare
 * `container-fluid` remains — matching `.app-content`'s own children, so the
 * breadcrumb's left edge still lands exactly where page content's does (the
 * property the 2026-09-07 alignment fix above was chasing; both boxes are a
 * `container-fluid` under a parent with identical horizontal padding).
 *
 * `null` on an unmapped route is unchanged and still load-bearing
 * (TC-SHELL-008) — note it leaves `AppShell`'s `.app-content-header` div
 * rendered but empty on such routes, i.e. that element's own padding shows
 * as a small blank band. Cosmetic, flagged rather than "fixed" by moving the
 * wrapper down into this component, since `AppShell` owning the grid regions
 * is the structural rule ADR-0042 §4.4 sets.
 */
import { Link, matchPath, useLocation } from "react-router-dom";
import { allEntities } from "../../../pages/admin/registry";

const entityLabelByKey: Record<string, string> = Object.fromEntries(
  allEntities.map((e) => [e.key, e.label]),
);

function entityLabel(entity: string | undefined): string {
  return entity && entityLabelByKey[entity] ? entityLabelByKey[entity] : "Admin";
}

interface BreadcrumbSegment {
  label: string;
  /** Omitted for the active (current, non-clickable) segment. */
  to?: string;
}

interface RouteBreadcrumbConfig {
  pattern: string;
  segments: (params: Readonly<Record<string, string | undefined>>) => BreadcrumbSegment[];
}

// Ordered: literal/more-specific patterns before the generic `/orgs/:orgId`
// catch-all — see the module docstring for why order is load-bearing here.
const ROUTE_BREADCRUMBS: RouteBreadcrumbConfig[] = [
  {
    pattern: "/orgs/pick",
    segments: () => [],
  },
  {
    pattern: "/orgs/:orgId/members",
    segments: (params) => [{ label: "Dashboard", to: `/orgs/${params.orgId}` }, { label: "Members" }],
  },
  {
    pattern: "/orgs/:orgId/ui-elements/colors",
    segments: (params) => [
      { label: "Dashboard", to: `/orgs/${params.orgId}` },
      { label: "UI Elements" },
      { label: "Colors" },
    ],
  },
  {
    pattern: "/orgs/:orgId/ui-elements/typography",
    segments: (params) => [
      { label: "Dashboard", to: `/orgs/${params.orgId}` },
      { label: "UI Elements" },
      { label: "Typography" },
    ],
  },
  {
    pattern: "/orgs/:orgId/ui-elements/icons",
    segments: (params) => [
      { label: "Dashboard", to: `/orgs/${params.orgId}` },
      { label: "UI Elements" },
      { label: "Icons" },
    ],
  },
  {
    pattern: "/orgs/:orgId",
    segments: () => [{ label: "Dashboard" }],
  },
  {
    pattern: "/orgs/:orgId/admin/:entity/:id/edit",
    segments: (params) => [
      { label: "Dashboard", to: `/orgs/${params.orgId}` },
      { label: entityLabel(params.entity), to: `/orgs/${params.orgId}/admin/${params.entity}` },
      { label: "Edit" },
    ],
  },
  {
    pattern: "/orgs/:orgId/admin/:entity",
    segments: (params) => [
      { label: "Dashboard", to: `/orgs/${params.orgId}` },
      { label: entityLabel(params.entity) },
    ],
  },
  {
    pattern: "/projects/:projectId/test-plans/:testPlanId/test-cycles/:testCycleId",
    segments: (params) => [
      { label: "Project", to: `/projects/${params.projectId}` },
      {
        label: "Test Plan",
        to: `/projects/${params.projectId}/test-plans/${params.testPlanId}`,
      },
      { label: "Test Cycle" },
    ],
  },
  {
    pattern: "/projects/:projectId/test-plans/:testPlanId",
    segments: (params) => [
      { label: "Project", to: `/projects/${params.projectId}` },
      { label: "Test Plan" },
    ],
  },
  {
    pattern: "/projects/:projectId/admin/:entity/:id/edit",
    segments: (params) => [
      { label: "Project", to: `/projects/${params.projectId}` },
      { label: entityLabel(params.entity), to: `/projects/${params.projectId}/admin/${params.entity}` },
      { label: "Edit" },
    ],
  },
  {
    pattern: "/projects/:projectId/admin/:entity",
    segments: (params) => [
      { label: "Project", to: `/projects/${params.projectId}` },
      { label: entityLabel(params.entity) },
    ],
  },
  {
    pattern: "/projects/:projectId",
    segments: () => [{ label: "Project" }],
  },
];

function AppBreadcrumb() {
  const location = useLocation();
  const config = ROUTE_BREADCRUMBS.find((route) => matchPath(route.pattern, location.pathname));
  if (!config) {
    return null;
  }

  const match = matchPath(config.pattern, location.pathname);
  const segments = match ? config.segments(match.params) : [];
  if (segments.length === 0) {
    return null;
  }

  return (
    <div className="container-fluid">
      <nav aria-label="breadcrumb">
        <ol className="breadcrumb my-0">
          {segments.map((segment, index) => {
            const isActive = index === segments.length - 1;
            return (
              <li
                key={`${segment.label}-${index}`}
                className={isActive ? "breadcrumb-item active" : "breadcrumb-item"}
                aria-current={isActive ? "page" : undefined}
              >
                {!isActive && segment.to ? <Link to={segment.to}>{segment.label}</Link> : segment.label}
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}

export default AppBreadcrumb;
