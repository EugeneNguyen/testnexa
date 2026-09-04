/**
 * SHELL-2 (ADR-0019) route-derived breadcrumb, mounted once inside
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
 */
import { Link, matchPath, useLocation } from "react-router-dom";
import { CBreadcrumb, CBreadcrumbItem } from "@coreui/react";

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
    <CBreadcrumb className="my-0 px-3 pt-3">
      {segments.map((segment, index) => {
        const isActive = index === segments.length - 1;
        return (
          <CBreadcrumbItem key={`${segment.label}-${index}`} active={isActive}>
            {!isActive && segment.to ? <Link to={segment.to}>{segment.label}</Link> : segment.label}
          </CBreadcrumbItem>
        );
      })}
    </CBreadcrumb>
  );
}

export default AppBreadcrumb;
