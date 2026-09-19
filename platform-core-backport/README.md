# platform-core backport patches (Stage A)

Patches for **`github.com/EugeneNguyen/platform-core`**, produced during Stage A
(see [ADR-0094](../docs/adr/0094-platform-core-stage-a-enforced-parity.md)).

**Nothing here has been applied or pushed.** That repo is public and changes to
it go through the user directly. The `platform-core` submodule in this worktree
is untouched (`git -C platform-core status --porcelain` is empty) — these files
exist only for the user to review and apply upstream themselves.

## Applying

Paths are relative to the **platform-core repo root**, so from a clone of it:

```
git apply --check ../path/to/0001-....patch   # verify first
git apply         ../path/to/0001-....patch
```

All five were verified to apply cleanly against submodule commit `7c78351`
(`git apply --check`, 5/5 `APPLIES CLEAN`).

## What Stage A found, and what these do *not* cover

Stage A diffed every file platform-core shares with TestNexa's backend. The
extraction is **not behind TestNexa on any real fix**: ADR-0091's
`_actor_membership_exists` sweep, ADR-0040's `role_assignment.project_id`
`ON DELETE CASCADE`, and ADR-0087 Amendment 2's `FieldMeta.select=True` sweep are
all already present in platform-core (Amendment 3 itself is frontend-only —
`EntityRelationTab.tsx` — and outside Stage A's backend scope). 28 of the 38
shared files are code-identical once comments are normalized away.

So these patches are **not** ported TestNexa bug fixes. They are defects
introduced by the extraction itself, plus one real migration bug.

| Patch | Severity | Sites | What it fixes |
|---|---|---|---|
| `0001-crud-factory-all-exports-undefined-names.patch` | **bug** | 3 | `crud_factory.__all__` exports 3 names the module never defines |
| `0002-initial-schema-token-hash-unique-index-drift.patch` | **bug** | 2 | `0001_initial_schema.py` drifts from its own models; `alembic check` fails on a fresh install |
| `0003-tuple-annotation-comma-spacing.patch` | style | 19 | `tuple[str,...]` → `tuple[str, ...]` |
| `0004-noqa-inline-comment-spacing.patch` | style | 2 | one space before `# noqa:`, PEP 8 wants two |
| `0005-deorphan-stripped-reference-punctuation.patch` | cosmetic | 16 files | punctuation left orphaned by the reference-stripping pass |

### 0001 — `__all__` names three functions that don't exist

`backend/app/api/crud_factory.py`'s `__all__` lists
`resolve_risk_note_org_id`, `resolve_item_org_id` and `resolve_via_item`. None
is defined anywhere in the module (or the repo) — they are renamed placeholders
for TestNexa's four domain resolvers, which the extraction removed while leaving
the generified export names behind.

Effect: `from app.api.crud_factory import *` raises `AttributeError`, and every
linter/IDE flags the module. The patch removes the three dead entries; it does
not invent replacements, because platform-core has no domain resolvers to
export (`chain_resolver`/`branching_resolver` are the generic builders and are
already exported correctly).

Verified: `ast`-level check of `__all__` against the module's own top-level
bindings reports `[]` undefined after the patch, `['resolve_risk_note_org_id',
'resolve_item_org_id', 'resolve_via_item']` before it.

### 0002 — the initial migration doesn't match its own models

`app/models/auth.py`'s `RefreshToken.token_hash` and `app/models/tenancy.py`'s
`Invite.token_hash` are both declared
`mapped_column(String, nullable=False, unique=True, index=True)`, which
SQLAlchemy renders as **one** unique index named `ix_<table>_token_hash`.

`0001_initial_schema.py` instead emits **two** objects per column: a table-level
`sa.UniqueConstraint("token_hash")` plus a **non-unique** `op.create_index(...)`.

Correctness is preserved — uniqueness is still enforced, by the separate
`*_token_hash_key` constraint — so this is **not** a security hole. What it does
cost:

- a redundant second index on both tables (write amplification on the auth
  hot path: every refresh-token insert maintains two indexes instead of one);
- `alembic check` **fails on a brand-new platform-core install**, so any
  downstream consumer's own first drift check reports 6 spurious operations
  before they have written a line of their own code.

Reproduced and fixed empirically against a real Postgres, not read off the source:

```
# before the patch — platform-core's own migrations into an empty DB:
$ alembic check
INFO  [alembic.autogenerate.compare.constraints] Detected removed unique constraint 'invite_token_hash_key' on 'invite'
INFO  [alembic.autogenerate.compare.constraints] Detected changed index 'ix_invite_token_hash' on 'invite': unique=False to unique=True
INFO  [alembic.autogenerate.compare.constraints] Detected removed unique constraint 'refresh_token_token_hash_key' on 'refresh_token'
INFO  [alembic.autogenerate.compare.constraints] Detected changed index 'ix_refresh_token_token_hash' on 'refresh_token': unique=False to unique=True
FAILED: New upgrade operations detected: [6 operations]

# after the patch, same procedure, fresh DB:
$ alembic check
No new upgrade operations detected.
```

The patch also makes platform-core's schema **exactly** match TestNexa's live
schema for the 14 tables the two share — before it, 41 constraints/41 indexes vs
TestNexa's 39/39; after it, 39/39 and a byte-identical `diff`, with columns
already identical at 94/94 either way. That parity is what makes a future
Stage B (one canonical generic layer) a schema no-op.

### 0003 / 0004 — formatting the extraction regressed

TestNexa has `tuple[str, ...]` in all 25 of its occurrences; platform-core has
`tuple[str,...]` in all 19 of its own (`crud_factory.py`, `entity_registry.py`,
`rbac_seed_catalog.py`) — a space the extraction ate, and `ruff`'s E231.
Likewise `deps.py`'s two `# noqa: PLC0414` comments lost one of their two
leading spaces (E262). Both are zero-behaviour changes, proven by an AST
round-trip: normalizing both sides through `ast.parse` → strip docstrings →
`ast.unparse` yields identical output before and after each patch.

### 0005 — orphaned punctuation from the reference-stripping pass

Cosmetic, and the largest patch, so it is deliberately last and separable.

TestNexa opens docstrings as `"""ADR-0053: per-field metadata ...` and inline
comments as `# ADR-0091/ADR-0033: ...`. The extraction removed the references
but left their punctuation, producing:

- `""": per-field metadata ...` — 15 sites, including two docstrings reduced to
  a bare `""":` with the sentence continuing on the next line
  (`LinkDeleteAction`, `CompoundCreateAction`);
- `# /: ...` — 10 sites (the `/` that had joined two stripped references);
- `( deliberate split ...` — 12 empty-parenthesis holes;
- `#. Deriving this ...` — 9 orphaned `§N.` bullets;
- `"""Credential fields added beyond the 07 draft,."""` and one docstring line
  reduced to a lone `.`.

The patch only deletes orphaned punctuation and restores sentence
capitalization — **it invents no prose**, so it cannot misdescribe behaviour.
Verified zero-behaviour by the same AST round-trip as 0003/0004, and every
touched file re-parses.

**Two sites lost enough content that de-orphaning alone still reads oddly**, and
are worth a human rewrite rather than just this patch:

- `app/schemas/rbac.py:12` — `**Merge note ( x, both landed independently and
  collided on ...`; the two references either side of `x` are gone, so the
  sentence no longer names what collided.
- `app/api/routes/auth.py:629` — `... never hold a `refresh_token` cookie
  session ( —`, where the parenthetical's entire content was the reference.

This patch is safe to skip entirely if upstream would rather re-run its own
stripping pass more carefully; 0001 and 0002 are the ones that matter.

## Provenance

Every patch was generated against a **copy** of the submodule in a scratch
directory, one fix function per patch in isolation, then `git apply --check`ed
against the real submodule. The submodule working tree was confirmed clean
before and after.
