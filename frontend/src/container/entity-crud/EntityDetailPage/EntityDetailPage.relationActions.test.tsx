import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityDetailPage from "./EntityDetailPage";
import { pickerScopeParams } from "./EntityRelationTab";
import type { EntityConfig } from "../../../entityConfigs/types";
import { apiFetch } from "../../../lib/api/client";
import { createEntity, createLinkRow, getEntity, listEntities } from "../../../lib/api/entityCrud";

/**
 * ADR-0073 — the relationship tabs' two write actions (TC-ADMIN-075,
 * TC-ADMIN-076, TC-ADMIN-077).
 *
 * Deliberately a sibling of `EntityDetailPage.tabs.test.tsx` rather than an
 * addition to it: that file's claim is "the tab strip is driven by
 * `config.relations` alone" and every one of its assertions is about *reading*.
 * The claim here is a different one — "exactly one write action renders per
 * tab, gated twice" — and mixing them would make both harder to read. The
 * synthetic fixtures are the same shapes for the same reason that file gives:
 * the component must hard-code no entity.
 *
 * - `widgets` — one one-to-many relation (`sprockets`) and one many-to-many
 *   (`widget-gizmo-links` → `gizmos`). The `Requirement`/`TestCase` shape.
 * - `sprockets` registers `create`; `widget-gizmo-links` declares a
 *   `linkCreate`. Both are what makes the corresponding action *possible*;
 *   `usePermissions` is what makes it *allowed*, and the two are asserted
 *   separately because conflating them is how a hide-don't-disable gate ends
 *   up only half-implemented.
 * - `gizmos` is scoped by `project_id`, so the picker resolves its own scope
 *   from the route (case 2 of ADR-0073 Decision §5). `pickerScopeParams`'
 *   other two cases are asserted directly at the bottom of this file — three
 *   rendered modals to pin one pure function would be a much worse trade.
 */
const schemaState = vi.hoisted(() => ({ isLoading: false }));

vi.mock("../../../pages/admin/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../pages/admin/registry")>();
  return {
    ...actual,
    entityLabelByKey: { widgets: "Widgets" },
    ADMIN_ENTITY_KEYS: new Set([
      "widgets",
      "sprockets",
      "gizmos",
      "widget-gizmo-links",
      "doodads",
      "widget-doodad-links",
      "projects",
    ]),
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
          entity: "sprockets",
          scopeField: "widget_id",
          label: "Sprockets",
          targetEntity: "sprockets",
          targetField: null,
        },
        {
          kind: "many-to-many",
          entity: "widget-gizmo-links",
          scopeField: "widget_id",
          label: "Gizmos (linked)",
          targetEntity: "gizmos",
          targetField: "gizmo_id",
        },
        /**
         * A second many-to-many whose link entity declares NO `linkCreate` —
         * the shape an older backend, or a junction nobody has written a
         * route for yet, serves. Exists purely so the API-capability half of
         * the gate can be asserted against a real render rather than inferred.
         */
        {
          kind: "many-to-many",
          entity: "widget-doodad-links",
          scopeField: "widget_id",
          label: "Doodads (linked)",
          targetEntity: "doodads",
          targetField: "doodad_id",
        },
      ],
    },
    sprockets: {
      resource: "sprocket",
      path: "/sprockets",
      // `create` is present — the API-capability half of the gate.
      methods: ["list", "get", "create", "update", "delete"],
      scopeField: "widget_id",
      fields: [
        { name: "name", label: "Name", type: "string", required: true },
        { name: "widget_id", label: "Widget", type: "fk", refEntity: "widget", labelField: "title" },
      ],
      relations: [],
    },
    "widget-gizmo-links": {
      resource: "widget_gizmo_link",
      path: "/widget-gizmo-links",
      methods: ["list", "get"],
      fields: [
        { name: "widget_id", label: "Widget", type: "fk", refEntity: "widget", labelField: "title" },
        { name: "gizmo_id", label: "Gizmo", type: "fk", refEntity: "gizmo", labelField: "name" },
      ],
      relations: [],
      linkCreate: {
        pathTemplate: "/widgets/{widget_id}/gizmo-links/{gizmo_id}",
        permission: "widget_gizmo_link.create",
      },
    },
    "widget-doodad-links": {
      resource: "widget_doodad_link",
      path: "/widget-doodad-links",
      methods: ["list", "get"],
      fields: [
        { name: "widget_id", label: "Widget", type: "fk", refEntity: "widget", labelField: "title" },
        { name: "doodad_id", label: "Doodad", type: "fk", refEntity: "doodad", labelField: "name" },
      ],
      relations: [],
      // deliberately no `linkCreate`
    },
    doodads: {
      resource: "doodad",
      path: "/doodads",
      methods: ["list", "get"],
      fields: [{ name: "name", label: "Name", type: "string" }],
      relations: [],
    },
    gizmos: {
      resource: "gizmo",
      path: "/gizmos",
      methods: ["list", "get"],
      scopeField: "project_id",
      fields: [{ name: "name", label: "Name", type: "string" }],
      relations: [],
    },
    /**
     * Not decoration. On a project-scoped admin route the URL carries no
     * `:orgId`, so `useAdminRouteContext` resolves it by fetching the current
     * Project and reading `org_id` off it — and `usePermissions` is disabled
     * until that lands. Omit this and every permission check silently returns
     * `false`, which looks exactly like a broken gate.
     */
    projects: {
      resource: "project",
      path: "/projects",
      methods: ["list", "get", "update", "delete"],
      fields: [{ name: "name", label: "Name", type: "string" }],
      relations: [],
    },
  };
  const resolveEntityKey = (key: string) => (key.endsWith("s") ? key : `${key}s`);
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
  return { ...actual, getEntity: vi.fn(), listEntities: vi.fn(), createEntity: vi.fn(), createLinkRow: vi.fn() };
});

vi.mock("../../../lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockGetEntity = vi.mocked(getEntity);
const mockListEntities = vi.mocked(listEntities);
const mockCreateEntity = vi.mocked(createEntity);
const mockCreateLinkRow = vi.mocked(createLinkRow);
const mockApiFetch = vi.mocked(apiFetch);

const WIDGET_ROW = { id: "w-1", title: "First widget" };
const GIZMO_ROW = { id: "g-9", name: "Ninth gizmo" };

/**
 * `codes` is what `usePermissions` reads. `project_id: null` is an org-wide
 * grant, which satisfies any project — the shape every seeded system role
 * actually produces.
 */
function primeMocks(codes: string[], items: Record<string, unknown>[] = []) {
  mockApiFetch.mockResolvedValue({ codes: codes.map((code) => ({ code, project_id: null })) });
  mockGetEntity.mockImplementation(async (config: EntityConfig, id: string) =>
    config.path === "/projects" ? { id, org_id: "org-1" } : WIDGET_ROW,
  );
  mockListEntities.mockImplementation(async (config: EntityConfig) =>
    config.path === "/gizmos"
      ? { items: [GIZMO_ROW], total: 1, page: 1, page_size: 25 }
      : { items, total: items.length, page: 1, page_size: 25 },
  );
  mockCreateEntity.mockResolvedValue({ id: "new-1" });
  mockCreateLinkRow.mockResolvedValue({});
}

function renderPage(search: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/projects/p-1/admin/widgets/w-1${search}`]}>
        <Routes>
          <Route path="/projects/:projectId/admin/:entity/:id" element={<EntityDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ONE_TO_MANY = "?tab=sprockets";
const MANY_TO_MANY = "?tab=widget-gizmo-links";

describe("EntityDetailPage relationship-tab write actions (ADR-0073)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    schemaState.isLoading = false;
  });

  // --- TC-ADMIN-075: the one-to-many "New" action ------------------------------------------

  it("TC-ADMIN-075: a one-to-many tab renders a New button when the actor holds the child's create code", async () => {
    primeMocks(["sprocket.create"]);

    renderPage(ONE_TO_MANY);

    expect(await screen.findByTestId("entity-relation-create")).toHaveTextContent("New");
    // Exactly one action per tab — never the link action on a 1-n tab, which
    // has no far entity to pick.
    expect(screen.queryByTestId("entity-relation-link")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-075: the New button is ABSENT, not disabled, without the create code", async () => {
    /**
     * UI Design Document §5's hide-don't-disable posture. Asserted as absence
     * specifically because a disabled button still advertises a capability the
     * actor does not have, and because `usePermissions` fails closed while
     * loading — a `toBeDisabled()` assertion would pass on a button that later
     * becomes enabled.
     */
    primeMocks([]);

    renderPage(ONE_TO_MANY);

    // Wait for the tab's own table to have rendered, so this is "the button
    // never appeared", not "the page had not finished loading". `EntityTable`
    // in `bare` mode carries no wrapper test id, so its empty state is the
    // anchor.
    expect(await screen.findByText("No records found.")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-create")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-075: the create modal locks the scope field and submits it with the parent's id", async () => {
    /**
     * The point of the whole action: the new row lands under the record being
     * viewed and the user cannot retarget it. Two separate claims — the field
     * is not editable, and the value actually reaches the payload — because
     * `EntityForm` keeps locked fields out of its Zod schema and merges them
     * in afterwards, so a regression in either half is invisible from the other.
     */
    const user = userEvent.setup();
    primeMocks(["sprocket.create"]);

    renderPage(ONE_TO_MANY);

    await user.click(await screen.findByTestId("entity-relation-create"));

    const lockedField = await screen.findByLabelText(/widget/i);
    expect(lockedField).toBeDisabled();

    await user.type(screen.getByLabelText(/name/i), "New sprocket");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockCreateEntity).toHaveBeenCalledTimes(1));
    const [, , payload] = mockCreateEntity.mock.calls[0];
    expect(payload).toMatchObject({ name: "New sprocket", widget_id: "w-1" });
  });

  // --- TC-ADMIN-076: the many-to-many "Link existing" action --------------------------------

  it("TC-ADMIN-076: a many-to-many tab renders a Link button labelled by the FAR entity", async () => {
    primeMocks(["widget_gizmo_link.create"]);

    renderPage(MANY_TO_MANY);

    const button = await screen.findByTestId("entity-relation-link");
    // The tab is *about* the far entity (ADR-0071 §5) — `relation.label` minus
    // the `" (linked)"` suffix, never the link table's own name.
    expect(button).toHaveTextContent(/link existing gizmos/i);
    expect(screen.queryByTestId("entity-relation-create")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-076: the Link button is absent without the code the backend declared", async () => {
    /**
     * `widget_gizmo_link.create` comes from the served
     * `linkCreate.permission`, not from a `${resource}.create` convention —
     * the two older junctions really do gate on a parent's `.update`. Granting
     * a plausible-but-wrong code must not reveal the button.
     */
    primeMocks(["widget_gizmo_link.read", "widget.update"]);

    renderPage(MANY_TO_MANY);

    expect(await screen.findByText("No records found.")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-link")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-076: picking a far row POSTs the declared route with both ids keyed by FK name", async () => {
    const user = userEvent.setup();
    primeMocks(["widget_gizmo_link.create"]);

    renderPage(MANY_TO_MANY);

    await user.click(await screen.findByTestId("entity-relation-link"));

    // The picker is `FkAutocomplete`. Queried by its own element id rather
    // than a label regex — "Gizmos" also appears on the tab button and in the
    // action's own label, and a strict-mode multiple-match failure there would
    // read as a render bug rather than a query bug.
    const picker = await screen.findByLabelText("Gizmos", { exact: true });
    await user.type(picker, "Ninth");
    await user.click(await screen.findByText("Ninth gizmo"));

    await user.click(screen.getByTestId("entity-relation-link-submit"));

    await waitFor(() => expect(mockCreateLinkRow).toHaveBeenCalledTimes(1));
    const [action, values] = mockCreateLinkRow.mock.calls[0];
    expect(action).toMatchObject({ pathTemplate: "/widgets/{widget_id}/gizmo-links/{gizmo_id}" });
    // Keyed by the link row's own FK columns — `relation.scopeField` for the
    // record being viewed, `relation.targetField` for what was picked.
    expect(values).toEqual({ widget_id: "w-1", gizmo_id: "g-9" });
  });

  it("TC-ADMIN-076: the Link submit stays disabled until a far row is actually picked", async () => {
    const user = userEvent.setup();
    primeMocks(["widget_gizmo_link.create"]);

    renderPage(MANY_TO_MANY);
    await user.click(await screen.findByTestId("entity-relation-link"));

    expect(screen.getByTestId("entity-relation-link-submit")).toBeDisabled();
    expect(mockCreateLinkRow).not.toHaveBeenCalled();
  });

  // --- TC-ADMIN-077: the two gates are independent ------------------------------------------

  it("TC-ADMIN-077: no link action renders for a link entity whose schema declares no linkCreate", async () => {
    /**
     * The API-capability half of the gate, isolated. The actor holds a
     * plausible `widget_doodad_link.create` code and the tab still shows no
     * action, because the backend declared no route for it — which is exactly
     * what an older backend, or a junction nobody has written a route for yet,
     * serves. Asserted against the *sibling* tab in the same render so the
     * negative cannot be explained by the page failing to load.
     */
    primeMocks(["widget_doodad_link.create", "widget_gizmo_link.create"]);

    renderPage("?tab=widget-doodad-links");

    expect(await screen.findByText("No records found.")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-create")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-077: a successful link refetches the tab's own list", async () => {
    /**
     * Without the invalidation the row is written and the table still shows
     * the pre-link result set, which reads exactly like the write having
     * failed — the same "create-only assertion proves nothing about the read"
     * gap the backend tests guard from the other side.
     */
    const user = userEvent.setup();
    primeMocks(["widget_gizmo_link.create"]);

    renderPage(MANY_TO_MANY);
    await user.click(await screen.findByTestId("entity-relation-link"));

    const callsBefore = mockListEntities.mock.calls.filter(
      (call) => (call[0] as EntityConfig).path === "/widget-gizmo-links",
    ).length;

    await user.type(await screen.findByLabelText("Gizmos", { exact: true }), "Ninth");
    await user.click(await screen.findByText("Ninth gizmo"));
    await user.click(screen.getByTestId("entity-relation-link-submit"));

    await waitFor(() => {
      const callsAfter = mockListEntities.mock.calls.filter(
        (call) => (call[0] as EntityConfig).path === "/widget-gizmo-links",
      ).length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });
});

// --- TC-ADMIN-077: the picker's scoping rule, as a pure function -----------------------------

describe("pickerScopeParams (ADR-0073 Decision §5)", () => {
  const base = { resource: "x", path: "/xs", methods: [], fields: [] } as unknown as EntityConfig;

  it("case 1: an unscoped far entity searches with no params", () => {
    expect(pickerScopeParams(base, "p-1")).toEqual({});
  });

  it("case 2: a project-scoped far entity takes project_id from the route", () => {
    const config = { ...base, scopeField: "project_id" } as EntityConfig;
    expect(pickerScopeParams(config, "p-1")).toEqual({ project_id: "p-1" });
  });

  it("case 3: a differently-scoped far entity with a selector defers to the ScopeSelector step", () => {
    /**
     * `null` is the signal the caller renders `ScopeSelector` first — this is
     * `TestCondition` (scoped by `requirement_id`) and `Defect` (by
     * `test_execution_id`), the two live cases that are not `project_id`.
     */
    const config = {
      ...base,
      scopeField: "requirement_id",
      scopeSelector: { refEntity: "requirement", paramName: "requirement_id" },
    } as EntityConfig;
    expect(pickerScopeParams(config, "p-1")).toBeNull();
  });

  it("case 2 falls through to case 3 when the route carries no projectId", () => {
    /**
     * An org-scoped admin route (`/orgs/:orgId/admin/...`) has no project in
     * context at all. Supplying nothing would 422 the far entity's list, so
     * the selector step is correct there too — asserted because "scopeField is
     * project_id" alone looks sufficient and isn't.
     */
    const config = {
      ...base,
      scopeField: "project_id",
      scopeSelector: { refEntity: "project", paramName: "project_id" },
    } as EntityConfig;
    expect(pickerScopeParams(config, undefined)).toBeNull();
  });

  it("a differently-scoped far entity with NO selector searches unscoped rather than deadlocking", () => {
    /**
     * Degrades to an empty-looking search instead of a modal with no picker in
     * it at all — there is no such entity today, and a blank result set is a
     * better failure than a dead modal if one ever appears.
     */
    const config = { ...base, scopeField: "requirement_id" } as EntityConfig;
    expect(pickerScopeParams(config, "p-1")).toEqual({});
  });
});
