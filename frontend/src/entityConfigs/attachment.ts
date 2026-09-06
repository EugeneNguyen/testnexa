/**
 * `Attachment` (backend/app/api/routes/governance.py `_ATTACHMENT_CONFIG`,
 * backend/app/schemas/governance.py). Full CRUD. UI Design Document §4 shape
 * C: single `FkAutocomplete` against `TestCase` — see `test-case.ts`'s own
 * docstring for why that search can't resolve against a live backend today
 * (no `TestCase` list route exists; the scope-selector step itself will
 * still render, it just has nothing to find until a search term happens to
 * be typed and the request 422s/404s, surfaced via the ordinary error path).
 *
 * `size_bytes` is an integer column; per the field-type enum having no
 * numeric type (UI Design Document §3), rendered as `type: "string"`.
 */
import { EntityConfig } from "./types";

const attachment: EntityConfig = {
  resource: "attachment",
  path: "/attachments",
  scopeField: "test_case_id",
  scopeSelector: { refEntity: "test-case", paramName: "test_case_id" },
  methods: ["list", "get", "create", "update", "delete"],
  fields: [
    { name: "test_case_id", label: "Test case", type: "fk", refEntity: "test-case", labelField: "title", required: true },
    { name: "url_or_path", label: "URL / path", type: "string", required: true },
    { name: "mime_type", label: "MIME type", type: "string", required: true },
    { name: "size_bytes", label: "Size (bytes)", type: "string", required: true },
  ],
};

export default attachment;
