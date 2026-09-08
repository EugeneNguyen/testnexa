/**
 * `Icon` atom — Font Awesome Free (`fa-{variant} fa-{name}`), per ADR-0042.
 *
 * **This resolves the open question this file used to carry.** The original
 * version emitted Bootstrap Icons classes (`bi bi-<name>`) against a font that
 * was never loaded: its own docstring flagged that every glyph rendered blank,
 * and that fixing it needed an ADR rather than a silently-added CDN link,
 * because the then-current root `CLAUDE.md` mandated `@coreui/icons`/`CIcon`
 * ("no second icon library"). ADR-0042 replaces CoreUI with AdminLTE v4 and
 * adopts Font Awesome — AdminLTE's own icon convention — as the project's
 * single icon library. `@fortawesome/fontawesome-free/css/all.min.css` is now
 * imported in `main.tsx`, so these glyphs actually render.
 *
 * Font Awesome is a pure-CSS icon library: there is no icon component and no
 * path-array import (the `@coreui/icons` model). An icon is an `<i>` carrying
 * a style class plus a name class, which is why this atom takes strings rather
 * than an imported icon object.
 *
 * `variant` selects the Font Awesome style: `solid` (the default, and the only
 * one with full coverage in the Free tier), `regular` (outline — Free ships
 * only a small subset), and `brands` (third-party logos such as Facebook and
 * Google, which live in `fa-brands` and are NOT reachable via `fa-solid`).
 * Passing `variant="brands"` for a logo is mandatory, not cosmetic: the glyph
 * simply does not exist in the solid font.
 */
export type IconVariant = "solid" | "regular" | "brands";

export interface IconProps {
  /** Font Awesome name WITHOUT the `fa-` prefix, e.g. `"envelope"`, `"lock"`, `"facebook"`. */
  name: string;
  /** Font Awesome style. Brand logos (facebook/google/...) MUST use `"brands"`. */
  variant?: IconVariant;
  /** Adds `me-2` end-margin — set for icons sitting left of label text (social buttons); omit for bare input-group icons. */
  spaced?: boolean;
  /** Appended last, for callers that need to adjust layout/spacing or a size class (`fa-lg`, `fa-2x`). */
  className?: string;
}

export function Icon({ name, variant = "solid", spaced = false, className }: IconProps) {
  const classNames = [`fa-${variant}`, `fa-${name}`, spaced ? "me-2" : "", className]
    .filter(Boolean)
    .join(" ");

  return <i className={classNames} aria-hidden="true" />;
}
