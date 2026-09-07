/**
 * `CWidgetStatsColor` — the full CoreUI 5.x contextual color token set used
 * by `WidgetStatsTile`. Matches `@coreui/react`'s own `CWidgetStatsA`
 * `color` prop union (verified in `node_modules/@coreui/react`'s bundled
 * `.d.ts`), widened to the entire CoreUI palette rather than restricting
 * to the 4 demo colors (`primary`/`info`/`warning`/`danger`) — see
 * Stage 1 Q5 + Stage 2 style-mapping comments on TNX-0054.
 *
 * `light` and `dark` aren't on the CoreUI widget demo page; their class
 * pairings follow CoreUI 5.x defaults (`bg-light` is near-white, needs
 * `text-dark`; `bg-dark` is near-black, needs `text-white`) and are TODO'd
 * for visual QA against an isolated stack before being called "stable".
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
