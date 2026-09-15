/**
 * ADR-0073: batched, deduped FK-label resolution for any `EntityConfig`-driven
 * surface — extracted verbatim out of `EntityTable`'s own body so
 * `EntityDetailPage` reuses it instead of shipping a second copy (the
 * component-reuse rule `frontend/CLAUDE.md` makes mandatory; this is a reuse
 * extraction, not a new architecture decision of its own).
 *
 * Resolves one `getEntity` call per **distinct** FK id per FK field across the
 * rows handed in — §3's own "not one request per row" requirement. The detail
 * page passes a single-element `rows` array, so the same code trivially
 * degrades to "one request per distinct FK on this record."
 *
 * Two separate field lists, deliberately:
 *
 * - `labelFields` — the fields whose labels are actually wanted (`EntityTable`
 *   passes only its visible `showInTable !== false` columns; `EntityDetailPage`
 *   passes every field).
 * - `schemaFields` — the fields whose `refEntity` schemas get fetched. Kept
 *   separate because `EntityTable` has always fetched schemas for **every**
 *   `refEntity` on the config, visible column or not, and narrowing that here
 *   would be a silent behavior change bundled into an unrelated extraction.
 */
import { useEffect, useMemo, useState } from "react";
import { FieldConfig } from "../../entityConfigs/types";
import { EntityRow, getEntity } from "../../lib/api/entityCrud";
import { resolveEntityKey, useEntitySchemas } from "./useEntitySchema";

/** `{ fieldName: { fkId: resolvedLabel } }` — an unresolved id maps to itself. */
export type FkLabelMap = Record<string, Record<string, string>>;

export function useFkLabels(
  labelFields: FieldConfig[],
  rows: EntityRow[],
  schemaFields: FieldConfig[],
): FkLabelMap {
  const fkFields = useMemo(
    () => labelFields.filter((f) => f.type === "fk" && f.refEntity),
    [labelFields],
  );
  const [fkLabels, setFkLabels] = useState<FkLabelMap>({});

  const refEntityKeys = useMemo(
    () => schemaFields.filter((f) => f.refEntity).map((f) => f.refEntity as string),
    [schemaFields],
  );
  const refConfigs = useEntitySchemas(refEntityKeys);

  // A *primitive* fingerprint of which ref schemas have actually landed. The
  // effect below has to re-run when one arrives (they resolve after first
  // render), but keying it on `refConfigs`' object identity would make it
  // re-run on every render for any caller that passes a fresh `config` object,
  // and each run calls `setFkLabels`, i.e. a render loop. A joined string
  // can't do that.
  const refConfigFingerprint = fkFields
    .map((f) => `${f.name}:${refConfigs[resolveEntityKey(f.refEntity as string)]?.path ?? ""}`)
    .join("|");

  /**
   * [ADR-0074](../../../../docs/adr/0074-entity-detail-relationship-tabs.md)
   * — the same primitive-fingerprint trick, now for `rows` too, and for the
   * same reason applied one argument over. Keying the effect on the `rows`
   * **array identity** made it re-run on every render for any caller that
   * builds that array inline, and every run ends in `setFkLabels(next)` with
   * a fresh object — a self-sustaining fetch loop.
   *
   * This is not hypothetical: `EntityDetailPage` passed `row ? [row] : []`,
   * a new array on every render, and measured **2913 `getEntity` calls in
   * 400ms** — an unbounded request storm against the backend, on a page that
   * looked completely correct while doing it (see ADR-0073's own Amendment 1).
   * The rendered output is identical whether the effect runs once or forever,
   * which is exactly why neither that story's unit tests nor its live manual
   * pass caught it.
   *
   * Fingerprinting the ids rather than the array also makes the effect skip
   * re-fetching when a caller hands over a genuinely new array whose FK values
   * happen to be unchanged — a real saving for `EntityTable`, which rebuilds
   * `rows` on every list refetch.
   */
  const fkIdFingerprint = fkFields
    .map(
      (f) =>
        `${f.name}:${Array.from(
          new Set(rows.map((row) => row[f.name]).filter((v): v is string => typeof v === "string")),
        )
          .sort()
          .join(",")}`,
    )
    .join("|");

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const next: FkLabelMap = {};
      for (const field of fkFields) {
        const refConfig = field.refEntity ? refConfigs[resolveEntityKey(field.refEntity)] : undefined;
        if (!refConfig) {
          continue;
        }
        const ids = Array.from(
          new Set(rows.map((row) => row[field.name]).filter((v): v is string => typeof v === "string")),
        );
        const entries = await Promise.all(
          ids.map(async (id) => {
            try {
              const row = await getEntity<EntityRow>(refConfig, id);
              const label = field.labelField ? row[field.labelField] : row.id;
              return [id, label === null || label === undefined ? id : String(label)] as const;
            } catch {
              return [id, id] as const;
            }
          }),
        );
        next[field.name] = Object.fromEntries(entries);
      }
      if (!cancelled) {
        setFkLabels(next);
      }
    }

    if (fkFields.length > 0) {
      void resolve();
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fkIdFingerprint, refConfigFingerprint]);

  return fkLabels;
}
