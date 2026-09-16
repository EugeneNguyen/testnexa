# ADR-0077: Unlinking on the entity detail page's relationship tabs, from a declared link-delete action

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** xuanbinh91@gmail.com (CTO)
- **Closes:** [ADR-0076](0076-relationship-tab-write-actions.md)'s own deferred item — its Consequences state "Unlinking is not shipped... Adding one is a real decision (what does removing a traceability link mean for an already-exported RTM?) and belongs to its own story, not to this one's scope", and its Alternatives list "Per-row 'Unlink' on n-n tabs. **Deferred, not rejected**".
- **Extends:** [ADR-0074](0074-entity-detail-relationship-tabs.md) (the tabs), [ADR-0075](0075-junction-table-registry-completeness.md) + Amendment 1 (all six junctions registered, bidirectional), [ADR-0076](0076-relationship-tab-write-actions.md) (the declared-action mechanism this mirrors). None is superseded: the derivation, the exclusion rules, `derive_entity_relations`, `linkCreate` and both create affordances are untouched.
- **Builds on:** [ADR-0005](0005-traceability-link-dedicated-join-tables.md) (dedicated link tables, immutable rows), [ADR-0030](0030-req4-test-suite-membership-bespoke-routes.md)/[ADR-0031](0031-plan1-test-plan-membership-and-status-transition-routes.md) (the two junction `DELETE` routes these four are shaped on — including the `404`-not-`204` asymmetry), [ADR-0055](0055-admin-3-backend-driven-entity-schema.md) (`GET /entities/{resource}/schema` as the one place a client learns what an entity can do).

## Context

ADR-0076 made every relationship tab writable and left them **append-only**.
Its own Consequences said so in as many words: "The tabs therefore grow
monotonically today."

That is a worse state than it sounds, for a reason specific to what these tabs
are. Four of the six junctions are ADR-0005's traceability links — the rows a
requirements-traceability matrix is *made of*. ADR-0076's whole argument was
that a matrix you can only grow by authoring new records is not really
assemblable; the same argument applies one step further. A matrix that can be
assembled and never corrected accumulates every mislink anyone ever made, and
the role that owns its accuracy (`test_manager`, the only bundle holding
`requirement.export_rtm`) had no way to remove one. The first wrong pick in a
picker was permanent.

The asymmetry was also visible on screen, not merely theoretical: **two of the
six junctions already had a working unlink route** and had since REQ-4 and
PLAN-1 shipped —

```
DELETE /test-suites/{id}/test-cases/{case_id}   test_suite.update   (ADR-0030)
DELETE /test-plans/{id}/test-suites/{suite_id}  test_plan.update    (ADR-0031)
```

— but nothing on the generic surface could reach them, because ADR-0076 taught
the schema how to declare a link *create* and nothing else. So the capability
existed for a third of the tabs, was invisible on all of them, and was absent
entirely for the four that most needed it. ADR-0076's Alternatives deferred the
action precisely on those grounds ("shipping the action for a third of the tabs
would be exactly the incoherence ADR-0075 Decision §3 declined to create for
scoping") — the coherent move is all six together, which is this ADR.

### The question ADR-0076 said had to be answered first

"What does removing a traceability link mean for an already-exported RTM?"

It means nothing to the export, and that is the answer rather than a dodge. An
RTM export (`requirement.export_rtm`) is a **point-in-time artifact** generated
from whatever links exist when it runs; it holds no reference back to them and
nothing in this system re-derives a past export. Removing a link changes what
the *next* export says, exactly as adding one does. The two directions are
symmetric, and ADR-0076 already accepted the additive half without qualm.

What the question does surface is a real, narrower gap: **an unlink leaves no
audit trail.** Neither does a link — `TestLog` (EXEC-2) records execution
events, not traceability edits, and ADR-0005's link rows carry only two FKs and
a `created_at`. So this ADR does not *introduce* an accountability gap; it makes
an existing one symmetric. Naming it rather than closing it is deliberate: an
audit log over traceability mutations is its own feature with its own schema,
retention and read-surface questions, and inventing one here would be a much
larger decision smuggled in under a button. Recorded in Consequences.

## Decision

### 1. `CrudEntityConfig.link_delete` — `link_create`'s exact mirror

A new optional field on `CrudEntityConfig`, set on link/junction entities only:

```python
@dataclass
class LinkDeleteAction:
    path_template: str   # "/test-suites/{test_suite_id}/test-cases/{test_case_id}"
    permission: str      # "test_suite.update"
```

served as a **twelfth** key on `GET /entities/{resource}/schema`
(`"linkDelete"`, `null` for the 23 non-link entities), beside ADR-0076's
`linkCreate`.

Everything ADR-0076 §1 argues about why this must be *declared* rather than
derived applies here verbatim and for the same two reasons — the URL shapes are
arbitrary and bespoke, and two of the six gate on their **parent's** `.update`
rather than on anything named after the junction. The placeholders are named
after the link row's own FK columns, so one declaration serves a tab mounted at
either end of a bidirectional junction (ADR-0075 Amendment 1).

Three choices inside this are worth stating, because each had a
plausible-looking cheaper alternative:

- **It is a second key, not a field on `LinkCreateAction`.** For all six
  junctions today `link_delete.path_template` is byte-identical to
  `link_create.path_template` — same URL, different verb — so "reuse the create
  template and just send `DELETE`" is tempting. It would bake in a coincidence
  of how these six were designed as if it were a contract, and the first
  junction whose unlink lives at a different URL would build a wrong request
  with no signal. The two are served separately; the completeness test checks
  each template's placeholders against `fk_fields_of` (the real contract) and
  deliberately **does not** assert the two are equal.
- **It is read independently of `link_create`, on both sides of the wire.** A
  junction that can be linked and not unlinked is not hypothetical — it is
  exactly what four of the six were between ADR-0076 and this ADR — so neither
  key is inferred from the other, and `toEntityConfig` spreads them under
  separate conditions.
- **It is not expressed by adding `"delete"` to `methods`/`full_methods`.**
  That flag means "the generic factory serves `DELETE /{resource}/{id}`", which
  stays **false**: a link row has no addressable id of its own on that surface,
  it is addressed by its *pair*. Flipping it would make `EntityTable` render a
  per-row Delete — on the entity's own admin list page too — calling a route
  that answers `405`.

`tests/unit/test_adr76_link_create_actions.py` gains the mirror partition
(every `is_link_entity` config declares one; nothing else does), each
declaration's placeholders checked against `fk_fields_of` and its permission
against the live RBAC catalog, **mutation-tested in-suite** per ADR-0075's own
lesson. It lives in that file rather than a new one because the two partitions
range over the identical six configs; two files would be two checkers that have
to agree about which entities are link entities, with nothing making them.

### 2. Four new bespoke unlink routes, shaped on ADR-0030/ADR-0031

```
DELETE /requirements/{id}/test-case-links/{test_case_id}            requirement_test_case_link.delete
DELETE /requirements/{id}/test-condition-links/{test_condition_id}  requirement_test_condition_link.delete
DELETE /test-conditions/{id}/test-case-links/{test_case_id}         test_condition_test_case_link.delete
DELETE /test-cases/{id}/defect-links/{defect_id}                    test_case_defect_link.delete
```

All four live in `app/api/routes/trace.py`, at the **same URL** as their
`POST`, and each reuses ADR-0076's `_gate_parent` — the same function, not a
copy — so the NFR-1 existence boundary is literally shared between an entity's
link and unlink and cannot drift between them:

1. fetch the path parent; unresolvable org **or** no `OrgMembership` → `404`;
2. permission missing → `403`;
3. look the link row up by its own FK pair; absent → `404`;
4. delete it; `204`, no body.

Two differences from the `POST` are deliberate rather than omissions:

- **`404`, not an idempotent `204`, when the pair is not linked.** ADR-0030 fixed
  this asymmetry with `POST`'s `409` for its own pair and gave the reason: a
  `DELETE`'s "already true" case reads as "nothing to find here", not as a
  conflict. Inherited unchanged. It is also the more useful answer when two
  people work the same tab — the second one learns their click did nothing.
- **No cross-project `422`, and no far-side org walk.** The `POST` performs
  both to reject an *invalid new relationship*. A link row that already exists
  is by construction one the `POST` already accepted, so re-deriving either
  check here could only ever reject rows the system itself created — leaving a
  user permanently unable to remove exactly the rows a past bug let in. The
  authorization argument is complete without them: the row's existence under a
  parent the caller has already been gated on is what makes it theirs to
  remove.

`_delete_link` is shared by all four for the same reason `_gate_parent` and
`_insert_link` are: a fifth independently-reasoned copy of "look the pair up,
`404` if absent, otherwise delete and `204`" is how four routes that are meant
to be identical end up disagreeing.

**No generic surface changes.** `methods` stays `{"list","get"}`,
`create_schema` stays `None`. Links remain **immutable** — a link row still
cannot be `PATCH`ed, and ADR-0005's "delete-and-recreate" is what these routes
make *possible*, not something they contradict.

### 3. Four new permission codes, and the two older routes keep their gates

`rbac_seed_catalog.py` gains `LINK_DELETE_RESOURCES`, a fifth resource grouping
(catalog 106 → **110**), adding one `.delete` code per traceability link.

A separate tuple from `LINK_CREATE_RESOURCES` despite holding the same four
names: they are equal by coincidence of scope, not by rule. A future junction
could reasonably ship a create with no unlink (append-only traceability) or an
unlink with no create — collapsing them into one `LINK_WRITE_RESOURCES` would
make either shape unrepresentable. The four still stay in `READ_ONLY_RESOURCES`
rather than moving to `CRUD_RESOURCES`, which would also mint an `.update` code
for an operation ADR-0005 forbids outright.

`test_suite_test_case` and `test_plan_test_suite` get **no** new code, exactly
as in ADR-0076: their `DELETE` routes shipped under ADR-0030/ADR-0031 gated on
`test_suite.update`/`test_plan.update`, and re-gating a live contract for
symmetry would break every existing caller and buy nothing observable.
`LinkDeleteAction` *declares* its permission rather than deriving it precisely
so both shapes coexist.

Bundles, and the reasoning for each:

| Role | Gains | Why |
|---|---|---|
| `org_admin` | all 4 `.delete` | Its bundle is "every permission that exists", by definition. Omitting the grant would break TC-RBAC-018's live invariant. |
| `test_manager` | all 4 `.delete` | Symmetric with the four `.create`s ADR-0076 gave it, and for a reason specific to this role: it is the only bundle holding `requirement.export_rtm`, i.e. the one accountable for the matrix being **correct**. Able to assemble it and not to correct it, every mislink it makes is permanent. No `.read` backfill is needed — ADR-0076's migration already granted all four. |
| `tester` | `test_case_defect_link.delete` only | Exactly mirroring its single `.create`. The unlink is the literal undo of the one link this role may make; without it, a mislinked Defect — a one-click mistake in a picker — needs an escalation to correct. The other three are withheld for the identical reason their `.create`s are: `tester` holds only `requirement.read`, and requirement-level traceability is `test_manager`'s activity. |
| `auditor` | nothing | Read-only by definition; it already holds all four `.read` codes. |
| `ai_agent_scoped` | nothing | Reaches none of the linked entities at all. |

**On granting `tester` a `.delete` at all**, against this repo's own repeated
restraint (ADR-0018 withheld `release.delete`, ADR-0033 `test_execution.delete`,
ADR-0044 `defect.delete`): those decisions are about deleting records that carry
**content and history** — a Release, a recorded execution result, a Defect with
its provenance. A link row carries neither: two FK columns and a timestamp
(ADR-0005). Removing one retracts an *assertion*; it destroys no work product,
and the far record is untouched and re-linkable. The restraint precedent is
about the former, and this is the latter. Stated explicitly so a future reader
sees a judgment made rather than a precedent overlooked — and so it is easy to
reverse if the CTO disagrees after a live look.

Migration `8c1d5a7b93e2` backfills this. Unlike its ADR-0076 sibling its
`downgrade()` is **symmetric**, because it grants nothing it does not also
create — a property asserted rather than assumed, so a future edit that adds a
backfill fails a test rather than silently leaving the downgrade wrong.

Idempotency is proven by invoking `upgrade()` **twice through a real
`Operations` context**, not by a second `alembic upgrade head` — which
`backend/CLAUDE.md` documents as a bookkeeping-level no-op that never re-enters
the function body. And, one step past ADR-0076, the idempotency *harness* is
itself mutation-checked: the same machinery is pointed at a deliberately
non-idempotent insert and asserted to observe the change, so "no rows moved" and
"the harness cannot see rows move" are distinguishable results.

### 4. A per-row "Remove" on many-to-many tabs

`EntityRelationTab` renders a per-row **Remove** (trash glyph, `aria-label`
carrying the accessible name — the icon-only shape `EntityTable`'s own
Edit/Delete buttons already use) whenever `config.linkDelete` is present and
the actor holds its permission. Both ids the route needs are already on screen:
`relation.scopeField` is the record being viewed, `relation.targetField` is read
off the row the button sits in — so unlinking needs no picker, no form and no
extra fetch.

- **Many-to-many only.** A one-to-many tab's rows are *records*; removing one
  would mean deleting the child outright, a different and much larger action
  its own screen already offers. The same asymmetry ADR-0076 Amendment 1 kept
  between "Create new" and "New".
- **Gated twice**, as every action here is — *can the API do this at all*
  (`config.linkDelete`) and *may this actor* (`usePermissions`, fail-closed
  while loading) — and **hidden, not disabled**, when either fails (UI Design
  Document §5). The two permissions are checked independently of the create
  side's: for the four traceability links they are genuinely different codes, so
  "may link" is never evidence of "may unlink".
- **It confirms first**, in the same `Modal` shape `EntityListPage`'s own row
  delete uses — title, plain-language body, Cancel plus a `danger` confirm, and
  the API's own error rendered **inside** the modal. Reused rather than
  reinvented, and specifically not a native `confirm()`: nothing in this app
  uses one, and it cannot render an `ApiError`'s message. The body says what
  survives, because "Remove" alone reads as a delete.
- **A failed unlink keeps the confirm open** — the opposite of ADR-0076
  Amendment 1's compound create, and for a stated reason: nothing was written,
  so re-confirming is a **retry** rather than a second write. The two realistic
  failures say different, actionable things (`404` — someone else already
  removed it; `403` — you may not), which is why the API's own message is shown
  rather than one generic string.

`EntityTable` gains one narrowly-scoped prop, `onUnlink`, rather than reusing
`onDelete`. `onDelete` is gated on `config.methods.includes("delete")`, which is
false for every link entity and must stay that way (§1); `onUnlink` is gated on
the prop's presence alone, because both of its real questions have already been
answered by the caller. It also labels itself **"Remove"**, not "Delete", which
is the accurate word.

### 5. Deliberately not extended to MCP

ADR-0076 gave each of its four routes an MCP registry executor, a
`BESPOKE_EXTRA_ACTIONS` row and a generated tool, per `backend/CLAUDE.md`'s
standing rule that a bespoke route lands with its registry entry in the same
commit. **These four `DELETE`s get none**, and that is a decision rather than an
oversight.

The generated-tool layer has one factory per action, and `_make_delete_tool`
produces `async def _delete(id: UUID)` dispatching `item_id=id` — a **single**
id. A link row has no such id on this surface; it is addressed by its pair. So
exposing an unlink over MCP is not a registry row, it is a new *action kind*
with its own name, argument shape and generated description — real new MCP
surface with its own naming and discoverability questions, which is more than
this story's scope and exactly the class of thing this repo writes an ADR for
rather than absorbing.

The precedent already exists and points the same way: REQ-4's and PLAN-1's
`DELETE` routes have been MCP-unreachable since they shipped, for this identical
reason. All six junctions are therefore *consistent* over MCP (link yes, unlink
no) rather than newly inconsistent. Recorded in Consequences as an open gap.

## Consequences

- **All six junctions are now symmetric on the generic surface**, and the
  incoherence ADR-0076's Alternatives declined to create — an unlink action on
  two of six tabs — is avoided by moving all six together. Two of the six gained
  only *discoverability* (their routes already existed); four gained a real
  capability.
- **A traceability matrix becomes correctable, not only assemblable.** Together
  with ADR-0076 this completes the round trip the tabs exist for.
- **Permission catalog 106 → 110**; schema keys 11 → **12**; migration
  `8c1d5a7b93e2`. No database schema change, no generic-surface change, no
  change to `derive_entity_relations`, and links remain immutable.
- **An unlink leaves no audit trail** — and neither does a link, so this ADR
  makes an existing gap symmetric rather than introducing one. `TestLog`
  (EXEC-2) records execution events, not traceability edits. A dedicated audit
  log over link mutations is a real feature with its own schema, retention and
  read-surface questions; it is named here as an open decision for a future
  story rather than invented under a button.
- **Unlinking is not reachable over MCP**, for all six junctions — see Decision
  §5. An `AIAgent` can create every link it has the code for and remove none.
  Closing this needs a new MCP action kind, not a registry row.
- **`tester` now holds a `.delete` code**, the first non-`org_admin`/
  non-`test_manager` delete grant in this repo's seeded bundles. Reasoned in
  Decision §3 on the specific grounds that a link row carries no content; called
  out here so it is visible as a deliberate departure from a repeated pattern
  rather than discovered later as an anomaly.
- **The per-row Remove column appears once `usePermissions` resolves**, absent
  before then (fail-closed). ADR-0076's own actions-strip placeholder covers the
  same window immediately above the table, so the arrival is accounted for on
  screen; a per-column placeholder was judged not worth the complexity. Accepted,
  not overlooked.
- **Found, not fixed: the seeded permission catalog has two rows no catalog
  function declares.** `ai_agent.create`/`ai_agent.update` exist in every
  migrated database (migration `d33d66f4b3c3`, MCP-4/ADR-0063) but `ai_agent` is
  in neither `CRUD_RESOURCES` nor `READ_ONLY_RESOURCES`, so
  `build_permission_catalog()` returns 110 rows where a live database holds 112.
  Every count-based test still passes — `org_admin`'s grants track the live
  table, and the catalog tests compare against the function — so nothing is
  currently broken, but a fresh database and a migrated one genuinely differ,
  which is the exact failure class this repo's own backfill-migration discipline
  exists to prevent. Surfaced while verifying this ADR's own migration against a
  live stack; deliberately **not** fixed here (root `CLAUDE.md`'s rule against
  drive-by fixes of unrelated pre-existing findings) and left as its own item.

## Alternatives considered

- **Derive `linkDelete` from `linkCreate`** (same template, swap the verb).
  Rejected: true of all six today, a coincidence of design rather than a
  contract, and unfalsifiable from the client side — the first junction whose
  unlink lives elsewhere would build a wrong URL with no signal. It would also
  be unable to express the permission, which for four of the six is a different
  code.
- **One `link_write` declaration carrying both verbs and one permission.**
  Rejected for the same reason plus a sharper one: it would make "may link" and
  "may unlink" the same grant, discarding precisely the distinction Decision §3
  mints new codes to draw — `tester` legitimately holds one without the other on
  three of the four links.
- **Add `"delete"` to the link entities' `methods` and reuse `EntityTable`'s
  existing per-row Delete.** Rejected: `methods` describes the generic factory's
  surface, where no `DELETE /{resource}/{id}` exists or can exist for a link
  row, and the flag is read by every other consumer of that config — the
  entity's own admin list page would offer a row delete that `405`s.
- **Reuse the `.create` codes to gate the unlink.** Rejected: an append-only
  grant is a meaningful and probably common role shape (an author who may assert
  traceability but not retract it), and one code for both verbs makes it
  unrepresentable.
- **Idempotent `204` for a pair that is not linked.** Rejected: ADR-0030 fixed
  the opposite for its own junction and the reasoning still holds — and on a tab
  two people can have open at once, the `404` is the more useful answer.
- **Re-validate the cross-project rule on delete, mirroring the create.**
  Rejected: an existing link row already passed that check at insert time, so
  the only rows this could reject are ones the system itself created — making a
  past bug permanently uncorrectable through the UI.
- **A native `confirm()` instead of the shared `Modal`.** Rejected: nothing in
  this app uses one, it cannot render the API's own error message on a failed
  attempt (which is the whole reason the confirm stays open on failure), and it
  is untestable through RTL without stubbing a global.
- **Ship the unlink for the two junctions that already had routes, and defer
  the other four.** Rejected — this is precisely what ADR-0076's Alternatives
  identified as the incoherence to avoid, and the four that lacked routes are
  the traceability links that most need correcting.
- **An audit log over link create/delete.** Deferred, not rejected — see
  Consequences.
