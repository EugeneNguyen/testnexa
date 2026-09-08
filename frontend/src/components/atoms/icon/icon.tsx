/**
 * `Icon` atom — Bootstrap Icons (`bi bi-<name>`), per this story's
 * Style-Translation-stage comment on TNX-0056.
 *
 * **Not yet wired to a loaded font.** This repo's own root `CLAUDE.md`
 * mandates `@coreui/icons`/`CIcon` ("no second icon library") and only
 * `coreui.min.css` is imported in `main.tsx` — `bootstrap-icons` (the CDN
 * stylesheet AdminLTE's own source page loads) is NOT added here. Structural
 * markup matches the source verbatim (`bi bi-envelope`, `bi-lock-fill`,
 * `bi-facebook`, `bi-google`, ...) so callers compile and layout correctly,
 * but glyphs will render blank until the open question flagged in the
 * Decomposition/Style-Translation stage comments (write an ADR authorizing
 * Bootstrap Icons as an AdminLTE-screen exception, then add the dependency)
 * is resolved. Do not silently add the `bootstrap-icons` CDN link to fix
 * this — it's an architecture decision, not a scaffolding detail.
 */
export interface IconProps {
  /** Bootstrap Icons name suffix, e.g. "envelope", "lock-fill", "facebook", "google". */
  name: string;
  /** Adds `me-2` end-margin — set for icons sitting left of label text (social buttons); omit for bare input-group icons. */
  spaced?: boolean;
  /** Appended last, for callers that need to adjust layout/spacing. */
  className?: string;
}

export function Icon({ name, spaced = false, className }: IconProps) {
  const classNames = ["bi", `bi-${name}`, spaced ? "me-2" : "", className]
    .filter(Boolean)
    .join(" ");

  return <i className={classNames} aria-hidden="true" />;
}
