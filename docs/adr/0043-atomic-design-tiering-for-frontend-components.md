# ADR-0043: Atomic-design tiering (`atoms`/`molecules`/`organisms`/`templates`) replaces `components/shared/` and `components/crud/`

**Date:** 2026-09-08
**Status:** Accepted — supersedes [ADR-0023](0023-frontend-shared-component-location.md)'s directory-location decisions (`components/shared/` vs. `components/crud/`); ADR-0023's `FormField` error-display convention (already partially superseded by [ADR-0042](0042-adminlte-design-system.md)) is untouched by this ADR. [ADR-0041](0041-ds-2-table-container-shared-pagination.md)'s `container/` axis (stateful cross-screen behavior) is untouched.
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0023](0023-frontend-shared-component-location.md) (location decision this supersedes), [ADR-0041](0041-ds-2-table-container-shared-pagination.md) (`container/`, orthogonal axis), [ADR-0042](0042-adminlte-design-system.md) (AdminLTE v4, unrelated axis)

## Context

ADR-0023 (2026-09-05) deliberately rejected a full atoms/molecules/organisms/templates tiering, on the explicit premise that only one component (`FormField`) had real duplication evidence behind it at the time — a four-tier directory structure for one component was named speculative structure the DS-1 story's own business case found unsupported.

That premise no longer holds. Since ADR-0023, the codebase independently grew a real, populated tiered system: `atoms/` (`Button`, `Card`, `Checkbox`, `Icon`, `TextInput`, `TextLink`, `BrandLogo`), `molecules/` (`ButtonStack`, `IconInputGroup`, `LabeledCheckbox`, `SocialAuthButton`, `SocialAuthPanel`), `organisms/` (`LoginForm`, `LoginPanel`), and `templates/` (`AuthBoxLayout`) — introduced for the Button/ButtonStack story and then populated wholesale by the AdminLTE-sourced login screen (PR #42, TNX-0056). Meanwhile `components/shared/` (`FormField`, `FeaturedCard`, `WidgetStatsTile`) and `components/crud/` (`EntityTable`, `EntityForm`, `FkAutocomplete`, `ScopeSelector`) stayed flat, and the top-level app-shell components (`AppBreadcrumb`, `AppFooter`, `AppHeader`, `AppSidebar`, `AppShell`) sat ungrouped directly under `components/`. Three parallel directory conventions for "a component that's more than page-local" is exactly the ambiguity ADR-0023 was originally opened to prevent, now reproduced one layer up.

The user directed this consolidation directly: fold `crud/`/`shared/` and the top-level `App*` files into the existing tier structure rather than maintaining a second, competing convention alongside it.

## Decision

- **`components/shared/` and `components/crud/` are removed.** Every former inhabitant moves into `atoms/`/`molecules/`/`organisms/`/`templates/`, tiered by composition complexity (not by ADR-0023's old "markup-duplication-evidence vs. generic-entity-shape" axis, which is retired):

  | Component | Old location | New location | Tier rationale |
  |---|---|---|---|
  | `FormField` | `components/shared/` | `components/molecules/form-field/` | label+input+feedback composite, same shape as `IconInputGroup` |
  | `FeaturedCard` | `components/shared/` | `components/molecules/featured-card/` | fixed composite (header+title+body+CTA+footer), no sub-composition of other custom components |
  | `WidgetStatsTile` | `components/shared/widget-stats-tile/` | `components/molecules/widget-stats-tile/` | icon+value+label composite |
  | `FkAutocomplete` | `components/crud/` | `components/molecules/fk-autocomplete/` | single control unit |
  | `ScopeSelector` | `components/crud/` | `components/molecules/scope-selector/` | single control unit |
  | `EntityTable` | `components/crud/` | `components/organisms/entity-table/` | composes `container/Table` + many fields into a full generic-entity section |
  | `EntityForm` | `components/crud/` | `components/organisms/entity-form/` | composes many `FormField`/`FkAutocomplete` instances into a full form |
  | `AppBreadcrumb` | `components/` | `components/organisms/app-breadcrumb/` | page region |
  | `AppFooter` | `components/` | `components/organisms/app-footer/` | page region |
  | `AppHeader` | `components/` | `components/organisms/app-header/` | page region |
  | `AppSidebar` | `components/` | `components/organisms/app-sidebar/` | page region |
  | `AppShell` | `components/` | `components/templates/app-shell/` | composes header+sidebar+footer+content into the page skeleton, same role as `templates/auth-box-layout` |

- **Directory/file naming follows the existing tier convention exactly**: `components/<tier>/<kebab-case-name>/<kebab-case-name>.tsx` + a same-directory `index.ts` barrel. Export style (default vs. named) is preserved per-component as it already was — this ADR moves files, it does not standardize export style, which is a separate, not-yet-made decision.
- **Test files move to mirror**, per `frontend/CLAUDE.md`'s existing "tests mirror `src`'s own directory shape" rule: `tests/components/<tier>/<PascalCaseName>.test.tsx`, flat (no per-component subdirectory on the test side, matching the pre-existing `atoms`/`molecules`/`organisms`/`templates` test convention). The five `App*` component tests, previously flat at `tests/` root (predating this ADR, already an inconsistency with the "mirrors `src`" rule), move under `tests/components/organisms/` and `tests/components/templates/` in the same pass.
- **`container/` is untouched** — [ADR-0041](0041-ds-2-table-container-shared-pagination.md)'s axis (state ownership, not composition complexity) is orthogonal to this ADR's tiering and stays a sibling of `components/`, not a fifth tier inside it.
- **No export-style, prop-API, or behavioral change to any moved component** — this is a pure location/naming move. Every `data-testid` and accessible role is unchanged.

## Consequences

**Positive:** one directory convention for "more than page-local" instead of three (`atoms`/`molecules`/`organisms`/`templates` vs. `shared`/`crud` vs. ungrouped top-level `App*`). New components have one unambiguous question to answer (which tier, by composition complexity) instead of two (which tier *or* which of the two older buckets). `container/`'s own orthogonal axis stays legible now that it's the only remaining exception, not one of three.

**Negative / Trade-offs:** every caller of a moved component needed its import path updated (14 source files, 12 test files) — a real, if mechanical, diff across the frontend. Several file-level doc comments that explicitly asserted "this repo does NOT use atoms/molecules/organisms tiers" (written when that was true, DS-1-era) are now stale claims about the codebase's own shape and were corrected in the same pass, not left to rot the way a genuinely historical ADR record would be.

## Alternatives considered

- **Leave `crud`/`shared` as a third, explicitly-different-axis bucket alongside the tiers** (the position ADR-0023 itself argued for, before the tiers existed) — rejected now: with the tiered system populated and mature, a second bucket adds a decision branch ("does this go by composition-complexity tier, or by the old duplication-evidence/entity-shape axis?") with no remaining benefit; every component that was in `crud`/`shared` fits a tier cleanly on composition complexity alone.
- **Merge `crud/` into `organisms/` wholesale, `shared/` into `molecules/` wholesale, no per-component judgment** — rejected: `FkAutocomplete`/`ScopeSelector` are single control units (molecule-shaped), not full sections (organism-shaped); a blanket bucket-to-tier mapping would misclassify them.
- **Standardize export style (all named, matching `login-panel`'s convention) in the same pass** — rejected: out of this ADR's scope, which is directory location only; several moved components (`EntityForm`, `EntityTable`, `FkAutocomplete`, `ScopeSelector`, `FormField`) use `export default` and keep doing so, a separate decision for a future pass if ever made.
