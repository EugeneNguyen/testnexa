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
 * text via `CBreadcrumbItem`'s own `active` prop (no link, `aria-current`
 * set automatically); earlier segments are wrapped in a real React Router
 * `<Link>` so clicking one is client-side navigation, not a full page
 * reload — `CBreadcrumbItem`'s own `as`/`href` composition is NOT used for
 * this (that combination replaces the outer `<li>` root node per its own
 * prop doc, not the inner link, and `href` alone would produce a
 * non-SPA `<a>` navigation), so the `<Link>` is nested as `children`
 * instead.
 *
 * Built with CoreUI (ADR-0012) — `CBreadcrumb`/`CBreadcrumbItem` only.
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
 *   below nests under `projectId`/`testPlanId` only — no "Org Home" parent
 *   link, same posture as `/orgs/:orgId`'s own single, unlinked crumb.
 * - Admin list/edit routes label the `:entity` segment via
 *   `entityConfigByKey`/`allEntities` (`pages/admin/registry.ts`) — the
 *   same registry `AppSidebar`/routing already use — rather than a second,
 *   hand-maintained slug->label table.
 *
 * Alignment fix (2026-09-07): this used to wrap `CBreadcrumb` in a raw
 * `px-3` flush-padding div, while every bespoke page (`OrgHome`,
 * `OrgMembers`, `ProjectDetail`, `TestPlanDetail`, `TestCycleDetail`) wraps
 * its own content in a plain, default `<CContainer>` (Bootstrap's centered,
 * max-width container — auto side margins, not flush). At any viewport
 * wider than the container's current breakpoint, `px-3`'s flush left edge
 * and `CContainer`'s centered left edge land at different x-positions, so
 * the breadcrumb visibly didn't line up with the page content below it
 * (confirmed via `getBoundingClientRect()` against a real running page:
 * breadcrumb text left edge at x=256, first content card at x=438). Fixed
 * by wrapping in the same plain `<CContainer>` the pages already use —
 * Bootstrap's container math is a pure function of viewport width, so two
 * separate `<CContainer>` instances at the same width always compute the
 * same left/right position, without either side needing to know about the
 * other.
 */
import { Link, matchPath, useLocation } from "react-router-dom";
import { CBreadcrumb, CBreadcrumbItem, CContainer } from "@coreui/react";
import { allEntities } from "../pages/admin/registry";

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
    segments: (params) => [{ label: "Org Home", to: `/orgs/${params.orgId}` }, { label: "Members" }],
  },
  {
    pattern: "/orgs/:orgId/ui-elements/colors",
    segments: (params) => [
      { label: "Org Home", to: `/orgs/${params.orgId}` },
      { label: "UI Elements" },
      { label: "Colors" },
    ],
  },
  {
    pattern: "/orgs/:orgId/ui-elements/typography",
    segments: (params) => [
      { label: "Org Home", to: `/orgs/${params.orgId}` },
      { label: "UI Elements" },
      { label: "Typography" },
    ],
  },
  {
    pattern: "/orgs/:orgId/ui-elements/icons",
    segments: (params) => [
      { label: "Org Home", to: `/orgs/${params.orgId}` },
      { label: "UI Elements" },
      { label: "Icons" },
    ],
  },
  {
    pattern: "/orgs/:orgId",
    segments: () => [{ label: "Org Home" }],
  },
  {
    pattern: "/orgs/:orgId/admin/:entity/:id/edit",
    segments: (params) => [
      { label: "Org Home", to: `/orgs/${params.orgId}` },
      { label: entityLabel(params.entity), to: `/orgs/${params.orgId}/admin/${params.entity}` },
      { label: "Edit" },
    ],
  },
  {
    pattern: "/orgs/:orgId/admin/:entity",
    segments: (params) => [
      { label: "Org Home", to: `/orgs/${params.orgId}` },
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
    <CContainer className="pt-3">
      <CBreadcrumb className="my-0">
        {segments.map((segment, index) => {
          const isActive = index === segments.length - 1;
          return (
            <CBreadcrumbItem key={`${segment.label}-${index}`} active={isActive}>
              {!isActive && segment.to ? <Link to={segment.to}>{segment.label}</Link> : segment.label}
            </CBreadcrumbItem>
          );
        })}
      </CBreadcrumb>
    </CContainer>
  );
}

export default AppBreadcrumb;
