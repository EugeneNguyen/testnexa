import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityDetailPage from "./EntityDetailPage";
import { apiFetch } from "../../../lib/api/client";
import { getEntity } from "../../../lib/api/entityCrud";

/**
 * ADR-0073 — the generic read-only detail view.
 *
 * Same mocking shape as `EntityListPage.test.tsx`: the config arrives by
 * mocking `pages/admin/useEntitySchema` (the fetch hook every admin surface
 * reads its config from, ADR-0055), permissions by mocking `apiFetch`'s
 * `GET /orgs/{id}/permissions/mine` response, and the record itself by mocking
 * `getEntity`.
 *
 * Two deliberately different fixture entities, because the claim under test is
 * **genericity**, not any one entity's rendering: `widgets` is a rich
 * project-ish entity (a hidden field, a read-only audit field, an enum, a
 * boolean, an fk) and `gadgets` is a one-field global catalog. Neither has any
 * corresponding branch in the component — which is the point.
 */
const schemaState = vi.hoisted(() => ({ isLoading: false }));

vi.mock("../../../pages/admin/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../pages/admin/registry")>();
  return {
    ...actual,
    entityLabelByKey: { widgets: "Widgets", gadgets: "Gadgets" },
    ADMIN_ENTITY_KEYS: new Set(["widgets", "gadgets", "widget-owners"]),
  };
});

vi.mock("../../../pages/admin/useEntitySchema", () => {
  const configs: Record<string, unknown> = {
    widgets: {
      resource: "widget",
      path: "/widgets",
      methods: ["list", "get", "create", "update", "delete"],
      fields: [
        { name: "title", label: "Title", type: "string", required: true },
        // The whole reason this page exists: invisible in `EntityTable`.
        { name: "notes", label: "Notes", type: "text", showInTable: false },
        { name: "status", label: "Status", type: "enum", values: ["draft", "done"], badgeColors: { done: "success" } },
        { name: "is_active", label: "Is active", type: "boolean" },
        { name: "owner_id", label: "Owner", type: "fk", refEntity: "widget-owner", labelField: "name" },
        { name: "created_at", label: "Created at", type: "date", readOnly: true, showInTable: false },
      ],
    },
    gadgets: {
      resource: "gadget",
      path: "/gadgets",
      methods: ["list", "get"],
      fields: [{ name: "name", label: "Name", type: "string", required: true }],
    },
    "widget-owners": {
      resource: "widget_owner",
      path: "/widget-owners",
      methods: ["list", "get"],
      fields: [{ name: "name", label: "Name", type: "string" }],
    },
  };
  const labels: Record<string, string> = { widgets: "Widgets", gadgets: "Gadgets" };
  const resolveEntityKey = (key: string) => (key.endsWith("s") ? key : `${key}s`);
  return {
    resolveEntityKey,
    useEntitySchema: (key?: string) => {
      const resolved = key ? resolveEntityKey(key) : undefined;
      return {
        config: schemaState.isLoading || !resolved ? undefined : configs[resolved],
        label: resolved ? labels[resolved] : undefined,
        isLoading: Boolean(resolved) && schemaState.isLoading,
        isError: false,
      };
    },
    useEntitySchemas: (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        const resolved = resolveEntityKey(key);
        if (configs[resolved]) {
          out[resolved] = configs[resolved];
        }
      }
      return out;
    },
  };
});

vi.mock("../../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/entityCrud")>();
  return { ...actual, getEntity: vi.fn() };
});

vi.mock("../../../lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockGetEntity = vi.mocked(getEntity);
const mockApiFetch = vi.mocked(apiFetch);

const WIDGET_ROW = {
  id: "w-1",
  title: "First widget",
  notes: "A long note nobody can read from the list table.",
  status: "done",
  is_active: true,
  owner_id: "o-1",
  created_at: "2026-09-15T10:00:00Z",
};

/** Every field name the `widgets` fixture schema declares, in order. */
const WIDGET_FIELD_NAMES = ["title", "notes", "status", "is_active", "owner_id", "created_at"];

function renderPage(entity: "widgets" | "gadgets" | "unknowns" = "widgets", id = "w-1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/orgs/org-1/admin/${entity}/${id}`]}>
        <Routes>
          <Route path="/orgs/:orgId/admin/:entity/:id" element={<EntityDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EntityDetailPage (ADR-0073)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    schemaState.isLoading = false;
  });

  /**
   * TC-ADMIN-059 (unit half): the detail page renders a labeled value for
   * EVERY field the served schema declares — including the two the list table
   * hides (`showInTable: false`), which is the gap this page closes. The e2e
   * spec proves the same claim against a real entity's real schema.
   */
  it("TC-ADMIN-059: renders every field in the served schema, including ones the list table hides", async () => {
    mockApiFetch.mockResolvedValue({ codes: [] });
    mockGetEntity.mockImplementation(async (config: { path: string }, id: string) =>
      config.path === "/widget-owners" ? { id, name: "Ada Owner" } : WIDGET_ROW,
    );

    renderPage();

    expect(await screen.findByTestId("entity-detail-field-title")).toHaveTextContent("First widget");

    // Both hidden-from-table fields are present and carry their real values.
    expect(screen.getByTestId("entity-detail-label-notes")).toHaveTextContent("Notes");
    expect(screen.getByTestId("entity-detail-field-notes")).toHaveTextContent(
      "A long note nobody can read from the list table.",
    );
    expect(screen.getByTestId("entity-detail-field-created_at")).toHaveTextContent("Sep 15, 2026");

    // The record's own id is shown too — it is not in `fields[]`.
    expect(screen.getByTestId("entity-detail-field-id")).toHaveTextContent("w-1");

    // Exactly the schema's fields, no more and no fewer.
    WIDGET_FIELD_NAMES.forEach((name) => {
      expect(screen.getByTestId(`entity-detail-field-${name}`)).toBeInTheDocument();
    });
    expect(screen.getAllByTestId(/^entity-detail-field-/)).toHaveLength(WIDGET_FIELD_NAMES.length + 1);
  });

  /**
   * TC-ADMIN-059 (formatting half): values render through the same shared
   * `EntityFieldValue` molecule `EntityTable`'s cells use, so an enum is the
   * same badge, a boolean is the same badge, a date is the same format, and an
   * fk resolves to the same label — no second renderer to drift.
   */
  it("TC-ADMIN-059: formats enum/boolean/date/fk values exactly as the list table does", async () => {
    mockApiFetch.mockResolvedValue({ codes: [] });
    mockGetEntity.mockImplementation(async (config: { path: string }, id: string) =>
      config.path === "/widget-owners" ? { id, name: "Ada Owner" } : WIDGET_ROW,
    );

    renderPage();

    expect(await screen.findByText("done")).toHaveClass("badge", "bg-success");
    expect(screen.getByText("Yes")).toHaveClass("badge", "bg-success");
    // The fk resolves to its ref entity's `labelField`, not the raw uuid.
    await waitFor(() =>
      expect(screen.getByTestId("entity-detail-field-owner_id")).toHaveTextContent("Ada Owner"),
    );
  });

  /**
   * TC-ADMIN-060 (unit half): the same component, with no per-entity branch,
   * renders a structurally different entity correctly — a one-field global
   * catalog with no fk, no enum and no hidden field. The e2e spec covers the
   * same claim across three real entity types end to end.
   */
  it("TC-ADMIN-060: renders a structurally different entity generically, with no per-entity code path", async () => {
    mockApiFetch.mockResolvedValue({ codes: [] });
    mockGetEntity.mockResolvedValue({ id: "g-1", name: "System Testing" });

    renderPage("gadgets", "g-1");

    expect(await screen.findByTestId("entity-detail-field-name")).toHaveTextContent("System Testing");
    // One schema field + the id row, and nothing carried over from `widgets`.
    expect(screen.getAllByTestId(/^entity-detail-field-/)).toHaveLength(2);
    expect(screen.queryByTestId("entity-detail-field-notes")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Gadgets details" })).toBeInTheDocument();
  });

  /**
   * TC-ADMIN-064: an Edit affordance is present only when BOTH the served
   * schema allows `update` AND the actor holds `<resource>.update` — the same
   * absent-not-disabled posture `EntityListPage`'s New button already takes
   * (NFR-37).
   */
  it("TC-ADMIN-064: hides the Edit button without <resource>.update, shows it with", async () => {
    mockApiFetch.mockResolvedValue({ codes: [] });
    mockGetEntity.mockResolvedValue(WIDGET_ROW);

    const withoutPermission = renderPage();
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(screen.queryByTestId("entity-detail-edit")).not.toBeInTheDocument();
    // Back is unconditional — it is navigation, not a mutation.
    expect(screen.getByTestId("entity-detail-back")).toBeInTheDocument();
    withoutPermission.unmount();

    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({ codes: [{ code: "widget.update", project_id: null }] });
    mockGetEntity.mockResolvedValue(WIDGET_ROW);

    renderPage();
    expect(await screen.findByTestId("entity-detail-edit")).toBeInTheDocument();
  });

  /**
   * TC-ADMIN-064: `gadgets` declares no `update`, so the Edit button is absent
   * on structural grounds even for an actor who holds the permission — the
   * `methods` gap and the permission gap are two independent gates.
   */
  it("TC-ADMIN-064: hides Edit for an entity whose schema omits update, even with the permission held", async () => {
    mockApiFetch.mockResolvedValue({ codes: [{ code: "gadget.update", project_id: null }] });
    mockGetEntity.mockResolvedValue({ id: "g-1", name: "System Testing" });

    renderPage("gadgets", "g-1");

    expect(await screen.findByTestId("entity-detail-field-name")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-detail-edit")).not.toBeInTheDocument();
    // The TC's literal claim is that Back is present in *every* case, not
    // only in the permission-gap one asserted above.
    expect(screen.getByTestId("entity-detail-back")).toBeInTheDocument();
  });

  /**
   * TC-ADMIN-064: ADR-0053's fetched-config loading state — `config` is
   * `undefined` for one round trip on every page load, which must not be
   * mistaken for an unknown `:entity`. Same branch both sibling page
   * components carry.
   */
  it("TC-ADMIN-064: renders a spinner, not the unknown-entity error, while the schema is in flight", async () => {
    schemaState.isLoading = true;
    mockApiFetch.mockResolvedValue({ codes: [] });
    mockGetEntity.mockResolvedValue(WIDGET_ROW);

    renderPage();

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/Unknown admin entity/)).not.toBeInTheDocument();
    expect(mockGetEntity).not.toHaveBeenCalled();
  });

  /** TC-ADMIN-064: a genuinely unrecognised `:entity` still errors. */
  it("TC-ADMIN-064: renders the unknown-entity error once the schema has settled with no config", async () => {
    mockApiFetch.mockResolvedValue({ codes: [] });

    renderPage("unknowns", "x-1");

    expect(await screen.findByText(/Unknown admin entity/)).toBeInTheDocument();
    expect(mockGetEntity).not.toHaveBeenCalled();
  });

  /** TC-ADMIN-064: a failed record fetch renders an error, not a blank page. */
  it("TC-ADMIN-064: renders an error alert when the record fetch fails", async () => {
    mockApiFetch.mockResolvedValue({ codes: [] });
    mockGetEntity.mockRejectedValue(new Error("boom"));

    renderPage();

    expect(await screen.findByTestId("entity-detail-error")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-detail-fields")).not.toBeInTheDocument();
  });
});
