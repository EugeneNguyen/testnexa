# 0087. Bounded-catalog `fk` pickers (scope-selector and compound-create parent) render as `FkSelect`, declared per-option

**Status:** Accepted
**Decider:** xuanbinh91@gmail.com (CTO)
**Date:** 2026-09-17
**Related:** [ADR-0086](0086-child-compound-create-parent-picker.md)'s own Amendment (the `FkSelect` swap for `TestCycle`'s parent picker this ADR generalizes), REQ-5 (the original `FieldMeta.select`/`FkSelect` precedent for `EntityForm`'s own writable fields)

## Context

After [ADR-0086](0086-child-compound-create-parent-picker.md)'s Amendment swapped `TestCycle`'s own compound-create parent picker from `FkAutocomplete` to `FkSelect`, the CTO asked to "apply this to all type to search boxes" — every remaining `FkAutocomplete` search box in the app.

Applying it literally would be wrong. `FkSelect` (REQ-5) fetches its ref entity's full list **once**, capped at `FULL_LIST_PAGE_SIZE` (100), with no `?q=` search — its own docstring already restricts it to "a small, bounded catalog... never for an unbounded ref entity like `Requirement`/`Project`." Auditing every live `FkAutocomplete` call site (`ScopeSelector`'s own options, `EntityListPage`/`EntityRelationTab`'s compound-create parent pickers, `TestPlanDetail`'s bespoke Release/Environment pickers, `TestCycleDetail`'s scoped Test Case picker) found the ref entities split cleanly into two groups:

- **Genuinely small and bounded, safe to swap:** `test-plan`, `test-suite`, `test-cycle` (typically a handful per project/plan), `release`, `environment` (typically a handful per project).
- **Can grow unboundedly per project, unsafe to swap:** `requirement`, `test-case`, `defect`, `test-execution`, `test-condition`, `project` — forcing these onto `FkSelect` would silently truncate the choices past 100 rows and remove search entirely, a correctness regression dressed as a UI preference.

Two of `EntityForm`'s own render sites already made exactly this call generically via `FieldConfig.select` (REQ-5) — `EntityForm.tsx`'s and `FilterModal.tsx`'s `fk` case both already branch `field.select ? FkSelect : FkAutocomplete`. What had no equivalent lever: `ScopeSelectorOption` (the standalone-list "pick a parent row before the list can fetch" step) and `CompoundCreateAction`'s own parent picker (ADR-0078/0079/0086) — both were unconditionally `FkAutocomplete`, with no way to opt a specific, vetted-bounded declaration into `FkSelect` without hardcoding the component per call site (which is what ADR-0086's Amendment did, and which does not generalize to `ScopeSelector`'s many other declarations sharing one render path).

## Decision

Add the same opt-in boolean two more places, mirroring `FieldMeta.select`'s existing shape and caveat:

- `ScopeSelectorOption.select: bool = False` (`crud_factory.py`) — including on a `via` (the two-hop preceding pick, ADR-0081). Serialized camelCase (`"select": true`) only when set, same omit-when-false convention `ScopeSelectorOption.label`/`via` already use.
- `CompoundCreateAction.parent_select: bool = False` — serialized as `"parentSelect"` (always present, `true`/`false`, matching `linksAutomatically`'s own always-present convention on the same object).

Frontend: `ScopeSelectorOption`/`CompoundCreateAction`'s TS types gain `select?`/`parentSelect?: boolean`. `scope-selector.tsx` picks `FkSelect` when the active option's (or its `via`'s) `select` is `true`; `EntityListPage.tsx`'s and `EntityRelationTab.tsx`'s compound-create parent pickers pick `FkSelect` when `childCompoundCreate.parentSelect`/`activeCompoundCreate.parentSelect` is `true` — replacing ADR-0086's own hardcoded `FkSelect`, now correctly declared rather than assumed. `TestPlanDetail.tsx`'s two bespoke pickers (`Release`, `Environment` on the "Create Cycle" modal) are hardcoded `FkSelect` directly (same as `EntityForm`'s own release_id/environment_id fields, ADR-0086) — there is no per-declaration config object here to hang a flag off, and both ref entities are unconditionally bounded regardless of which screen renders them.

Declarations set `select`/`parentSelect=True` for: `TestCycle`'s "By test plan" scope-selector arm and its `test-plan` compound-create parent (ADR-0086); `EntryExitCriteria`'s single-option `test-plan` scope-selector; `TestPlan`↔`TestSuite`'s both scope-selector arms (`test-plan`, `test-suite`); `TestSuite`↔`TestCase`'s `test-suite` arm only (`test-case` stays `False`); `TestExecution`'s "By test cycle" arm and its own `via` (`test-plan`) (`test-case` arm stays `False`); `RiskItem`'s "By test plan" arm (`requirement` arm stays `False`). Left `False` (unchanged `FkAutocomplete`) everywhere the ref entity is `requirement`/`test-case`/`defect`/`test-execution`/`test-condition`/`project` — nine declarations across `assets.py`/`trace.py`/`execution.py`'s own `TestLog` scope-selector.

## Consequences

- Nine `ScopeSelectorOption` declarations and one `CompoundCreateAction` gain the dropdown; nine others (the genuinely unbounded ref entities) are unchanged, by explicit design, not oversight.
- `TestPlanDetail`'s "Create Cycle" modal's Release/Environment fields are now dropdowns too — the same live-manual-test-feedback fix as `EntityForm`'s own release_id/environment_id (ADR-0086), applied to the one remaining bespoke screen with the identical pair of fields.
- No backend route/permission/schema change — purely a picker-widget declaration and its frontend rendering.
- Verified live against the real running `main` stack: `GET /entities/test-cycles/schema` serves `scopeSelector[0].select: true`; `TestPlanDetail`'s Create Cycle modal renders both Release and Environment as native `<select>` elements.
- Backend unit 915/915 (one exact-dict-shape test in `test_adr78_compound_create_actions.py` updated for the new `parentSelect` key). Frontend `tsc --noEmit` clean; Vitest 793/793 (`TestPlanDetail.TestCycles.test.tsx`'s `pickFromAutocomplete` helper replaced with a `pickFromSelect` waiting on the option to exist before firing `change`, since `FkSelect` fetches its list once on mount rather than on keystroke).

## Alternatives considered

- **Apply `FkSelect` to every `FkAutocomplete` call site literally**, per the instruction's own wording. Rejected — `FkSelect`'s own docstring is explicit that this is only safe for a bounded catalog; doing it for `requirement`/`test-case`/`defect`/etc. would silently cap the picker at 100 rows with no way to search past it, a functional regression, not a preference. The instruction's *intent* (dropdown for boxes searching a small fixed list) is satisfied by scoping the swap to the entities that are actually small and fixed, and stating explicitly which ones are excluded and why.
- **A single global "always prefer `FkSelect`" toggle** instead of a per-declaration flag. Rejected — the whole point is that boundedness is a property of the *ref entity in this specific context*, not a project-wide constant; `test-case` is bounded when scoped to one test suite (arguably) but not when it's the project-wide picker `EntityRelationTab`'s "By test case" arm uses, so a global flag can't express the distinction a per-declaration one already does trivially.

### Amendment (2026-09-17): the excluded nine converted too, on explicit instruction

Right after this ADR merged, the CTO pointed at `/admin/test-conditions` still showing a type-to-search box (its own single-option `requirement` scope-selector) and asked to apply the dropdown "to all similar things." Asked explicitly whether that meant overriding this ADR's own bounded-catalog safety judgment for the nine excluded declarations (`requirement`/`test-case`/`defect`/`test-execution`/`test-condition`, accepting the 100-row-cap-with-no-search tradeoff) — answer: yes, convert all remaining ones.

Set `select=True`/`parent_select=True` on every remaining `ScopeSelectorOption` (including two more `via` picks) and `CompoundCreateAction` whose `ref_entity`/`parent_entity` is one of those five, across `assets.py` (`TestCondition`, `TestStep`), `governance.py` (`RiskItem`'s `requirement` arm, `Attachment`), `execution.py` (`Defect`, `TestExecution`'s `test-case` arm, `TestLog`), `test_suite_membership.py` (the `test-case` arm), and `trace.py` (all five link-table configs plus both compound-create parent pickers). Also widened the matching `FieldMeta.select` wherever the same ref entity appears as a genuinely writable form field (e.g. `RiskItem.requirement_id`, on its own `create_schema`), not just as a list-scoping picker — same mechanism REQ-5 already established, same widening this ADR's own Decision only applied to the bounded five.

`project` stays excluded — every live `ref_entity="project"` FieldMeta is on that entity's own scope-field FK, always `readOnly`/locked (never an editable search box regardless of widget choice), so there was nothing live left to convert.

Verified live against the real running `main` stack: served schema for `test-conditions` now carries `scopeSelector.select: true`; the `/admin/test-conditions` screen renders "Filter by requirement" as a native `<select>`. Backend unit 915/915 (no exact-dict-shape assertion broke — none of the touched tests pin `select`'s absence). Frontend `tsc --noEmit` clean; Vitest 793/793 unchanged (no test asserted the excluded five stayed `FkAutocomplete`).
