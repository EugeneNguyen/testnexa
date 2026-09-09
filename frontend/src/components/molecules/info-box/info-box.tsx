/**
 * `InfoBox` shared presentational primitive — AdminLTE v4's own documented
 * **Info Box** widget (https://adminlte.io/themes/v4/widgets/info-box.html),
 * per DS-3 / [ADR-0045](docs/adr/0045-ds-3-infobox-widget-consolidation.md).
 *
 * Replaces **two** independently hand-rolled stat tiles that predated
 * [ADR-0042](docs/adr/0042-adminlte-design-system.md)'s design-system swap and
 * were carried forward by its markup-only reclass rather than replaced:
 * `WidgetStatsTile` (`OrgHome`'s 2 count widgets, a CoreUI-free-template card
 * composition) and `TestCycleDetail`'s local `StatTile` (its 4
 * execution-dashboard tiles, a different card composition). Both are deleted by
 * this story; neither shape survives anywhere in `frontend/src` (TC-DS-019).
 *
 * ## Markup provenance — where every class string below came from
 *
 * Raw HTML/JSX against the shipped CSS, the repo-wide rule as of ADR-0042. The
 * structural classes (`.info-box`, `.info-box-icon`, `.info-box-content`,
 * `.info-box-text`, `.info-box-number`) are the five AdminLTE actually defines —
 * confirmed by direct grep of `admin-lte/dist/css/adminlte.css` (the block at
 * `:14857`), which yields exactly six `.info-box*` selectors: those five plus
 * `.info-box-more` (a "read more" link slot neither call site uses).
 *
 * The **contextual color** on the icon block was the open item ADR-0045 and the
 * DS-3 UI Design Document §4 both deferred to implementation, precisely because
 * it is *not* derivable from the CSS: `src/scss/_info-box.scss` bakes in no
 * color at all (verified — the only color-ish declarations in the whole file are
 * `--bs-body-color`/`--bs-body-bg` on the root and `--lte-card-variant-color` on
 * the optional `.progress` slot), so the demo must be supplying it via a utility
 * class in *markup*, which no amount of reading the stylesheet can reveal.
 * Resolved empirically per root `CLAUDE.md`'s "dump the real DOM, don't invent a
 * class name" rule, by fetching the demo page's own served HTML and extracting
 * every `.info-box-icon` element's literal `class` attribute:
 *
 *   info-box-icon text-bg-primary shadow-sm   (x2)
 *   info-box-icon text-bg-success shadow-sm   (x2)
 *   info-box-icon text-bg-warning shadow-sm   (x2)
 *   info-box-icon text-bg-danger  shadow-sm   (x2)
 *   info-box-icon                             (x8)
 *
 * So the answer is **`text-bg-{color}` + `shadow-sm`**, and the eight uncolored
 * occurrences are not a competing convention for this element — they belong to
 * the demo's separate "Info Box With `bg-*`" section, where the color moves to
 * the *root* (`div.info-box.text-bg-primary`) and the icon inherits it. That's a
 * whole-box-colored variant neither of this story's call sites uses, and it is
 * explicitly out of scope (UI Design Document §5).
 *
 * Note this is a genuine, deliberate divergence from the badge convention root
 * `CLAUDE.md` documents (badges use `bg-*`, **not** Bootstrap 5.3's `text-bg-*`,
 * and 8+ assertions check that exact class). AdminLTE is simply not uniform
 * here — which is exactly why the UI Design Document forbade guessing from the
 * Bootstrap convention and required a real DOM read instead. `.text-bg-*` is
 * defined for all eight `CWidgetStatsColor` members in both
 * `bootstrap/dist/css/bootstrap.min.css` and `admin-lte/dist/css/adminlte.min.css`
 * (grepped: eight each, no ninth), so every member of the union is renderable.
 *
 * The demo's own `<i>` uses Bootstrap Icons (`bi bi-gear-fill`). We do **not**
 * follow it there: this repo ships exactly one icon library, Font Awesome
 * (ADR-0042 — "do not add Bootstrap Icons back"), so the `icon` prop takes an FA
 * class string and the surrounding `<span>` is what's copied verbatim.
 *
 * ## Tier placement
 *
 * `frontend/src/components/molecules/` per [ADR-0043](docs/adr/0043-atomic-design-tiering-for-frontend-components.md)
 * (which superseded [ADR-0023](docs/adr/0023-frontend-shared-component-location.md)'s
 * `components/shared/` location while this component was mid-flight — rebased
 * onto the new convention rather than shipped at a now-dead path) — the same
 * tier `FeaturedCard`/`FormField` and the retired `WidgetStatsTile` occupy.
 * Deliberately **not** `container/` (where DS-2's `Table` lives, an axis
 * ADR-0043 left untouched): this component owns no state, no actions, and no
 * data fetching. Every value it renders is a prop. A sibling container here
 * would be a forwarding shim with no internal logic.
 *
 * ## Sentinel conventions are the caller's, not this component's (TC-DS-022)
 *
 * `number` is a bare `ReactNode` and this component makes no assumption about
 * what a caller puts in it. Two different conventions coexist through it today
 * and neither leaks into the other's call site:
 *
 *   - `OrgHome`'s `widgetValue()` tri-state — `"Loading…"` / `"Unable to load"` /
 *     the real count, so a still-in-flight or failed fetch never renders a false
 *     `0` (NFR-27, TC-SHELL-011).
 *   - `TestCycleDetail`'s `null` → `"—"` sentinel for a cycle with zero
 *     executions of a given `result`.
 *
 * This looseness is inherited from `WidgetStatsTile`'s own `value` prop, not
 * introduced here — ADR-0045's Consequences names it explicitly as a
 * trade-off worth watching if a third caller ever invents a third convention.
 */
import { ReactNode } from "react";
import type { CWidgetStatsColor } from "./types";

/**
 * Icon-block contextual color, looked up by `color` at render time.
 *
 * Exported so tests can assert against the same source of truth the component
 * renders from, rather than re-hardcoding the class strings (which is how the
 * retired `WidgetStatsTile`'s own `tileBgClassName` was used).
 */
export const infoBoxIconColorClassName: Record<CWidgetStatsColor, string> = {
  primary: "text-bg-primary",
  secondary: "text-bg-secondary",
  success: "text-bg-success",
  danger: "text-bg-danger",
  warning: "text-bg-warning",
  info: "text-bg-info",
  light: "text-bg-light",
  dark: "text-bg-dark",
};

export interface InfoBoxProps {
  /**
   * Contextual color for the icon block. Has no effect when `icon` is omitted —
   * AdminLTE's Info Box colors the *icon block*, not the label or the number
   * (unlike the retired `StatTile`, which colored the number text via
   * `text-{color}`; see this file's own migration note in ADR-0045).
   */
  color: CWidgetStatsColor;
  /** Small label, rendered in `.info-box-text` above the number. Plain string — callers own any localization. */
  text: string;
  /**
   * The metric itself, rendered in `.info-box-number`. `ReactNode` so callers
   * pass pre-formatted strings, counts, or their own sentinels — see this
   * file's header on why the component stays agnostic to which convention.
   */
  number: ReactNode;
  /**
   * Optional **Font Awesome class string**, e.g. `"fa-solid fa-folder"`.
   * When supplied, renders the leading colored `.info-box-icon` block; when
   * omitted, the element is **not rendered at all** — not rendered empty
   * (TC-DS-021). AdminLTE's demo never showcases omitting it, but the block is
   * structurally optional in the CSS and `TestCycleDetail`'s 4 tiles use that
   * path (no natural icon exists for a bare pass/fail/blocked/skipped count).
   */
  icon?: string;
  /** Forwarded to the `.info-box` root as `data-testid`. */
  testId?: string;
  /**
   * Forwarded to the `.info-box-number` element as `data-testid`.
   *
   * Not in the UI Design Document §2 prop list — added during implementation
   * because TC-DS-020 requires `TestCycleDetail`'s existing
   * `dashboard-tile-{pass,fail,blocked,skipped}-count` testids to keep resolving
   * to **the number element specifically**, and four existing Vitest assertions
   * check `.textContent` is exactly `"12"`/`"3"`/`"0"` etc. Wrapping the value
   * in a caller-supplied `<span data-testid=...>` instead would nest an extra
   * node inside `.info-box-number` and diverge from the demo's markup, so the
   * testid goes on AdminLTE's own element via this prop. See the DS-3 completion
   * report for this being flagged rather than silently absorbed.
   */
  numberTestId?: string;
  /** Appended last to the root's class list, for callers needing layout/spacing tweaks. Matches the `FeaturedCard`/`Button` precedent. */
  className?: string;
}

export function InfoBox({
  color,
  text,
  number,
  icon,
  testId,
  numberTestId,
  className,
}: InfoBoxProps) {
  const rootClassName = className ? `info-box ${className}` : "info-box";

  return (
    <div className={rootClassName} data-testid={testId}>
      {icon !== undefined && (
        <span className={`info-box-icon ${infoBoxIconColorClassName[color]} shadow-sm`}>
          <i className={icon} aria-hidden="true" />
        </span>
      )}
      <div className="info-box-content">
        <span className="info-box-text">{text}</span>
        <span className="info-box-number" data-testid={numberTestId}>
          {number}
        </span>
      </div>
    </div>
  );
}
