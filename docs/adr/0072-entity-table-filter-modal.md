# ADR-0072: `EntityTable` filter modal, and `filter_fields` derived from the served schema

**Date:** 2026-09-15
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0022](0022-generic-crud-router-factory.md) (the generic CRUD router factory that introduced `filter_fields`/`?<field>=<value>`, whose per-entity opt-in this ADR replaces with a derivation), [ADR-0053](0053-backend-driven-entity-schema.md) (`GET /entities/{resource}/schema` + `sortable_fields`-derived-from-that-schema — the exact pattern this ADR applies to filters), [ADR-0056](0056-admin-4-generic-admin-crud-column-sort.md) (click-to-sort, the sibling list-query capability), [ADR-0070](0070-search-fields-audit-and-numeric-cast.md) (`?q=` search audit — names `filter_fields` as "the exact-match escape hatch", which this ADR makes real for every entity), [ADR-0071](0071-entity-table-column-preferences.md) (the sibling "Columns" header button, whose modal conventions this reuses and whose persistence decision this deliberately diverges from), [User Stories: ADMIN-2](../user-stories/2026-09-03-taxonomy-admin-crud-stories.md), [TC-ADMIN-053..058](../test-cases/2026-09-03-test-cases.md)

## Context

The generic admin list surface has grown three of the four list-query capabilities a CRUD table needs: pagination (ADR-0022), free-text search (ADR-0022, audited to 19 entities by ADR-0070), and column sort (ADR-0056). The fourth — **exact-match filtering** — has existed backend-side since ADR-0022 and has never had a UI.

Two separate gaps kept it that way.

**First, the UI was removed and nobody noticed.** `EntityTable`'s own module docstring still claims it renders "a filter row for `filterFields`", and its props still declare `filters?: Record<string, string>` and `onFilterChange?: (field, value) => void`. Neither prop is destructured in the component body; neither is rendered anywhere. An earlier refactor dropped the per-column filter row and left the contract behind. Meanwhile `EntityListPage` has continued, the whole time, to own real `filters` state, include it in the list query's `queryKey`, and pass it to `listEntities(..., params: { ...filters, ...scopeParams })`. **The state-to-query pipeline is live and correct end-to-end; only the control that writes to it is missing.**

**Second, and more limiting: `filter_fields` is a per-entity opt-in almost nobody opted into.** Only **7 of 27** registered `CrudEntityConfig`s declare a tuple at all (`attachment`, `test_case`, `risk_item`, `defect`, `test_execution`, `test_log`, `org_membership`), and most of those name one or two columns. Building a filter modal over today's tuples would produce a control that is useful on 7 entities and either empty or near-useless on the other 20 — the same latent shape ADR-0070 found and fixed for `search_fields`, one capability over.

ADR-0070 resolved its version of this with a **hand audit**: 27 entities examined one at a time, a tuple written or an explicit reason recorded for declining. That was the right call *there* because `?q=` is a genuine product judgment — "is this column something a human searches by" has no mechanical answer, and `ILIKE` against a byte count or a closed vocabulary is actively the wrong tool.

Exact-match filtering does not have that property, and the difference is what this ADR turns on.

## Decision

### 1. `filter_fields` is derived from the entity's own served schema, not hand-declared

`FieldMeta` gains `filterable: bool = True`; `derive_entity_schema` serves `"filterable"` on each field alongside the existing `"sortable"`, and its `"filterFields"` key becomes the derived list rather than `list(config.filter_fields)`. The list route computes its filterable set the same way it already computes `sortable_fields` — from `derive_entity_schema(config)["fields"]` at router-build time.

This is deliberately **the same mechanism ADR-0053 already chose for sort**, for the same stated reason, quoted from `crud_factory.py`'s own comment on `sortable_fields`:

> the single source of truth for which columns are sortable is the same `derive_entity_schema` the `GET /entities/{resource}/schema` route serves, not a second hand-kept list (the exact drift ADR-0053 already exists to close).

`CrudEntityConfig.filter_fields` survives as an optional **narrowing** override (unset = derived). The 7 existing declarations are deleted: each is a strict subset of what the derivation yields, so keeping them would leave exactly those 7 entities *less* filterable than the other 20 — the opposite of the intent.

### 2. Why a derivation here, when ADR-0070 chose a hand audit there

Three differences, all of which cut the same way:

- **Exact equality is type-safe on every scalar column; `ILIKE` is not.** ADR-0070 §1 had to add a `CAST(... AS text)` before a numeric column could participate in `?q=` at all — an un-cast `ILIKE` against an `Integer` is a hard Postgres `ProgrammingError`. Equality has no such structural hole: `WHERE column = value` is well-defined for every scalar type this schema uses. The constraint that forced ADR-0070 to reason column-by-column simply does not exist for filters.
- **"Is this a useful filter" has a mechanical answer where "is this searchable" did not.** ADR-0070's §4 exclusions (`Attachment.size_bytes` is a measurement not an identifier; `Defect.status` is a closed vocabulary) are arguments about *substring matching*, and both point the same direction here: a closed vocabulary is exactly what exact-match filtering is *for* (ADR-0070 §4 says so in as many words — "already exactly matchable via `filter_fields`, which is what a closed vocabulary wants"), and an exact byte count is a legitimate, if rare, query. The genuinely bad filter targets are values a user cannot meaningfully type an exact match for — an unbounded free-text column, or a JSON blob — and both are identifiable from the column's own mapped type.
- **A hand-kept list drifts; this repo has the receipts.** `filter_fields` is Exhibit A for the failure mode ADR-0053 was written to end — 20 entities silently non-filterable for months because declaring a tuple was a step nobody's story required. A derivation cannot drift from the schema, because it *is* the schema.

**The rule, then:** every served field is filterable **except those backed by a value no user can type an exact match for** — a `FieldMeta.long_text` field (derived `type: "text"`), a `Text` model column, or a `JSON`/`JSONB` model column.

**Why the rule names the model column and not just `long_text`.** An earlier draft of this ADR wrote the exclusion as "fields whose derived type is `text`", i.e. `FieldMeta.long_text` alone. That was checked against the codebase before implementation and found badly too narrow: **`long_text=True` is set on exactly one field in the entire repo** (`TestCase.description` — it is a *presentation* opt-in, "render a `<textarea>`", added by ADR-0069 for one form), while `mapped_column(Text, ...)` appears on **16** columns. The `long_text`-only rule would therefore have left 15 unbounded free-text columns (`Requirement.description`, `RiskItem.mitigation`, `TestPlan.scope`/`approach`/`staffing_and_training`/`schedule`, …) offered as exact-match filters — contradicting this ADR's own rationale while appearing to implement it. Deriving from the column type instead makes the exclusion mechanical and complete: a new `Text` column is non-filterable the moment it is mapped, with nothing for anyone to remember.

Two implementation notes that are load-bearing rather than incidental:

- **`Text`, never `String`.** `Text` subclasses `String`, so an `isinstance(..., String)` check would exclude every string column in the schema — including the short, bounded, genuinely exact-matchable ones (`Requirement.title`, `Project.name`) this rule exists to keep. SQLAlchemy's `Enum` also subclasses `String` and is likewise unaffected, which is the correct outcome: a closed vocabulary is precisely what exact-match filtering is for.
- **`JSON`, not the dialect's `JSONB`.** `postgresql.JSONB` subclasses the generic `sqlalchemy.JSON`, so checking the generic type covers today's one JSONB column (`TestLog.payload`) and any future plain-`JSON` one. This column was *not* a 500 risk — SQLAlchemy serializes the query string to valid jsonb and Postgres has a `jsonb = jsonb` operator, so it filtered "successfully" and returned nothing, every time. A silently-always-empty filter is worse for a user than one that errors, which is why it is excluded rather than left alone.

`FieldMeta.filterable=False` remains available as a per-field manual override for any future field the type-based rule judges wrongly. Nothing sets it today.

### 3. Widening exposes no information the list route did not already return

This is the security argument, and it is short: the fields `derive_entity_schema` serves are exactly the fields of the entity's own `summary_schema` — the model the list route already serializes **in full** into every response body. A caller who can list an entity can already read every value of every field this change makes filterable. Filtering adds a way to *narrow* a result set, not a way to see a field that was previously hidden.

Cross-tenant scoping is untouched: `apply_filters_and_search` composes onto a query the org/scope gate has already constrained, so a filter can only ever narrow within the caller's own tenant, never across one (NFR-1, ADR-0007).

ADR-0070 §5's reasoning about secret-bearing columns carries over verbatim and needs no new rule: `password_hash`, `key_hash`, `key_prefix`, `token_hash` belong to models (`User`, `AIAgent`, `RefreshToken`) that have **no `CrudEntityConfig` at all**. They are not served, so they are not filterable.

### 4. A malformed filter value is a 422, not a 500

With 7 narrow tuples this was latent; widened, it is reachable on the first typo. `apply_filters_and_search` now coerces each value against its own column type before comparing — UUID, boolean (`true`/`false`/`1`/`0`), integer/numeric, date/datetime, and enum (must be a declared value); everything else passes through as a string. A failed coercion raises `ValueError`, which the list route maps to a **422 with `field_errors`** — byte-for-byte the envelope `apply_sort` already produces for an unsortable `?sort=` field, not a new error shape.

`apply_filters_and_search` stays pure (no DB access), preserving the unit-testability its own docstring claims.

**A 422 is for a malformed value on a field that *is* filterable — never for naming a non-filterable field.** Passing `?description=anything` (an excluded `Text` column) is **silently ignored**, exactly as any unrecognised query param has been since ADR-0022. This asymmetry is forced, not stylistic: the list route's query string legitimately carries `page`, `page_size`, `sort`, `q` and every scope param alongside filters, and none of those are fields — 422-ing "unrecognised" params would reject every normal request. So "rejected as non-filterable" throughout this ADR means *omitted from the picker and ignored on the wire*, never a 4xx. The UI is what keeps this from mattering in practice: the modal can only offer fields the served schema marks filterable, so a user cannot construct the ignored case by hand.

### 5. The UI: one header button, one modal, AND-only

A "Filter" button joins the `.card-header .card-tools` row — icon-only (Font Awesome `filter` via the `Icon` atom, `aria-label`/`title="Filter"`), matching ADR-0071's sibling "Columns" button exactly. It opens a `FilterModal` organism composing the `Modal` molecule, the `Button`/`Select`/`TextInput` atoms and the `FkSelect`/`FkAutocomplete` molecules — no new raw `.modal`/`.btn`/`.form-select` markup.

Each row is a field picker plus a value control. Conditions combine with **AND only**:

- The backend supports exact equality and nothing else, and its chained `.where()` calls are `AND`ed unconditionally. There is no `OR` to express and no operator to choose, so the modal renders no operator control at all rather than a single-option `<select>` implying a choice nobody has. The conjunction is stated once in prose.
- **At most one condition per field.** A second condition on a used field compiles to `field = a AND field = b` — always empty — which a user reads as "no results," not as "contradictory query." The field picker omits any field another row claims, making the state unrepresentable rather than merely discouraged.

Value controls are typed, reusing **exactly `EntityForm`'s own branch** so a field is filtered through the same control it is edited through: `enum` → `Select` of its served `values`; `boolean` → Yes/No `Select`; `date` → `<input type="date">`; `fk` → `field.select ? FkSelect : FkAutocomplete`; everything else → `TextInput`. §4's coercion is the backstop, not the user's first line of defence.

Draft edits are local until Apply; Cancel and ESC discard, and the draft re-seeds from the applied filters on every open — same mechanism and same reason as ADR-0071's own re-seed.

### 6. Filter state lives in `EntityListPage`, not `EntityTable` — the opposite of ADR-0071

ADR-0071 put column preferences inside `EntityTable` and wrote down why:

> Each of those five maps to a backend query parameter, so it belongs to whoever owns the list query. Column visibility and order map to nothing server-side.

Filters are on the other side of that exact line, so they stay with `page`/`pageSize`/`sort`/`search` in `EntityListPage` — where they already were. `EntityTable` owns only the modal's open/closed boolean. The dead `onFilterChange?: (field, value)` prop is replaced by `onFiltersChange?: (filters) => void`, because Apply commits the whole set at once and a removed condition must actually disappear rather than survive a per-key merge.

### 7. Filters are NOT persisted — a deliberate divergence from ADR-0071

Column preferences persist to `localStorage` per entity. Filters are session-only component state, and the asymmetry is the point:

**A hidden column is visible; an active filter is not.** A user who hid a column sees a row of headers with one missing — the state announces itself. A user returning to a list that is silently filtered sees *fewer rows*, which reads as missing data, a broken query, or someone else's deletions. Persisting that across reloads and days optimizes a rare convenience at the cost of a recurring "where did my records go" failure.

This also keeps filters consistent with every other list-query parameter in this screen: `EntityListPage`'s own comments already declare `page`, `pageSize`, `sort`, `filters` and `search` "component state only — deliberately not persisted across navigation or reload" (TC-DS-018). Persisting one of the five and not the other four would be the anomaly.

**Mitigation, since "invisible" is the stated risk:** the Filter button carries an active-condition **count badge** and switches to `btn-outline-primary` while any filter is applied, so a narrowed list always has a visible cause in the header directly above it.

## Consequences

**Positive.** Exact-match filtering becomes reachable on **27 entities instead of 7**, through one control, with no per-entity work now and none for any future entity — a new entity is filterable the moment its schema is served, the same way it is sortable today. The `filter_fields` drift class is closed at its source rather than audited once. A malformed filter value becomes a clean 422 instead of a 500, on a code path that was previously reachable but untested. `EntityTable`'s dead `filters`/`onFilterChange` props stop being a lie about what the component does.

**Negative / Trade-offs.** An equality predicate on an unindexed column is a sequential scan; filterable-by-default means more columns can be the subject of one. Acceptable at this data volume and no worse than what `?q=`'s `OR`-joined `ILIKE` already does on 19 entities — and unlike `ILIKE`, an equality predicate on an indexed column (every FK, every PK) *can* use its index. The derivation will occasionally offer a filter nobody wants (a `created_at` timestamp, exact-matched to the microsecond, will rarely hit); this is a cosmetic cost in a dropdown, paid once per entity, against the recurring cost of a hand-kept list going stale — and `FieldMeta.filterable=False` is available per field if a specific one ever proves actively confusing. Not persisting filters means a reload clears them, which some users will want back; §7 argues that trade is correct, and reversing it is a one-line change to where the state lives if a live manual pass disagrees.

**Neutral.** No schema change, no migration, no new route, no new query parameter (`?<field>=<value>` is ADR-0022's, unchanged in shape), no RBAC change. The response body is untouched, so the class of breakage `backend/CLAUDE.md`'s response-shape note warns about does not apply here.

**Merge note.** ADR-0071 (`entity-column-prefs`) adds its own "Columns" button to the same `.card-tools` div, and ADR-0070 (`search-fields-audit`) touches `apply_filters_and_search`'s sibling `?q=` clause-builder in the same function. Both are unmerged siblings of this branch; each is a small, localized textual conflict on merge, and the two buttons are designed to sit adjacent in that header row. This branch's numbers (`0072`/WBS `11.52`/§60/NFR-72/TC-ADMIN-053..058) were chosen against `origin/main` **and** both siblings' current claims — per root `CLAUDE.md`'s own numbering-collision recipe, re-check immediately before merging, since a sibling can still renumber itself in flight (the MCP-6 case).

## Alternatives considered

- **Build the modal over today's 7 hand-declared tuples, and leave widening to a later story.** Rejected. It ships a control that is empty on 20 of 27 entities, which reads as a broken feature rather than a partial one, and it defers the question to a story nobody has scheduled — exactly how `filter_fields` reached 7-of-27 in the first place.
- **Hand-audit all 27 entities, mirroring ADR-0070's §2 table.** Rejected, and this was the closest call. It is the established precedent and it produces a per-entity written rationale, which has real value. But §2 above argues the judgment it would record is not actually a judgment: the one bad filter target has a mechanical marker, and everything else is either useful or harmless. The audit's cost is not the one-time writing — it is that the *next* entity needs an audit entry too, forever, and will not get one.
- **Make every field filterable, including `text`.** Rejected. Exact-matching a paragraph of free text answers no question a person has, and offering it in the picker actively misleads — a user who types a sentence fragment into a `description` filter and gets zero rows will read that as "no such record," not "this filter is exact-match." `?q=` (ADR-0070) covers those columns properly, and `EntityTable`'s search box is already right next to this button.
- **Per-condition operators (`contains`, `>`, `<`, `in`).** Rejected for now, as a backend capability that does not exist rather than a UI choice that was declined. Adding real operators means changing the `?<field>=<value>` wire format (ADR-0022's, in use by every list caller including the MCP tool layer), and is its own ADR. The draft model here carries an ordered list of per-row objects rather than a flat map **specifically** so a third control can be added to each row without restructuring — see `lib/entityFilters.ts`'s own module docstring.
- **`OR` between conditions, or nested groups.** Rejected. Same wire-format constraint, plus a genuine UX cost: a flat AND list needs no precedence UI, and nothing in the requirements asks for disjunction. Worth revisiting only alongside the operator question.
- **Persist filters to `localStorage`, matching ADR-0071 exactly.** Rejected — §7 is the argument. Consistency with the sibling button was the pull; consistency with the other four list-query parameters, and the invisibility asymmetry, won.
- **Keep filter state in `EntityTable` for symmetry with the Columns modal.** Rejected on ADR-0071's own stated rule (§6): the table would then have to push every change back up to the query owner anyway, which is the prop it already has.
