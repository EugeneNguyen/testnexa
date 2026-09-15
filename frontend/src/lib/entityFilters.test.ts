/**
 * ADR-0072 (ENTITY-FILTER-1) — unit tests for the pure draft-condition model
 * behind `EntityTable`'s Filter modal. No React, no DOM: every rule here is
 * exercised as a plain function, same split `columnPreferences.test.ts` uses
 * for the sibling column-visibility feature.
 *
 * Covers TC-ADMIN-053 (add/remove), TC-ADMIN-054 (AND-combination and the
 * one-condition-per-field rule) and TC-ADMIN-056 (a `text` field is not
 * offered, and a stale stored field is dropped rather than rendered).
 */
import { describe, expect, it } from "vitest";
import type { EntityConfig, FieldConfig } from "../entityConfigs/types";
import {
  activeFilterCount,
  addCondition,
  availableFieldsFor,
  conditionsFromFilters,
  filterableFields,
  filtersFromConditions,
  nextUnusedField,
  removeCondition,
  updateCondition,
} from "./entityFilters";

const FIELDS: FieldConfig[] = [
  { name: "title", label: "Title", type: "string" },
  { name: "status", label: "Status", type: "enum", values: ["draft", "approved"] },
  { name: "description", label: "Description", type: "text" },
  { name: "is_active", label: "Is Active", type: "boolean" },
];

/**
 * `filterFields` is the backend-derived list (ADR-0072) — `description` is
 * absent from it because it is a `text` field, which the derivation excludes.
 */
const CONFIG: EntityConfig = {
  resource: "widget",
  path: "/widgets",
  methods: ["list", "get", "create", "update", "delete"],
  fields: FIELDS,
  filterFields: ["title", "status", "is_active"],
};

describe("filterableFields", () => {
  it("offers only the fields the served schema declares filterable, in config order", () => {
    expect(filterableFields(CONFIG).map((f) => f.name)).toEqual(["title", "status", "is_active"]);
  });

  it("excludes a `text` field even though it is a real, served column (TC-ADMIN-056)", () => {
    expect(filterableFields(CONFIG).map((f) => f.name)).not.toContain("description");
  });

  it("yields an empty list when the schema serves no filterFields at all", () => {
    expect(filterableFields({ ...CONFIG, filterFields: undefined })).toEqual([]);
    expect(filterableFields({ ...CONFIG, filterFields: [] })).toEqual([]);
  });

  it("ignores a filterFields entry the schema has no matching field for", () => {
    const config = { ...CONFIG, filterFields: ["title", "gone_away"] };
    expect(filterableFields(config).map((f) => f.name)).toEqual(["title"]);
  });
});

describe("addCondition / removeCondition", () => {
  it("adds a row pre-assigned to the first unused field (TC-ADMIN-053)", () => {
    const fields = filterableFields(CONFIG);
    const one = addCondition(fields, []);
    expect(one).toEqual([{ field: "title", value: "" }]);

    const two = addCondition(fields, one);
    expect(two.map((c) => c.field)).toEqual(["title", "status"]);
  });

  it("refuses to add once every filterable field is claimed", () => {
    const fields = filterableFields(CONFIG);
    const full = fields.map((field) => ({ field: field.name, value: "x" }));
    expect(addCondition(fields, full)).toBe(full);
    expect(nextUnusedField(fields, full)).toBeUndefined();
  });

  it("removes exactly the named row and leaves the rest in order (TC-ADMIN-053)", () => {
    const draft = [
      { field: "title", value: "a" },
      { field: "status", value: "draft" },
      { field: "is_active", value: "true" },
    ];
    expect(removeCondition(draft, 1)).toEqual([
      { field: "title", value: "a" },
      { field: "is_active", value: "true" },
    ]);
  });

  it("is a no-op for an out-of-range remove", () => {
    const draft = [{ field: "title", value: "a" }];
    expect(removeCondition(draft, 5)).toBe(draft);
    expect(removeCondition(draft, -1)).toBe(draft);
  });
});

describe("availableFieldsFor (one condition per field, TC-ADMIN-054)", () => {
  it("hides a field another row already claims", () => {
    const fields = filterableFields(CONFIG);
    const draft = [
      { field: "title", value: "a" },
      { field: "status", value: "draft" },
    ];
    expect(availableFieldsFor(fields, draft, 1).map((f) => f.name)).toEqual(["status", "is_active"]);
  });

  it("keeps the row's OWN current field selectable, so its select has a matching option", () => {
    const fields = filterableFields(CONFIG);
    const draft = [{ field: "status", value: "draft" }];
    expect(availableFieldsFor(fields, draft, 0).map((f) => f.name)).toContain("status");
  });
});

describe("updateCondition", () => {
  it("updates a value in place", () => {
    const draft = [{ field: "title", value: "" }];
    expect(updateCondition(draft, 0, { value: "widget" })).toEqual([{ field: "title", value: "widget" }]);
  });

  it("clears the value when the row is re-pointed at a different field", () => {
    const draft = [{ field: "title", value: "widget" }];
    expect(updateCondition(draft, 0, { field: "status" })).toEqual([{ field: "status", value: "" }]);
  });

  it("leaves other rows untouched", () => {
    const draft = [
      { field: "title", value: "a" },
      { field: "status", value: "draft" },
    ];
    expect(updateCondition(draft, 0, { value: "b" })[1]).toEqual({ field: "status", value: "draft" });
  });
});

describe("filtersFromConditions (AND-combination on the wire, TC-ADMIN-054)", () => {
  it("serializes every complete condition into one query-param map", () => {
    expect(
      filtersFromConditions([
        { field: "title", value: "widget" },
        { field: "status", value: "draft" },
      ]),
    ).toEqual({ title: "widget", status: "draft" });
  });

  it("drops a row with no field chosen or no value typed", () => {
    expect(
      filtersFromConditions([
        { field: "", value: "orphan" },
        { field: "status", value: "" },
        { field: "title", value: "kept" },
      ]),
    ).toEqual({ title: "kept" });
  });
});

describe("conditionsFromFilters (re-seeding the draft on open)", () => {
  it("round-trips an applied filter map back into conditions", () => {
    const fields = filterableFields(CONFIG);
    const conditions = conditionsFromFilters({ title: "widget", status: "draft" }, fields);
    expect(filtersFromConditions(conditions)).toEqual({ title: "widget", status: "draft" });
  });

  it("drops a stored filter naming a field the schema no longer serves as filterable (TC-ADMIN-056)", () => {
    const fields = filterableFields(CONFIG);
    // `description` is a real field but not filterable; `gone_away` is neither.
    expect(conditionsFromFilters({ description: "x", gone_away: "y", title: "kept" }, fields)).toEqual([
      { field: "title", value: "kept" },
    ]);
  });
});

describe("activeFilterCount (the header badge)", () => {
  it("counts only non-empty applied values", () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ title: "a", status: "" })).toBe(1);
    expect(activeFilterCount({ title: "a", status: "draft" })).toBe(2);
  });
});
