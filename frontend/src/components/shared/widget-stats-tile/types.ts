/**
 * `CWidgetStatsColor` — the contextual color token set used by
 * `WidgetStatsTile`. Originally derived from `@coreui/react`'s own
 * `CWidgetStatsA` `color` prop union, widened to the full palette rather than
 * the 4 demo colors (`primary`/`info`/`warning`/`danger`) — see Stage 1 Q5 +
 * Stage 2 style-mapping comments on TNX-0054.
 *
 * The union survives ADR-0042's CoreUI→AdminLTE migration unchanged, because
 * these are the standard Bootstrap 5 `$theme-colors` keys, not CoreUI-specific
 * tokens — AdminLTE ships the same eight. The `C` name prefix is now a
 * historical artifact of the CoreUI origin rather than a live dependency;
 * renaming it is a gratuitous churn across every caller and was deliberately
 * not done as part of the design-system swap.
 *
 * `light` and `dark` weren't on the originating widget demo page; their class
 * pairings follow the Bootstrap defaults (`bg-light` is near-white, needs
 * `text-dark`; `bg-dark` is near-black, needs `text-white`) and are still
 * TODO'd for visual QA against an isolated stack before being called "stable".
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
