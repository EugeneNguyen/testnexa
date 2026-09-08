/**
 * `WidgetStatsTile` shared presentational primitive — CoreUI free-template
 * "Widgets" page's stat tile (https://coreui.io/demos/bootstrap/latest/free/widgets.html,
 * row at `…/div[2]/div[2]/div[7]`, an 8-card grid of A-with-icon + B-no-icon
 * variants in the four contextual colors).
 *
 * Hand-rolled raw HTML/JSX against the design system's own Bootstrap-family
 * classes — the "hand-roll the markup, keep the CSS" pattern
 * [ADR-0037](docs/adr/0037-shell-components-raw-html-not-coreui-react.md)
 * established for `AppSidebar`/`AppBreadcrumb` and `FeaturedCard` /
 * `FormField` reused from a plain product ask, and which
 * [ADR-0042](docs/adr/0042-adminlte-design-system.md) has since made the
 * repo-wide rule. Class strings below were captured verbatim from the
 * originating demo page's rendered DOM (via Playwright + `getComputedStyle`,
 * per root `CLAUDE.md`'s "screenshots can't reveal class names" lesson), not
 * reconstructed from memory, and are unchanged by the AdminLTE migration —
 * they are all plain Bootstrap 5 utilities, which `adminlte.min.css` bundles.
 *
 * **The only thing ADR-0042 changed here is the icon**: `@coreui/icons-react`'s
 * `CIcon` became a Font Awesome `<i>` (see the `icon` prop's own doc for the
 * latent bug that surfaced). Three tests assert on exact compound selectors
 * (`.bg-warning.text-white.p-4.me-3`, `.text-danger.fw-semibold`, and `card` /
 * `overflow-hidden` on the root) — the surrounding markup is deliberately
 * byte-identical so those keep passing.
 *
 * Tier placement: `frontend/src/components/shared/` per DS-1 and the
 * FormField doc comment, which explicitly notes that this repo does NOT
 * use atoms/molecules/organisms tiers — those directories don't exist
 * (the `atoms/` and `molecules/` sub-dirs that do exist were introduced
 * for the Button/ButtonStack story and hold one component each, not a
 * tier). `shared/` is the actual home for cross-screen UI blocks with
 * duplication evidence, mirroring `FeaturedCard`/`FormField` placement.
 *
 * Presentational only — no `useList`/`useResource`/`api.create|update|remove`
 * calls anywhere in this file. Live data (a `value` like a fetched total or
 * formatted currency string) is owned by the caller and passed down as a
 * `ReactNode`. No sibling `src/containers/widget-stats-tile-container/`
 * is needed because this component has no data-fetching concerns to lift
 * — a container here would be a forwarding shim with no internal logic.
 *
 * Composition: a colored icon block (conditional `icon` prop, the A-variant
 * from the demo) and a label+value text stack, both vertically centered in
 * a flex row, all inside a borderless card. B-variant (`icon` omitted) is
 * structurally identical minus the icon block — one component covers both
 * via a single ternary on `icon`, not two separate sub-components. This is
 * the explicit dedupe of the 8-card demo row documented in Stage 1 §1.
 *
 * Tailwind: not used. `frontend/package.json` has zero Tailwind deps;
 * ADR-0012 forbade reintroducing it and ADR-0042 carries that rule forward;
 * root `CLAUDE.md` says "Don't reintroduce a Tailwind class or config file."
 * Every class string below is a Bootstrap 5 utility class, shipped inside
 * `admin-lte/dist/css/adminlte.min.css` (which bundles Bootstrap in full).
 */
import { createElement, ReactNode } from "react";
import type { CWidgetStatsColor } from "./types";

/** Icon-block bg + readable-text pair, looked up by `color` at render time. */
export const tileBgClassName: Record<CWidgetStatsColor, string> = {
  primary: "bg-primary text-white",
  secondary: "bg-secondary text-white",
  success: "bg-success text-white",
  danger: "bg-danger text-white",
  warning: "bg-warning text-white",
  info: "bg-info text-white",
  light: "bg-light text-dark",
  dark: "bg-dark text-white",
};

/** Value-text color matches the icon-block color so the tile is internally color-coordinated. */
export const valueClassName: Record<CWidgetStatsColor, string> = {
  primary: "text-primary",
  secondary: "text-secondary",
  success: "text-success",
  danger: "text-danger",
  warning: "text-warning",
  info: "text-info",
  light: "text-light",
  dark: "text-dark",
};

export interface WidgetStatsTileProps {
  /** Contextual color for both the icon block (when shown) and the value text. */
  color: CWidgetStatsColor;
  /** Small uppercase label rendered under the value. Plain string — callers own any localization. */
  title: string;
  /**
   * Big primary text rendered above the title. `ReactNode` so callers pass
   * pre-formatted strings (currency, counts, status) or even inline JSX —
   * the component owns layout, not formatting. `null`/`undefined` is the
   * caller's "not yet loaded" sentinel; the component renders the value as-is.
   */
  value: ReactNode;
  /**
   * Optional **Font Awesome class string**, e.g. `"fa-solid fa-folder"`
   * (ADR-0042). When supplied, renders the leading colored icon block
   * (A-variant); when omitted, omits the block entirely (B-variant). A
   * `fa-2x` size class is added by this component, matching the demo's own
   * icon size — so size is not exposed as a prop (Stage 1 §3).
   *
   * **This prop's contract changed in the AdminLTE migration.** It previously
   * took a bare CoreUI icon *name* (`"cilFolder"`) and passed it straight to
   * `CIcon icon={icon}` — but `CIcon` can only resolve a bare name string
   * against a global icon registry (`React.icons`), which this app never set
   * up. The tile's icon block was therefore almost certainly rendering an
   * empty SVG the whole time: a latent pre-existing bug this migration
   * incidentally fixes, not one it introduced.
   */
  icon?: string;
  /** Optional heading-level for `title`. Default `"div"` (matches the demo); pass `"h2"`/`"h3"`/... for screen-reader / heading-hierarchy correctness on the host page. */
  titleAs?: "div" | "h2" | "h3" | "h4" | "h5" | "h6";
  /** Same as `titleAs`, for the `value`. Default `"div"` (matches the demo). */
  valueAs?: "div" | "h2" | "h3" | "h4" | "h5" | "h6";
  /** Appended last, for callers that need to adjust layout/spacing. Matches `FeaturedCard`/`Button` precedent. */
  className?: string;
  /** Forwarded to the card root as `data-testid` — matches `OrgHome`'s `<CWidgetStatsA data-testid="widget-project-count" ... />` and `TestCycleDetail.StatTile`'s own `testId` prop. */
  testId?: string;
}

export function WidgetStatsTile({
  color,
  title,
  value,
  icon,
  titleAs = "div",
  valueAs = "div",
  className,
  testId,
}: WidgetStatsTileProps) {
  const cardClassName = className ? `card overflow-hidden ${className}` : "card overflow-hidden";

  return (
    <div className={cardClassName} data-testid={testId}>
      <div className="card-body p-0 d-flex align-items-center">
        {icon !== undefined && (
          <div className={`${tileBgClassName[color]} p-4 me-3`}>
            <i className={`${icon} fa-2x`} aria-hidden="true" />
          </div>
        )}
        <div>
          {createElement(
            valueAs,
            { className: `${valueClassName[color]} fs-6 fw-semibold` },
            value,
          )}
          {createElement(
            titleAs,
            { className: "text-body-secondary text-uppercase fw-semibold small" },
            title,
          )}
        </div>
      </div>
    </div>
  );
}
