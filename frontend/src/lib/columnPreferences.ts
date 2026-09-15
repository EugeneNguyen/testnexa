/**
 * ADR-0071 (COLPREF-1) — per-entity column visibility + ordering for
 * `EntityTable`, persisted in `localStorage`.
 *
 * This module is the *pure* half of the feature: no React, no DOM beyond the
 * `localStorage` accessors themselves, so every merge/ordering/locking rule
 * below is unit-testable on its own (`columnPreferences.test.ts`) without
 * rendering a table.
 *
 * **Keyed per entity, never shared.** The storage key is
 * `testnexa.column-prefs.<config.resource>` — `resource` is the snake_case
 * permission-code slug (`test_case`, `requirement`, ...), unique per entity,
 * so hiding a column on one entity's list can never affect another's
 * (NFR-71).
 *
 * **Everything is defensive.** `localStorage` can throw outright (a private
 * window, blocked site data), can return `null`, and can return a value some
 * older build — or a hand-edited devtools session — wrote in a shape this
 * build no longer understands. Every one of those cases must degrade to "use
 * the entity's own config defaults", never to a thrown error or an empty
 * table. Same posture the repo already applies to a missing `badgeColors`
 * key: fall back, don't fail.
 */
import { EntityConfig, FieldConfig } from "../entityConfigs/types";

/** Bumped only if the persisted shape changes incompatibly; an unknown version is discarded. */
export const COLUMN_PREFERENCES_VERSION = 1;

export const COLUMN_PREFERENCES_KEY_PREFIX = "testnexa.column-prefs.";

export interface ColumnPreferences {
  v: number;
  /**
   * Field names in the user's chosen column order. May name a field the
   * schema no longer serves (ignored on apply) and may omit a field the
   * schema has since gained (appended on apply, in config order) — see
   * `toPreferenceRows`.
   */
  order: string[];
  /** Field names the user has hidden. A locked field listed here is ignored. */
  hidden: string[];
}

export function columnPreferencesKey(resource: string): string {
  return `${COLUMN_PREFERENCES_KEY_PREFIX}${resource}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Narrows an already-parsed JSON value to `ColumnPreferences`. Anything that
 * isn't exactly the current shape — wrong version, non-array `order`, a
 * non-string entry inside it — is rejected wholesale rather than partially
 * salvaged: a half-understood preference is more confusing than none.
 */
export function parseColumnPreferences(raw: string | null): ColumnPreferences | null {
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const candidate = parsed as Partial<ColumnPreferences>;
  if (candidate.v !== COLUMN_PREFERENCES_VERSION) {
    return null;
  }
  if (!isStringArray(candidate.order) || !isStringArray(candidate.hidden)) {
    return null;
  }
  return { v: COLUMN_PREFERENCES_VERSION, order: candidate.order, hidden: candidate.hidden };
}

export function loadColumnPreferences(resource: string): ColumnPreferences | null {
  try {
    return parseColumnPreferences(window.localStorage.getItem(columnPreferencesKey(resource)));
  } catch {
    // Storage access itself threw (private window / blocked site data).
    return null;
  }
}

export function saveColumnPreferences(resource: string, preferences: ColumnPreferences): void {
  try {
    window.localStorage.setItem(columnPreferencesKey(resource), JSON.stringify(preferences));
  } catch {
    // Quota exceeded or storage blocked — the in-memory state still applies
    // for this session; it just won't survive a reload. Deliberately silent:
    // there is no user action that would fix it.
  }
}

export function clearColumnPreferences(resource: string): void {
  try {
    window.localStorage.removeItem(columnPreferencesKey(resource));
  } catch {
    // See saveColumnPreferences.
  }
}

/**
 * The entity's own default column set, in config order — exactly what
 * `EntityTable` rendered before this story: every field the served schema
 * marks as belonging in the table.
 */
export function defaultTableFields(config: EntityConfig): FieldConfig[] {
  return config.fields.filter((field) => field.showInTable !== false);
}

/**
 * Fields the user may never hide (ADR-0071 Decision §5).
 *
 * Today this is exactly one rule: the `detailLinkField` of a config that has
 * a `detailPath` (ADR-0060 — `Project.name` is the only entity using it).
 * That cell is the only navigation into that entity's real detail workspace,
 * so hiding it strands the user on a list they can't click through.
 *
 * The *other* locking rule — "you can't hide the last remaining visible
 * column" — is deliberately NOT here: it depends on the user's current
 * in-modal selection, not on the config, so it lives in the modal's own
 * per-render disabled logic instead.
 */
export function lockedFieldNames(config: EntityConfig): string[] {
  if (config.detailPath && config.detailLinkField) {
    return [config.detailLinkField];
  }
  return [];
}

export interface ColumnPreferenceRow {
  field: FieldConfig;
  visible: boolean;
  /** True when this field may never be hidden — see `lockedFieldNames`. */
  locked: boolean;
}

/**
 * Merges a stored preference onto the entity's current schema, producing the
 * full ordered list of table fields with a visibility flag on each. The
 * single source of truth for both the modal's rows and the table's rendered
 * columns, so the two can never disagree.
 *
 * Merge rules (ADR-0071 Decision §6):
 * - Fields named in `order` come first, in that order — but only if the
 *   schema still serves them. A stale name is dropped silently.
 * - Any schema field the stored `order` doesn't mention is appended after
 *   them, in config order. An entity that gains a column later therefore
 *   *shows* that column rather than silently swallowing it.
 * - A field in `hidden` is hidden — unless it is locked, in which case the
 *   stale preference is overridden and it renders anyway.
 */
export function toPreferenceRows(
  fields: FieldConfig[],
  preferences: ColumnPreferences | null,
  locked: string[],
): ColumnPreferenceRow[] {
  const lockedSet = new Set(locked);
  const byName = new Map(fields.map((field) => [field.name, field]));

  const ordered: FieldConfig[] = [];
  const placed = new Set<string>();
  for (const name of preferences?.order ?? []) {
    const field = byName.get(name);
    if (field && !placed.has(name)) {
      ordered.push(field);
      placed.add(name);
    }
  }
  for (const field of fields) {
    if (!placed.has(field.name)) {
      ordered.push(field);
      placed.add(field.name);
    }
  }

  const hiddenSet = new Set(preferences?.hidden ?? []);
  return ordered.map((field) => ({
    field,
    locked: lockedSet.has(field.name),
    visible: lockedSet.has(field.name) || !hiddenSet.has(field.name),
  }));
}

/**
 * The columns `EntityTable` actually renders: `toPreferenceRows` filtered to
 * the visible ones.
 *
 * Final safety net: if a stored preference would leave *zero* columns (only
 * reachable via a hand-written storage value, since the modal disables the
 * last visible field's checkbox), fall back to the full ordered set rather
 * than painting a table of empty rows.
 */
export function applyColumnPreferences(
  fields: FieldConfig[],
  preferences: ColumnPreferences | null,
  locked: string[],
): FieldConfig[] {
  const rows = toPreferenceRows(fields, preferences, locked);
  const visible = rows.filter((row) => row.visible).map((row) => row.field);
  return visible.length > 0 ? visible : rows.map((row) => row.field);
}

/** Serializes the modal's current rows back into the persisted shape. */
export function preferencesFromRows(rows: ColumnPreferenceRow[]): ColumnPreferences {
  return {
    v: COLUMN_PREFERENCES_VERSION,
    order: rows.map((row) => row.field.name),
    hidden: rows.filter((row) => !row.visible).map((row) => row.field.name),
  };
}

/** Immutably swaps row `index` with its neighbour in `direction`; a no-op at either end. */
export function moveRow(
  rows: ColumnPreferenceRow[],
  index: number,
  direction: "up" | "down",
): ColumnPreferenceRow[] {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) {
    return rows;
  }
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
