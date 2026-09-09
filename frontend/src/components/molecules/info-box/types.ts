/**
 * `CWidgetStatsColor` — the contextual color token set used by `InfoBox`.
 *
 * Moved here verbatim from `components/shared/widget-stats-tile/types.ts` by
 * DS-3 ([ADR-0043](docs/adr/0043-ds-3-infobox-widget-consolidation.md)), which
 * deletes that directory outright. The union itself is unchanged — every color
 * either retired component used (`OrgHome`: `primary`/`info`;
 * `TestCycleDetail`: `success`/`danger`/`warning`/`secondary`) is already a
 * member, so no caller needed widening.
 *
 * Originally derived from `@coreui/react`'s own `CWidgetStatsA` `color` prop
 * union, widened to the full palette rather than the 4 demo colors. It survived
 * ADR-0042's CoreUI→AdminLTE migration unchanged because these are the standard
 * Bootstrap 5 `$theme-colors` keys, not CoreUI-specific tokens — AdminLTE ships
 * the same eight, and Bootstrap's own `.text-bg-*` utilities (which `InfoBox`
 * applies to `.info-box-icon`, per the AdminLTE demo's own markup) are defined
 * for exactly these eight and no others. Confirmed by direct grep of both
 * `bootstrap/dist/css/bootstrap.min.css` and
 * `admin-lte/dist/css/adminlte.min.css`: `.text-bg-{primary,secondary,success,
 * danger,warning,info,light,dark}`, eight each, no ninth.
 *
 * The `C` name prefix is now a historical artifact of the CoreUI origin rather
 * than a live dependency; renaming it is gratuitous churn across every caller
 * and was deliberately not done by the design-system swap, nor by this story.
 */
export type CWidgetStatsColor =
  | "primary"
  | "secondary"
  | "success"
  | "danger"
  | "warning"
  | "info"
  | "light"
  | "dark";
