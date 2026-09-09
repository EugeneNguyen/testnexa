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
 *   **Reversed by SHELL-9 (2026-09-09, ADR-0048) — see below.** The
 *   "deliberately does not fetch" posture is exactly what left every
 *   project-scoped screen with a dead-end, name-less crumb; this component
 *   now does resolve the org, via `useResolvedOrgId()`.
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
 * SHELL-9 (2026-09-09, ADR-0048): this component is no longer render-only
 * with respect to network state. All 5 project-scoped patterns now open with
 * a resolved `Projects → {project name}` prefix instead of the bare, unlinked
 * "Project" label described above, giving those screens their first real
 * click-path back to the org's Projects list (PROJ-4's `/orgs/:orgId/projects`,
 * ADR-0047 — no new route or affordance invented for this).
 *
 * `useResolvedOrgId()` supplies both halves (`org_id` for the root link's
 * target, the Project's own `name` for the trail) from one shared
 * `["project", projectId]` react-query entry, so the sidebar, this component,
 * and a page that fetches the same row collapse to a single network call
 * (NFR-53). Two structural consequences worth knowing:
 *
 * - **Every project-scoped trail grew by exactly one segment**, so any
 *   assertion pinning those trails' segment count/text had to change in the
 *   same commit (ADR-0048's own Consequences names this; `AppBreadcrumb.test.tsx`
 *   and `shell2-breadcrumb-coverage.spec.ts` are the two files affected).
 * - **The `segments()` signature widened** to take a resolved-context second
 *   argument. Org-scoped entries simply ignore it; the `matchPath` resolution
 *   logic itself is untouched.
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
import { useResolvedOrgId } from "../../../hooks/useResolvedOrgId";

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

/**
 * SHELL-9 (ADR-0048): resolved nav context passed alongside the route's own
 * `params`, for the 5 project-scoped patterns that need an `org_id` and a
 * project name neither of which appears anywhere in the URL.
 *
 * This exists because `matchPath`'s `params` callback is a plain function, not
 * a component, so it cannot call `useResolvedOrgId()` itself. `AppBreadcrumb`
 * calls the hook once in its own body (same as `AppSidebar`) and threads the
 * result through here — a signature widening of `segments`, deliberately not a
 * rewrite of the `matchPath` resolution logic above.
 */
interface BreadcrumbNavContext {
  /** Resolved org, for the `Projects` root segment's link target. */
  orgId: string | undefined;
  /** The current Project's real name, for the trail's name-bearing segment. */
  projectName: string | undefined;
}

interface RouteBreadcrumbConfig {
  pattern: string;
  segments: (
    params: Readonly<Record<string, string | undefined>>,
    context: BreadcrumbNavContext,
  ) => BreadcrumbSegment[];
}

/**
 * The shared `Projects → {project name}` prefix every project-scoped trail now
 * opens with (UI Design Document §1b).
 *
 * Returns `[]` while the context is unresolved — a pending `GET /projects/{id}`,
 * or one that 404'd on a deleted/foreign project. That empty list propagates
 * through `segments.length === 0 → null`, so the breadcrumb renders nothing at
 * all rather than a partial trail, a raw id, or an `undefined` fragment — the
 * same invariant TC-SHELL-008 already pins for unmapped routes, now also
 * covering this new failure source (TC-SHELL-033).
 *
 * Deliberately NOT a fallback to the old bare "Project" label (the UI Design
 * Document's own §4 open question, resolved to its recommended default): a
 * label that flashes "Project" and then relabels itself to the real name a
 * moment later reads worse than a brief blank bar, and re-introduces exactly the
 * partial-label branch TC-SHELL-008 exists to forbid.
 *
 * `projectHref` is supplied when the project's own name should link back to its
 * detail screen (every nested pattern), omitted when the name IS the active
 * final segment (`/projects/:projectId` itself).
 */
function projectTrailPrefix(
  context: BreadcrumbNavContext,
  projectHref?: string,
): BreadcrumbSegment[] {
  if (!context.orgId || !context.projectName) {
    return [];
  }
  return [
    { label: "Projects", to: `/orgs/${context.orgId}/projects` },
    { label: context.projectName, to: projectHref },
  ];
}

/**
 * Build a project-scoped trail, or `[]` if its context hasn't resolved.
 *
 * Guarding here (rather than in each caller) keeps the "never render a partial
 * project trail" rule in one place — appending tail segments onto an empty
 * prefix would otherwise produce a `Test Plan / Test Cycle` trail with no root,
 * which is exactly the partial state ADR-0048 §4 rules out.
 */
function projectTrail(
  context: BreadcrumbNavContext,
  projectHref: string | undefined,
  tail: BreadcrumbSegment[],
): BreadcrumbSegment[] {
  const prefix = projectTrailPrefix(context, projectHref);
  return prefix.length === 0 ? [] : [...prefix, ...tail];
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
    // PROJ-4 (ADR-0047): must precede the generic `/orgs/:orgId` catch-all
    // below, same ordering rule the module docstring already explains for
    // `/orgs/pick`.
    pattern: "/orgs/:orgId/projects",
    segments: (params) => [{ label: "Dashboard", to: `/orgs/${params.orgId}` }, { label: "Projects" }],
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
  // SHELL-9 (ADR-0048): all 5 project-scoped patterns below open with the
  // resolved `Projects → {project name}` prefix, replacing the bare unlinked
  // "Project" label each used to render. That old label carried no org context
  // (this file's own docstring above explains why it originally couldn't) and so
  // offered no way back to the org's Projects list — the literal dead-end this
  // story closes. Every trail therefore grows by exactly one segment.
  {
    pattern: "/projects/:projectId/test-plans/:testPlanId/test-cycles/:testCycleId",
    segments: (params, context) =>
      projectTrail(context, `/projects/${params.projectId}`, [
        {
          label: "Test Plan",
          to: `/projects/${params.projectId}/test-plans/${params.testPlanId}`,
        },
        { label: "Test Cycle" },
      ]),
  },
  {
    pattern: "/projects/:projectId/test-plans/:testPlanId",
    segments: (params, context) =>
      projectTrail(context, `/projects/${params.projectId}`, [{ label: "Test Plan" }]),
  },
  {
    pattern: "/projects/:projectId/admin/:entity/:id/edit",
    segments: (params, context) =>
      projectTrail(context, `/projects/${params.projectId}`, [
        {
          label: entityLabel(params.entity),
          to: `/projects/${params.projectId}/admin/${params.entity}`,
        },
        { label: "Edit" },
      ]),
  },
  {
    pattern: "/projects/:projectId/admin/:entity",
    segments: (params, context) =>
      projectTrail(context, `/projects/${params.projectId}`, [
        { label: entityLabel(params.entity) },
      ]),
  },
  {
    // The project's own name is the active final segment here, so it takes no
    // link (hence no `projectHref`) — matching every other trail's
    // "last segment is plain text" rule.
    pattern: "/projects/:projectId",
    segments: (_params, context) => projectTrailPrefix(context),
  },
];

function AppBreadcrumb() {
  const location = useLocation();
  // SHELL-9 (ADR-0048): called unconditionally at the top of the body, before
  // any early return — a hook cannot sit behind the `if (!config)` guard below.
  // It is a no-op (no fetch) on every route that isn't project-scoped.
  const { orgId, project } = useResolvedOrgId();
  const config = ROUTE_BREADCRUMBS.find((route) => matchPath(route.pattern, location.pathname));
  if (!config) {
    return null;
  }

  const match = matchPath(config.pattern, location.pathname);
  const segments = match
    ? config.segments(match.params, { orgId, projectName: project?.name })
    : [];
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
