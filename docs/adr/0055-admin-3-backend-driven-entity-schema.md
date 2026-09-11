# ADR-0055: ADMIN-3 backend-driven entity schema for the generic admin CRUD surface

**Status:** Accepted
**Date:** 2026-09-09 (docs), 2026-09-11 (renumbered `0053` → `0055` — `main` independently merged its own `ADR-0053`/`0054` (Tabler CDN install + shell migration) while this branch was in flight, found merging into `main`; `11.36`/`§44`/`NFR-56`/`NFR-57` renumbered to `11.38`/`§46`/`NFR-58`/`NFR-59` for the same reason, `TC-ADMIN-027..034` unaffected — no collision in that series)
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [FR-ADMIN-2](../requirements/2026-09-03-project-scaffold-requirements.md#28-taxonomy--generic-admin-crud--taxonomy-admin-crud-storiesmd), [ADR-0022](0022-generic-crud-router-factory.md) (backend `CrudEntityConfig`/`make_crud_router` this ADR extends), [ADR-0027](0027-generic-admin-crud-ui-and-backend-completion.md) (frontend `entityConfigs/*.ts` + generic components this ADR partially supersedes), [ADR-0025](0025-requirement-title-field.md) (the concrete drift incident that triggered this ADR).

## Context

ADR-0027 gave every admin-CRUD entity a hand-written frontend `EntityConfig` (`frontend/src/entityConfigs/<entity>.ts`, one file per entity: `fields[]` with `type`/`label`/`required`/FK-ref/enum-values, `methods`, `scopeField`, `searchFields`, `filterFields`). The backend's own `CrudEntityConfig` (ADR-0022, `app/api/crud_factory.py`) independently declares the *route-serving* half of the same shape (`create_schema`/`update_schema`/`summary_schema`, `search_fields`, `filter_fields`, `methods`) — nothing links the two. They are two independently-maintained descriptions of the same entity.

This drifted for real, not hypothetically: `Requirement.title` was added to the backend's `CreateRequirementRequest` as a required field under ADR-0025 (2026-09-05), but `entityConfigs/requirement.ts` was never updated to add a `title` field to its form. Every `POST /requirements` from the generic admin create form failed `422 validation_error: title Field required` — with no `title` input anywhere in the UI to fix it from. Found live, 2026-09-09, four days after ADR-0025 shipped. `frontend/CLAUDE.md` already documented this exact class of drift for `methods`-array restriction (`entityConfigs/<entity>.ts` can silently drift out of sync with a backend route restriction) — this is the same root cause hitting the *field list* instead of the *methods list*.

## Decision

### The backend becomes the single source of truth for entity **field shape** — not for navigation

Split cleanly along the line the drift actually happened on:

- **Backend-owned, dynamic (this ADR):** what a `POST`/`PATCH` body needs (`fields[]`: name, label, type, required, FK ref+label-field, enum values+badge colors, `showInTable`), plus `methods`/`scope_field`/`search_fields`/`filter_fields` — everything `EntityListPage`/`EntityFormPage`/`EntityTable`/`EntityForm` need to render a list/create/edit screen for one entity. Fetched at runtime, not compiled in.
- **Frontend-owned, static (unchanged):** route wiring (`App.tsx`), sidebar/nav grouping+icons+order (`registry.ts`'s `orgScopedEntities`/`projectScopedEntities` arrays, `AppSidebar`'s `PROJECT_ENTITY_GROUPS`), the generic components themselves. This is information-architecture, not data schema — it doesn't drift the way a field list does (adding a required backend field doesn't imply a nav reshuffle), and dynamizing it is a different, unrequested problem.

### Backend: hybrid derivation, not full auto-inference

Pydantic alone can supply **type** (`str`/`UUID`/`bool`/`date`), **required-ness**, and **enum values** (already typed as `Literal[...]` throughout this codebase, e.g. `TestConditionPriority`) — genuinely mechanical, auto-derived from `create_schema`/`update_schema`'s `model_fields` via `model_json_schema()`. It cannot supply **FK target entity + label field** (`project_id: UUID` carries no signal it references `Project.name`), **enum badge colors** (pure presentation, no type correlate), **field label overrides** (auto-title-casing `external_ref` → "External ref" works generically, but doesn't match every hand-picked label already in use), or **`showInTable`** (an arbitrary UI choice). Those four are declared explicitly, backend-side, in a new small per-field metadata dict alongside each `CrudEntityConfig` — the same information `entityConfigs/*.ts` carries today, relocated, not reinvented:

```python
@dataclass
class FieldMeta:
    ref_entity: str | None = None       # FK target's own :entity route slug
    label_field: str | None = None      # FK target's own display field
    badge_colors: dict[str, str] | None = None  # enum value -> Bootstrap color name
    label: str | None = None            # override auto-title-cased label
    show_in_table: bool = True

# CrudEntityConfig gains:
label: str                              # entity's own nav-label, e.g. "Requirements"
field_meta: dict[str, FieldMeta] = field(default_factory=dict)  # only fields needing an override
```

A field with no `field_meta` entry gets the fully auto-derived shape. `RequirementSummary.project_id` needs one entry (`FieldMeta(ref_entity="projects", label_field="name")`); `description`/`external_ref`/`source`/`title` need none.

### New route: `GET /entities/{resource}/schema`, per-entity

Not a combined `GET /entities` (all 24 at once) — the frontend already knows which single entity a given `EntityListPage`/`EntityFormPage` mount needs from its own route param, and a per-entity fetch keeps each entity's schema independently cacheable/invalidatable. Requires a new backend-side registry (`app/api/entity_registry.py`: `ALL_ENTITY_CONFIGS: dict[str, CrudEntityConfig]`, keyed by the same plural route slug the frontend already uses as `:entity`) since today's `CrudEntityConfig` instances are scattered, uncollected, across 7 route-cluster modules with no shared index. Response shape:

```json
{
  "resource": "requirement", "label": "Requirements",
  "methods": ["list", "get", "create", "update", "delete"],
  "scopeField": "project_id",
  "searchFields": ["title", "description", "external_ref", "source"],
  "filterFields": ["external_ref"],
  "fields": [
    {"name": "project_id", "label": "Project", "type": "fk", "refEntity": "projects", "labelField": "name", "required": true},
    {"name": "title", "label": "Title", "type": "string", "required": true},
    ...
  ]
}
```

### Frontend: fetch replaces import, all 24 entities in one pass (no pilot)

`useQuery(["entity-schema", entityKey], ...)` with a long `staleTime` (schema changes are rare — a deploy, not a per-navigation event) replaces `entityConfigByKey[entityKey]`'s synchronous static lookup everywhere it's read (`useAdminRouteContext`, `EntityTable`, `EntityForm`, `FkAutocomplete`'s ref-entity resolution). Every admin list/form page gains a loading state for the schema fetch itself (new, since today's static import has none). All 24 `entityConfigs/*.ts` files are ported and then deleted in the same change — not phased across a pilot subset — since a partial port would leave the exact two-source-of-truth problem this ADR exists to close, just for a smaller entity set.

Enum badge coloring (`ENUM_BADGE_COLORS` in `EntityTable`) moves into `FieldMeta.badge_colors`, backend-side, since it's declared per-entity metadata now, not a shared frontend constant.

## Consequences

**Positive:** `Requirement.title`'s exact failure mode structurally cannot recur — a backend field that's required can no longer have a frontend form that doesn't know about it, because the frontend no longer maintains an independent opinion of what the fields are. Adding a field to a Pydantic schema is enough on its own for `required`/`type`/`enum values` to show up correctly; only FK/badge/label/`showInTable` needs a one-line `FieldMeta` entry, and that entry lives next to the schema it describes instead of in a different frontend file 24-ways removed from it.

**Negative / accepted trade-offs:** Every admin list/form page now does a schema fetch before it can render anything, where it previously imported a static object — a real, new loading state on a surface that had none. `staleTime` mitigates repeat-navigation cost but doesn't eliminate first-load latency. The backend gains a new cross-cutting registry module (`entity_registry.py`) that every `CrudEntityConfig`-defining route module must now also register into, a coupling ADR-0022's original factory design didn't have (each cluster module was previously self-contained). Auto-derivation from Pydantic is genuinely hybrid, not fully automatic — a future entity's FK field or enum badge color will silently render wrong (a raw UUID, an uncolored badge) if its `FieldMeta` entry is forgotten, the same "someone has to remember" risk this ADR is nominally trying to eliminate, just narrowed from "the whole field" to "the domain-specific half of one field."

### Amendment 1 (2026-09-09, implementation pass) — `CrudEntityConfig.field_order`

The Decision above lists five `FieldMeta` keys and says nothing about field *order*, because nothing in the design predicted order would be a problem. It is: `derive_entity_schema`'s natural order is an artefact of **which schema a field came from** (writable schemas first, summary-only last), not of how the entity reads on screen. Any FK/scope field absent from both `create_schema` and `update_schema` — `Project.org_id`, `TestCase.test_condition_id`, `RoleAssignment.actor_id` — therefore sorted to the bottom, while every hand-written `entityConfigs/*.ts` led with it. Found mechanically: a comparator that diffed each derived schema against the config it replaces flagged the mismatch on 6 of 27 entities.

Added `field_order: tuple[str, ...]` to `CrudEntityConfig`, in the same "declare what Pydantic can't supply" spirit as `FieldMeta` itself. **Deliberately order-only, never a field filter** — a field not named still appears, appended in derived order. Letting it double as the field list would reintroduce exactly the `Requirement.title` drift this ADR exists to close, so this is a correctness property, not an implementation detail (pinned by TC-ADMIN-030).

### Amendment 2 (2026-09-09, implementation pass) — enum badge colours are a shared backend default, not a per-entity copy

The Decision says badge colouring "moves into `FieldMeta.badge_colors`, backend-side, since it's declared per-entity metadata now, not a shared frontend constant." Implementing it literally would have meant the same palette reference repeated on all 10 enum fields, with no entity ever legitimately disagreeing — the map is keyed by enum **value**, not by entity ("high" reads as danger whether it's a `Defect`'s severity, a `RiskItem`'s likelihood or a `TestCondition`'s priority).

Shipped instead as a shared module-level `ENUM_BADGE_COLORS` in `crud_factory.py` (transcribed verbatim from the frontend constant it retires), applied as the **default** for any enum field, with `FieldMeta.badge_colors` overriding it per-field — which is the per-field declarability the Decision actually asks for. Whichever palette applies is filtered to that field's own declared values, and omitted entirely when nothing matches, preserving the plain-grey fallback for the two enums UI Design Document §3 gives no semantic colour. The ADR's own point stands unchanged: the palette is no longer a *frontend* constant.

### Amendment 3 (2026-09-09, implementation pass) — the frontend port reaches three non-admin modules

The Decision names `useAdminRouteContext`, `EntityTable`, `EntityForm` and `FkAutocomplete` as the read sites. Three modules outside the admin surface also imported per-entity configs directly, and deleting the configs was impossible without moving them. They split along a line this ADR implies but never names — **needing a route vs. needing a field shape**:

- `lib/api/taxonomy.ts` needs only `path`, and is a plain module, not a component, so it *cannot* call a hook at all. It builds a local descriptor from `pathFor()`. No fetch, no loading state.
- `TestCycleDetail.tsx` and `TestPlanDetail.tsx` genuinely need `fields`/`methods`, so they fetch — two bespoke screens gaining a schema fetch and a loading gate they did not have before, which widens the "new loading state on a surface that had none" trade-off already accepted above beyond the admin pages it originally described. Their route-only uses take a local `routeOnlyConfig()` helper instead.

No decision reversed; the scope was simply larger than the Decision's own list, and this records that rather than absorbing it silently.

### Amendment 4 (2026-09-09, implementation pass) — the entity count is 27 registered / 28 deleted, not the Decision's "24"

The Decision and Alternatives sections above say "24" four times ("all 24 at once", "all 24 entities in one pass", "All 24 `entityConfigs/*.ts` files", "the remaining 22 entities"). That number was carried over from planning and is wrong against the actual code: `ALL_ENTITY_CONFIGS` collects **27** `CrudEntityConfig` instances, and **28** `entityConfigs/*.ts` files were deleted (the 27 registered entities plus `release.ts`, which moved to `entityConfigs/overrides.ts`'s `STATIC_ENTITY_CONFIGS` rather than being derived — Amendment 3's own exception). API Document §3 states 27 correctly; ADR-0027's own "28 admin-surface pages" is also correct and consistent, since `Release` has a page but no factory config.

The original prose is left as written rather than silently renumbered — the Decision's *substance* ("all of them in one pass, no pilot subset, no fallback copy") is unaffected by the miscount, and this repo's convention is that a Decision records what was decided at the time, with corrections appended. Read every "24" above as "27 registered entities, 28 config files".

## Alternatives considered

- **Full Pydantic-JSON-Schema auto-inference, including FK detection by naming convention** (any `*_id` UUID field auto-assumed FK, target entity guessed from the prefix) — rejected: this codebase already has irregular cases a naive convention mis-maps (`RiskItem`'s branching `requirement_id`/`test_plan_id`, exactly one; `entry_exit_criteria`'s plural-not-matching-singular path exception, both already called out in `crud_factory.py`'s own docstring) — a wrong guess here is a silently-broken autocomplete, worse than today's explicit-but-occasionally-stale hand-config.
- **Combined `GET /entities` returning all 24 schemas at once** — rejected per explicit CTO direction (per-entity route); would also mean every entity's schema is refetched/invalidated together even though only one is usually needed per page mount.
- **Pilot on 2 entities, prove the wiring, then bulk-port the rest** — rejected per explicit CTO direction (all 24 in one pass); the mechanism itself (registry, route, frontend fetch layer, component rewiring) is built once regardless of rollout width, so the marginal cost of authoring `FieldMeta` for the remaining 22 entities once the first 2 prove the shape is mechanical, not exploratory.
- **Keep `entityConfigs/*.ts` as a frontend-side fallback/cache alongside the new backend route** — rejected; keeping both reintroduces the exact two-source-of-truth drift this ADR exists to close, just with an extra caching layer on top.
