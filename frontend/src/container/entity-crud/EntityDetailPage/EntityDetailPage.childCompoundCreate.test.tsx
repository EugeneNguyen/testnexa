import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityDetailPage from "./EntityDetailPage";
import type { EntityConfig } from "../../../entityConfigs/types";
import { apiFetch } from "../../../lib/api/client";
import { createEntity, createViaCompoundRoute, getEntity, listEntities } from "../../../lib/api/entityCrud";

/**
 * ADR-0079 — "New <child>" on a one-to-many tab whose child has **no generic
 * `create` at all**, closed via the same bespoke atomic-create route the
 * child's own real authoring path already uses.
 *
 * Harness mirrors `EntityDetailPage.compoundCreate.test.tsx`'s own shape
 * (same synthetic `widgets` parent, same mock structure) — the ADR-0078
 * sibling for the many-to-many case. The one new fixture here:
 * `sprockets-no-create`, a one-to-many child with `create` withdrawn and a
 * `childCompoundCreates` entry declared instead, matching this tab's own
 * `scopeField` exactly (the shape all three live ADR-0079 declarations have —
 * no parent picker, ever, per `test_adr79_child_compound_create.py`'s own
 * `test_path_template_placeholder_equals_far_field`).
 */
const schemaState = vi.hoisted(() => ({ isLoading: false }));

vi.mock("../../../pages/admin/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../pages/admin/registry")>();
  return {
    ...actual,
    entityLabelByKey: { widgets: "Widgets" },
    ADMIN_ENTITY_KEYS: new Set(["widgets", "sprockets-no-create", "projects"]),
  };
});

vi.mock("../../../pages/admin/useEntitySchema", () => {
  const configs: Record<string, unknown> = {
    widgets: {
      resource: "widget",
      path: "/widgets",
      methods: ["list", "get", "update", "delete"],
      fields: [{ name: "title", label: "Title", type: "string", required: true }],
      relations: [
        {
          kind: "one-to-many",
          entity: "sprockets-no-create",
          scopeField: "widget_id",
          label: "Sprockets",
          targetEntity: "sprockets-no-create",
          targetField: null,
        },
      ],
    },
    "sprockets-no-create": {
      resource: "sprocket",
      path: "/sprockets",
      // No `create` — the whole point. The real authoring path is the bespoke
      // route the declaration below names.
      methods: ["list", "get", "update", "delete"],
      scopeField: "widget_id",
      fields: [
        { name: "name", label: "Name", type: "string", required: true },
        { name: "widget_id", label: "Widget", type: "fk", refEntity: "widget", labelField: "title" },
      ],
      relations: [],
      childCompoundCreates: [
        {
          farField: "widget_id",
          pathTemplate: "/widgets/{widget_id}/sprockets",
          // Deliberately NOT `sprocket.create` -- proves the gate reads the
          // declared code, not a conventionally-derived one, the same
          // discipline ADR-0078's own sibling test enforces.
          permission: "sprocket.author",
          linksAutomatically: true,
          parentEntity: null,
          parentLabel: null,
          parentLabelField: null,
          parentFilters: {},
        },
      ],
    },
    projects: {
      resource: "project",
      path: "/projects",
      methods: ["list", "get", "update", "delete"],
      fields: [{ name: "name", label: "Name", type: "string" }],
      relations: [],
    },
  };
  const resolveEntityKey = (key: string) => (key.endsWith("s") || key.includes("-") ? key : `${key}s`);
  return {
    resolveEntityKey,
    useEntitySchema: (key?: string) => {
      const resolved = key ? resolveEntityKey(key) : undefined;
      return {
        config: schemaState.isLoading || !resolved ? undefined : configs[resolved],
        label: resolved ? "Widgets" : undefined,
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
  return {
    ...actual,
    getEntity: vi.fn(),
    listEntities: vi.fn(),
    createEntity: vi.fn(),
    createViaCompoundRoute: vi.fn(),
  };
});

vi.mock("../../../lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockGetEntity = vi.mocked(getEntity);
const mockListEntities = vi.mocked(listEntities);
const mockCreateEntity = vi.mocked(createEntity);
const mockCreateViaCompoundRoute = vi.mocked(createViaCompoundRoute);
const mockApiFetch = vi.mocked(apiFetch);

const WIDGET_ROW = { id: "w-1", title: "First widget" };

function primeMocks(codes: string[]) {
  mockApiFetch.mockResolvedValue({ codes: codes.map((code) => ({ code, project_id: null })) });
  mockGetEntity.mockImplementation(async (config: EntityConfig, id: string) =>
    config.path === "/projects" ? { id, org_id: "org-1", name: "Project one" } : WIDGET_ROW,
  );
  mockListEntities.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
  mockCreateViaCompoundRoute.mockResolvedValue({ id: "new-1" });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects/p-1/admin/widgets/w-1?tab=sprockets-no-create"]}>
        <Routes>
          <Route path="/projects/:projectId/admin/:entity/:id" element={<EntityDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EntityRelationTab one-to-many compound create (ADR-0079)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    schemaState.isLoading = false;
  });

  it("TC-ADMIN-131: a one-to-many tab whose child has no generic create renders New via its declared compound route", async () => {
    primeMocks(["sprocket.author"]);

    renderPage();

    const button = await screen.findByTestId("entity-relation-create");
    expect(button).toHaveAccessibleName(/new sprockets/i);
    // Never a "Link existing" sibling on a one-to-many tab, compound or not.
    expect(screen.queryByTestId("entity-relation-link")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-131: the New button is ABSENT without the declared permission code — not `sprocket.create`, which does not exist", async () => {
    primeMocks(["sprocket.create"]);

    renderPage();

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(screen.queryByTestId("entity-relation-create")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-132: submitting the New form calls the bespoke compound route, not the generic create — with the tab's own scope filled from the URL, not the form", async () => {
    primeMocks(["sprocket.author"]);
    const user = userEvent.setup();

    renderPage();

    await user.click(await screen.findByTestId("entity-relation-create"));
    await user.type(await screen.findByLabelText(/^name$/i), "New sprocket");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockCreateViaCompoundRoute).toHaveBeenCalledTimes(1));
    expect(mockCreateViaCompoundRoute).toHaveBeenCalledWith(
      expect.objectContaining({ pathTemplate: "/widgets/{widget_id}/sprockets" }),
      { widget_id: "w-1" },
      expect.objectContaining({ name: "New sprocket" }),
    );
    // The whole point of `linksAutomatically`: no second call of any kind.
    expect(mockCreateEntity).not.toHaveBeenCalled();
  });
});
