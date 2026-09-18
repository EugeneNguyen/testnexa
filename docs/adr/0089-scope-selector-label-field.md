# 0089. `ScopeSelectorOption` gains `label_field` — closes a gap that made every scope-selector picker show the raw id

**Status:** Accepted
**Decider:** xuanbinh91@gmail.com (CTO)
**Date:** 2026-09-18
**Related:** [ADR-0081](0081-scope-selector-cascading-via.md) (whose own Consequences flagged this exact gap, unfixed, as "cosmetic, not a CRUD blocker"), [ADR-0087](0087-fk-select-for-bounded-catalogs.md) (the dropdown rollout that turned "cosmetic" into "every option is a UUID, in your face"), [ADR-0088](0088-picker-display-name-never-raw-id.md) (the sibling fix for `Defect`/`TestExecution`'s own missing display columns — a different bug, discovered while chasing this one)

## Context

Fixing ADR-0088 didn't fix the CTO's actual live complaint — a follow-up manual test on `/admin/test-conditions` still showed the raw requirement id in the "Filter by requirement" dropdown, even though `Requirement.description` is a required, non-null column and the served schema already carried `"select": true`.

Root cause, found by probing the live picker's rendered `<option>` text directly: **`ScopeSelectorOption` never had a `label_field` at all.** `FieldMeta.label_field` and `CompoundCreateAction.parent_label_field` both exist and both get threaded to their own picker's `labelField` prop — but `ScopeSelector.tsx`'s own render of `FkAutocomplete`/`FkSelect` never received a `labelField` prop, at all, since the component was first written. `FkAutocomplete`'s `labelFor()` falls back to `String(row.id)` whenever `labelField` is falsy — so every scope-selector picker in the app, for every entity, has always rendered the raw id. ADR-0081's own Consequences section already named this precisely ("`ScopeSelector` never passes `labelField` to its own `FkAutocomplete`... cosmetic, not a CRUD blocker, a distinct contained follow-up") and it sat unfixed. ADR-0087 turning these pickers into real `<select>` dropdowns is what made the gap impossible to miss — a type-to-search box hides a wall of ids somewhat; a dropdown puts every one directly in the user's face.

ADR-0088's fix (a computed `display_name` for `Defect`/`TestExecution`) was necessary but not sufficient — it fixed *what value* those two entities' own summary rows carry for a label, but the picker had no mechanism to request *any* label field for *any* entity going through `ScopeSelector`, so a correct `display_name` value was equally invisible until this ADR's fix landed too.

## Decision

Add `label_field: str | None = None` to `ScopeSelectorOption` (`crud_factory.py`), serialized as `"labelField"` (same omit-when-unset convention as `label`/`select`). Thread it through `ScopeSelector.tsx` to both the outer option's control and its `via`'s control (`labelField={active.labelField}` / `labelField={active.via!.labelField}`).

Set `label_field` on every existing `ScopeSelectorOption` declaration in the codebase (26 occurrences across `assets.py`, `governance.py`, `execution.py`, `planning.py`, `test_plan_membership.py`, `test_suite_membership.py`, `trace.py`), matching the same convention already used for that `ref_entity` elsewhere (`FieldMeta.label_field`/`CompoundCreateAction.parent_label_field`):

| `ref_entity` | `label_field` |
|---|---|
| `requirement` | `description` |
| `test-case` | `title` |
| `test-condition` | `description` |
| `test-plan` | `identifier` |
| `test-suite` | `name` |
| `test-cycle` | `name` |
| `project` | `name` |
| `defect` | `display_name` (ADR-0088) |
| `test-execution` | `display_name` (ADR-0088) |

## Consequences

- Every scope-selector picker in the app now shows a real, human-readable label instead of a raw UUID — not just `test-conditions`' "Filter by requirement," every one of the 26 declarations above, including every `via` step.
- No backend route/permission/schema change — a new optional dataclass field plus its serialization, and 26 one-line additions to existing declarations.
- Two new Vitest regression tests in `scope-selector.test.tsx` pin this exact fix: an option (and separately a `via` option) with `labelField` set renders the configured field's value, not the raw id, in its picker's results.
- Verified live against the real running `main` stack: served schema for `test-conditions` now carries `"labelField": "description"` on its `scopeSelector`; the actual rendered `<option>` text is the requirement's real description, not its id.
- Backend unit 915/915 unchanged. Frontend `tsc --noEmit` clean; Vitest 795/795 (793 pre-existing + 2 new).
- **The general lesson, worth restating**: a "same shape, different purpose" sibling of an existing mechanism (`ScopeSelectorOption` next to `FieldMeta`/`CompoundCreateAction`) can silently omit a field the others all have, and nothing catches it until a human looks at the *rendered result* of that specific mechanism — `tsc`/Vitest/backend-unit all stayed green for the gap's entire lifetime (since ADR-0053 first wrote `ScopeSelector`), because a missing *optional* prop compiles fine and a picker showing an id instead of a name is not a thrown error, just a design flaw. ADR-0081 flagging the gap in prose and root `CLAUDE.md`'s Testing section both already say a live manual pass is load-bearing for exactly this class of issue — this is the second time in as many days this session hit it directly (ADR-0088 was the first).

## Alternatives considered

- **Auto-derive the label field from wherever that `ref_entity` already declares one elsewhere** (e.g. scan `ALL_ENTITY_CONFIGS` for any `FieldMeta` naming this `ref_entity` and reuse its `label_field`). Rejected — over-engineered for the actual need: `FieldMeta.label_field`/`CompoundCreateAction.parent_label_field` are both plain, hand-declared strings for the exact same reason (a picker's ideal label can differ from the referenced entity's own natural one — see `CompoundCreateAction`'s own `executed_at`-not-`result` precedent), and a cross-registry lookup would be a real generalization with its own edge cases (which of several `FieldMeta` entries wins?) for a problem a one-line-per-declaration fix already solves completely.
