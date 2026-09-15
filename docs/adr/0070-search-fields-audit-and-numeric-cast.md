# ADR-0070: `?q=` free-text search — numeric columns cast to text, and a per-entity `search_fields` audit

**Date:** 2026-09-14
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0022](0022-generic-crud-router-factory.md) (the generic CRUD router factory that introduced `search_fields`/`?q=`, unchanged in shape by this ADR), [ADR-0056](0056-admin-4-generic-admin-crud-column-sort.md) (`sortable_fields`, the sibling per-entity opt-in list this audit's posture mirrors), [ADR-0060](0060-projects-page-retired-generic-surface.md) (added `Project.search_fields=("name",)` — the one prior per-entity addition, extended here), [ADR-0069](0069-req-5-standalone-test-case-with-optional-requirement-link.md) (added `TestCase.description`, the column this audit folds into `TestCase`'s own tuple), [User Stories: ADMIN-2](../user-stories/2026-09-03-taxonomy-admin-crud-stories.md), [TC-ADMIN-013](../test-cases/2026-09-03-test-cases.md), [TC-ADMIN-044..046](../test-cases/2026-09-03-test-cases.md)

## Context

[ADR-0022](0022-generic-crud-router-factory.md) gave the generic CRUD factory an opt-in free-text search: an entity declaring a `search_fields` tuple gets `?q=<term>` on its list route, compiled to `OR`-joined `column ILIKE '%term%'` across exactly those columns; an entity declaring none silently ignores `?q=` (NFR-32). The opt-in is deliberate — a blanket "search every column" would quietly scan FK/UUID/timestamp columns nobody searches by, and would couple the search contract to the schema rather than to a decision.

What was never done is the audit that opt-in implies. Three years of entities later, **only 4 of 27 registered `CrudEntityConfig`s had a `search_fields` tuple at all** (`requirement`, `test_case`, `project`, `defect`), and three of those four were incidental — `requirement`'s came with ADR-0022 itself as the worked example, `project`'s was added by [ADR-0060](0060-projects-page-retired-generic-surface.md) for one screen, `defect`'s covers a single column. Every other entity's admin list page renders a search box the backend silently ignores. The originally-reported bug is the clearest case: **`TestPlan` has five substantial free-text columns** (`identifier`, `scope`, `approach`, `staffing_and_training`, `schedule`) and searching any of them returned the unfiltered list, with no error to signal why.

Two things stood in the way of simply filling in the tuples.

**First, a structural one.** Postgres has **no `integer ~~* unknown` operator** — an un-cast `ILIKE` against an `Integer`/`BigInteger`/`Numeric` column is a hard `ProgrammingError` (`operator does not exist`) at query time, not a silently-empty result. Numeric columns were therefore not "unused" in `search_fields`, they were **structurally unusable**: any tuple naming one would have 500'd the entity's entire list route the first time anyone typed in the search box. That is why every pre-existing `search_fields` tuple in this repo happens to be string-only — not a style choice anyone made, a constraint nobody had written down. `TestStep.sequence` is the concrete column this blocked: the one numeric value in this schema a human actually searches by ("show me step 3").

**Second, a judgment one.** "Which columns are searchable" is a per-entity product decision, not a mechanical `is this a string?` filter — a byte count, a hash, and a closed-vocabulary status string are all technically matchable and all answer no real question. Leaving it un-audited had a real cost (the `TestPlan` bug); auditing it mechanically would have a different one.

## Decision

### 1. Numeric `search_fields` columns are `CAST` to text before matching

The `?q=` clause-builder inside `apply_filters_and_search` is extracted into its own helper, `_search_clause(model, column_name, search_term)` (`app/api/crud_factory.py`), which branches on the column's own SQLAlchemy type:

- `isinstance(column.type, (Integer, Numeric))` → `cast(column, String).ilike(f"%{term}%")`
- everything else → `column.ilike(f"%{term}%")`, byte-for-byte the prior behavior

The two-entry `isinstance` check is complete by subclassing, not by enumeration: `SmallInteger` and `BigInteger` subclass `Integer`, and `Float` subclasses `Numeric`, so every numeric column type SQLAlchemy ships is covered without a per-subclass list that would drift.

**Semantics are substring-on-the-rendered-digits**, and deliberately so: `?q=1` matches sequence `1`, `10` and `21` alike. This is what the single `?q=` box in the generic admin UI can actually express — one query param carrying one term against a mixed-type column set.

No string column's behavior changes. No entity's existing results change. This is purely the removal of a structural block.

### 2. Every entity's `search_fields` is audited and declared, or deliberately declined

`search_fields` goes from **4 to 19** of the 27 registered configs. Entities with genuinely searchable free text get it; entities without get an explicit reason, recorded here rather than left as an absence a future reader would have to re-derive.

| Entity | `search_fields` | Change |
|---|---|---|
| `requirement` | `title`, `description`, `external_ref`, `source` | unchanged — already complete |
| `test_case` | `title`, **`description`**, `preconditions`, `expected_result` | **+`description`** — [ADR-0069](0069-req-5-standalone-test-case-with-optional-requirement-link.md) added the column after this tuple was written |
| `project` | `name`, **`standards_profile`** | **+`standards_profile`** |
| `defect` | `external_ref` | unchanged — the only free-text column it has (`status` is closed-vocabulary, see §3) |
| `test_condition` | **`description`** | **new** |
| `test_step` | **`action`, `expected_result`, `sequence`** | **new** — `sequence` is this repo's **first numeric search field**, enabled by §1 |
| `test_suite` | **`name`, `purpose`** | **new** |
| `test_execution` | **`actual_result`** | **new** |
| `risk_item` | **`description`, `mitigation`** | **new** |
| `attachment` | **`url_or_path`, `mime_type`** | **new** (`size_bytes` deliberately excluded, see §3) |
| `test_plan` | **`identifier`, `scope`, `approach`, `staffing_and_training`, `schedule`** | **new** — the originally reported bug |
| `entry_exit_criteria` | **`condition_text`** | **new** |
| `environment` | **`name`, `config_notes`** | **new** |
| `test_cycle` | **`name`** | **new** |
| `role` | **`name`** | **new** |
| `permission` | **`code`, `resource`, `action`** | **new** |
| `test_design_technique` | **`name`, `istqb_chapter_ref`** | **new** |
| `test_level` | **`name`** | **new** |
| `test_type` | **`name`** | **new** |

### 3. The eight entities left without `search_fields`, and why

These are decisions, not misses. Each is recorded so a future pass doesn't "fix" one by adding a tuple that answers nothing.

- **No free-text column exists at all** — `test_log`, `org_membership`, and the 4 traceability link tables (`requirement_test_case_link`, `requirement_test_condition_link`, `test_condition_test_case_link`, `test_case_defect_link`). Every column on these is an FK, UUID, enum, or timestamp; `TestLog`'s only payload is a JSONB blob (`payload`), which `ILIKE` cannot meaningfully address and which this ADR does not attempt to. There is nothing for `?q=` to match, so these keep ADR-0022's silent-ignore behavior — and, because the reason is structural rather than editorial, they are the stable choice for any test asserting the no-`search_fields` negative class (see TC-ADMIN-013, corrected by this pass).
- **No generic `list` route exists** — `organization` and `role_assignment`, whose `methods` sets exclude `"list"`. A `search_fields` tuple here would be dead config: `?q=` has no route to arrive on. Adding one would read as a capability the API does not have.

### 4. Two column-level exclusions inside otherwise-searchable entities

- **`Attachment.size_bytes`** (`BigInteger`) is a numeric column §1's cast now *could* handle, and is deliberately left out. A byte count is a measurement, not an identifier — substring-matching its digits (`"1024"` also matching `10240`, `21024`) answers no question a user has. `TestStep.sequence` is included precisely because it is the opposite case: a short, human-quoted ordinal. "Is this number an identifier a person says out loud, or a measurement?" is the test applied.
- **`Defect.status` and `Approval.role`** are plain `String` columns (not DB enums) but hold closed vocabularies. Free-text substring search across a closed vocabulary is the wrong tool — `Defect.status` is already exactly matchable via `filter_fields`, which is what a closed vocabulary wants.

### 5. Secret-bearing columns need no exclusion rule

`password_hash`, `key_hash`, `key_prefix` and `token_hash` all belong to models (`User`, `AIAgent`, `RefreshToken`) that have **no `CrudEntityConfig` at all** — they are not served by the generic factory in any form, so there is no `search_fields` tuple they could be added to and no `?q=` exposure to guard against. Stated explicitly here only so that a future reader auditing this decision doesn't have to re-derive that absence.

## Consequences

**Positive.** The generic admin surface's search box does what it appears to do on 19 entities instead of 4 — the `TestPlan` bug that prompted this is fixed along with fourteen other instances of the same latent shape. Numeric columns stop being a structural dead end in `search_fields`, so the next entity that needs one (`TestStep.sequence` is unlikely to be the last) requires no further architecture work. Every non-declaration now carries a written reason, which converts "this entity has no search" from an ambiguous absence into an auditable decision — the same posture [ADR-0056](0056-admin-4-generic-admin-crud-column-sort.md)'s `sortable_fields` already established one layer over.

**Negative / Trade-offs.** `ILIKE '%term%'` cannot use a plain B-tree index, so each additional `search_fields` column is one more sequential-scan predicate per `?q=` query — acceptable at this data volume, and the `OR`-joined shape is unchanged from what ADR-0022 already shipped, just applied to more entities. The `cast(column, String)` on a numeric column is likewise unindexable, and per-row; `sequence` is the only numeric field declared, on a table scoped to one `TestCase`, so the row count it scans is inherently small. The substring-on-digits semantic will occasionally surprise (`?q=1` returning steps 1, 10 and 21) — documented here and in NFR-70 rather than papered over, with `filter_fields` as the exact-match escape hatch.

**Neutral.** No schema change, no migration, no new route, no new query parameter, no RBAC change, no frontend change — `?q=` was already wired end-to-end by ADR-0022 and ADR-0055's schema-driven admin surface. `TC-ADMIN-013`'s own negative half named `TestSuite` as the no-`search_fields` example; `TestSuite` now has one, so that TC is corrected in place by this pass to name `test_log` instead (§3's structural, durable case), not left to fail as a stale claim.

## Alternatives considered

- **Exact-match semantics on numeric columns** (`cast(column, String) == term`, or `column == int(term)` when the term parses). Rejected. A single `?q=` param cannot carry two different match semantics — substring for strings, equality for numbers — without the caller knowing each column's type, which is exactly the coupling the generic factory exists to avoid; and a mixed-type `search_fields` tuple (`test_step` is precisely that: two strings and an integer) would then behave differently per column for one user-typed term, with nothing in the response to explain why. `filter_fields` already provides exact match for any caller who needs it, on the same route, with a name that says so.
- **Postgres full-text search (`tsvector` + a GIN index), or `pg_trgm` for fuzzy matching.** Rejected for now. Substantially larger change — a generated/stored column or index per searchable entity, a migration per entity, and a different query shape — for a capability nothing currently asks for: there is no relevance-ranking requirement anywhere in the requirements set, no multi-word/stemming requirement, and no measured performance problem at current data volumes. `ILIKE` is adequate and is what ADR-0022 already committed to; this ADR deliberately does not re-litigate that, only completes its per-entity application. Worth revisiting if a ranking requirement appears or the row counts grow by orders of magnitude.
- **Leave numeric columns unsupported and declare `test_step` with its two string columns only.** Rejected — it is the bug, restated as a decision. `TestStep.sequence` is the single most-quoted value on that entity ("re-run step 3"), and the reason it was absent was a Postgres operator gap nobody had diagnosed, not a product judgment that it shouldn't be searchable. Declining it would have preserved a constraint while recording it as a preference.
- **Make `search_fields` default to "every `String`/`Text` column" instead of opt-in.** Rejected — reverses ADR-0022's own deliberate design, and §3/§4 are the evidence for why: a mechanical type filter would have pulled in `Attachment.size_bytes`' sibling measurements, `Defect.status`' closed vocabulary, and (for any future model that did get a config) hash columns, all without anyone deciding. The audit's cost is one-time; a wrong default's cost recurs on every new entity.
