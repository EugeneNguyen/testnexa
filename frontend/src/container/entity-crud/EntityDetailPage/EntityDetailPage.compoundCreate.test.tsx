import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityDetailPage from "./EntityDetailPage";
import { compoundParentField, compoundParentScopeParams, scopeArmsOf } from "./EntityRelationTab";
import type {
  CompoundCreateAction,
  EntityConfig,
  EntityRelation,
} from "../../../entityConfigs/types";
import { ApiError, apiFetch } from "../../../lib/api/client";
import {
  createEntity,
  createLinkRow,
  createViaCompoundRoute,
  getEntity,
  listEntities,
} from "../../../lib/api/entityCrud";

/**
 * ADR-0078 — "Create new <far entity>" when the far entity has **no generic
 * `create` at all** (TC-ADMIN-124 … TC-ADMIN-127).
 *
 * A sibling of `EntityDetailPage.relationActions.test.tsx` rather than an
 * addition to it, for that file's own stated reason: its claim is ADR-0076/0077's
 * ("which write action renders, gated twice, and what the two calls are"), and
 * the claim here is the one ADR-0078 adds — *which route makes the far record*,
 * and what changes when that route also writes this tab's link row. The harness
 * below is that file's, verbatim in shape (the same synthetic entity fixtures,
 * the same `useEntitySchema`/`entityCrud`/`apiFetch` mocks, the same
 * project-scoped route whose `:orgId` must resolve before any gate evaluates),
 * with four deltas — all of them new fixtures, none of them changes to the
 * existing ones:
 *
 * - `widget-thing-links` gains a `compoundCreates` entry whose `pathTemplate`
 *   placeholder **is** the tab's own `scopeField` and which
 *   `linksAutomatically` — the `Requirement` -> "Test conditions (linked)"
 *   shape (`trace.py`), the one-request case. TC-ADMIN-124.
 * - a new `widget-gadget-links` -> `gadgets` junction whose placeholder names a
 *   *different* record and which does **not** link automatically — the
 *   `TestCase` -> "Test conditions (linked)" / `TestCase` -> "Defects (linked)"
 *   shape, the parent-picker-then-two-calls case. TC-ADMIN-125.
 * - both declare a `permission` that is deliberately **not**
 *   `<far resource>.create` (`thing.author`/`gadget.author`), so a gate reading
 *   the conventional code instead of the declared one fails TC-ADMIN-126
 *   rather than passing by coincidence.
 * - a new `widget-cog-links` -> `cogs` junction where the far entity has a
 *   generic `create` **and** a `compoundCreates` entry is declared — the
 *   characterization case at the bottom of this file. See its own comment: the
 *   component does not behave the way ADR-0078's "generic wins" prose reads.
 *
 * `gizmos` (generic `create`, no `compoundCreates`) is kept exactly as the
 * sibling file has it, and is what the first regression test uses: the 9 of 12
 * live link directions ADR-0078 changes nothing about.
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
      "things",
      "widget-thing-links",
      "gadgets",
      "widget-gadget-links",
      "cogs",
      "widget-cog-links",
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
        /** Far entity HAS a generic `create` and the junction declares no compound action — the unchanged 9 of 12. */
        {
          kind: "many-to-many",
          entity: "widget-gizmo-links",
          scopeField: "widget_id",
          label: "Gizmos (linked)",
          targetEntity: "gizmos",
          targetField: "gizmo_id",
        },
        /** ADR-0078, case A: no generic create, parent IS the record being viewed, route links automatically. */
        {
          kind: "many-to-many",
          entity: "widget-thing-links",
          scopeField: "widget_id",
          label: "Things (linked)",
          targetEntity: "things",
          targetField: "thing_id",
        },
        /** ADR-0078, case B: no generic create, parent must be picked, route does NOT link this junction. */
        {
          kind: "many-to-many",
          entity: "widget-gadget-links",
          scopeField: "widget_id",
          label: "Gadgets (linked)",
          targetEntity: "gadgets",
          targetField: "gadget_id",
        },
        /**
         * The **pre-ADR-0078 state**, still reachable and still correct: no
         * generic create AND no compound declaration for this direction, i.e.
         * no create path at all. Its "Create new" must stay absent in EVERY
         * permission cell — the API-capability half of the gate, which no grant
         * can satisfy. Kept as a live fixture rather than assumed, because it
         * is what the three real directions looked like before this ADR and
         * what any future junction looks like on the day it ships.
         */
        {
          kind: "many-to-many",
          entity: "widget-doodad-links",
          scopeField: "widget_id",
          label: "Doodads (linked)",
          targetEntity: "doodads",
          targetField: "doodad_id",
        },
        /** The contradictory shape: generic create AND a compound declaration. See the characterization test. */
        {
          kind: "many-to-many",
          entity: "widget-cog-links",
          scopeField: "widget_id",
          label: "Cogs (linked)",
          targetEntity: "cogs",
          targetField: "cog_id",
        },
      ],
    },
    sprockets: {
      resource: "sprocket",
      path: "/sprockets",
      methods: ["list", "get", "create", "update", "delete"],
      /**
       * Scoped by the very column the `widget-gadget-links` tab is scoped by —
       * which is what makes `compoundParentScopeParams`' new first clause fire
       * for that tab's parent picker. The real instance of this is
       * `TestExecution`'s branching `("test_cycle_id", "test_case_id")` scope,
       * widened by ADR-0078 precisely so a `TestCase` tab can narrow the
       * execution picker to its own runs.
       */
      scopeField: "widget_id",
      fields: [
        { name: "name", label: "Name", type: "string", required: true },
        { name: "widget_id", label: "Widget", type: "fk", refEntity: "widget", labelField: "title" },
      ],
      relations: [],
    },
    /** Far entity of the unchanged direction: its own generic `create`, `project_id`-scoped. */
    gizmos: {
      resource: "gizmo",
      path: "/gizmos",
      methods: ["list", "get", "create"],
      scopeField: "project_id",
      fields: [
        { name: "project_id", label: "Project", type: "fk", refEntity: "project", labelField: "name" },
        { name: "name", label: "Name", type: "string", required: true },
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
      // deliberately NO `compoundCreates` — the far entity can be created generically.
    },
    /**
     * Authored only through a bespoke route: no generic `create`. `widget_id`
     * is a real field of it so the locked parent renders as a disabled display
     * field, exactly as `TestCondition.requirement_id` does.
     */
    things: {
      resource: "thing",
      path: "/things",
      methods: ["list", "get"],
      scopeField: "project_id",
      fields: [
        { name: "name", label: "Name", type: "string", required: true },
        { name: "widget_id", label: "Widget", type: "fk", refEntity: "widget", labelField: "title" },
      ],
      relations: [],
    },
    "widget-thing-links": {
      resource: "widget_thing_link",
      path: "/widget-thing-links",
      methods: ["list", "get"],
      fields: [
        { name: "widget_id", label: "Widget", type: "fk", refEntity: "widget", labelField: "title" },
        { name: "thing_id", label: "Thing", type: "fk", refEntity: "thing", labelField: "name" },
      ],
      relations: [],
      linkCreate: {
        pathTemplate: "/widgets/{widget_id}/thing-links/{thing_id}",
        permission: "widget_thing_link.create",
      },
      /**
       * ADR-0078's cleanest shape (`Requirement` -> test conditions): the
       * single placeholder names this tab's own `scopeField`, so no picker is
       * needed, and the route writes THIS junction's link row itself, so no
       * second call is owed. `permission` is NOT `thing.create` on purpose.
       */
      compoundCreates: [
        {
          farField: "thing_id",
          pathTemplate: "/widgets/{widget_id}/things",
          permission: "thing.author",
          linksAutomatically: true,
          parentEntity: null,
          parentLabel: null,
          parentLabelField: null,
          parentFilters: {},
        },
      ],
    },
    /** Also bespoke-only, and its parent is a record this tab does not hold. */
    gadgets: {
      resource: "gadget",
      path: "/gadgets",
      methods: ["list", "get"],
      scopeField: "sprocket_id",
      fields: [
        { name: "name", label: "Name", type: "string", required: true },
        /**
         * Labelled differently from the compound action's own `parentLabel`
         * ("Sprocket") deliberately: both controls are on screen at once once a
         * parent is picked — the picker above and this locked display below —
         * and identical labels would make every `getByLabelText` in this file's
         * TC-ADMIN-125 test a strict-mode failure rather than an assertion. The
         * real `Defect` action makes the same distinction for a different
         * reason (`parent_label_field="executed_at"`, not `result`).
         */
        { name: "sprocket_id", label: "Owning sprocket", type: "fk", refEntity: "sprocket", labelField: "name" },
      ],
      relations: [],
    },
    "widget-gadget-links": {
      resource: "widget_gadget_link",
      path: "/widget-gadget-links",
      methods: ["list", "get"],
      fields: [
        { name: "widget_id", label: "Widget", type: "fk", refEntity: "widget", labelField: "title" },
        { name: "gadget_id", label: "Gadget", type: "fk", refEntity: "gadget", labelField: "name" },
      ],
      relations: [],
      linkCreate: {
        pathTemplate: "/widgets/{widget_id}/gadget-links/{gadget_id}",
        permission: "widget_gadget_link.create",
      },
      compoundCreates: [
        {
          farField: "gadget_id",
          pathTemplate: "/sprockets/{sprocket_id}/gadgets",
          permission: "gadget.author",
          // The bespoke route links the gadget to its sprocket, NOT to this
          // widget — so the client still owes the identical `linkCreate` call
          // ADR-0076 Amendment 1 makes.
          linksAutomatically: false,
          parentEntity: "sprocket",
          parentLabel: "Sprocket",
          parentLabelField: "name",
          // The route's own business-rule precondition, invisible to the picker
          // — `{"result": "fail"}` in the live `Defect` declaration.
          parentFilters: { state: "ready" },
        },
      ],
    },
    /** Far entity WITH a generic create, on a junction that also declares a compound action. */
    cogs: {
      resource: "cog",
      path: "/cogs",
      methods: ["list", "get", "create"],
      fields: [{ name: "name", label: "Name", type: "string", required: true }],
      relations: [],
    },
    /** No generic create — and, unlike `things`/`gadgets`, nothing declared for it either. */
    doodads: {
      resource: "doodad",
      path: "/doodads",
      methods: ["list", "get"],
      fields: [{ name: "name", label: "Name", type: "string", required: true }],
      relations: [],
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
      linkCreate: {
        pathTemplate: "/widgets/{widget_id}/doodad-links/{doodad_id}",
        permission: "widget_doodad_link.create",
      },
      /** Deliberately empty — this is the shape ADR-0078 exists to eliminate, kept to prove the gate still closes on it. */
      compoundCreates: [],
    },
    "widget-cog-links": {
      resource: "widget_cog_link",
      path: "/widget-cog-links",
      methods: ["list", "get"],
      fields: [
        { name: "widget_id", label: "Widget", type: "fk", refEntity: "widget", labelField: "title" },
        { name: "cog_id", label: "Cog", type: "fk", refEntity: "cog", labelField: "name" },
      ],
      relations: [],
      linkCreate: {
        pathTemplate: "/widgets/{widget_id}/cog-links/{cog_id}",
        permission: "widget_cog_link.create",
      },
      compoundCreates: [
        {
          farField: "cog_id",
          pathTemplate: "/widgets/{widget_id}/cogs",
          permission: "cog.author",
          linksAutomatically: false,
          parentEntity: null,
          parentLabel: null,
          parentLabelField: null,
          parentFilters: {},
        },
      ],
    },
    /**
     * Not decoration: on a project-scoped admin route the URL carries no
     * `:orgId`, so `useAdminRouteContext` resolves it by fetching the Project —
     * and `usePermissions` is disabled until that lands. Omit this and every
     * gate silently reads `false`, which looks exactly like a broken gate.
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
  return {
    ...actual,
    getEntity: vi.fn(),
    listEntities: vi.fn(),
    createEntity: vi.fn(),
    createLinkRow: vi.fn(),
    // ADR-0078's new first call.
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
const mockCreateLinkRow = vi.mocked(createLinkRow);
const mockCreateViaCompoundRoute = vi.mocked(createViaCompoundRoute);
const mockApiFetch = vi.mocked(apiFetch);

const WIDGET_ROW = { id: "w-1", title: "First widget" };
const SPROCKET_ROW = { id: "s-1", name: "First sprocket", widget_id: "w-1" };
const GIZMO_ROW = { id: "g-9", name: "Ninth gizmo" };

/**
 * `codes` is what `usePermissions` reads. `project_id: null` is an org-wide
 * grant, which satisfies any project — the shape every seeded system role
 * actually produces.
 */
function primeMocks(codes: string[], items: Record<string, unknown>[] = []) {
  mockApiFetch.mockResolvedValue({ codes: codes.map((code) => ({ code, project_id: null })) });
  mockGetEntity.mockImplementation(async (config: EntityConfig, id: string) => {
    if (config.path === "/projects") {
      return { id, org_id: "org-1", name: "Project one" };
    }
    if (config.path === "/sprockets") {
      return SPROCKET_ROW;
    }
    return WIDGET_ROW;
  });
  mockListEntities.mockImplementation(async (config: EntityConfig) => {
    if (config.path === "/sprockets") {
      return { items: [SPROCKET_ROW], total: 1, page: 1, page_size: 25 };
    }
    if (config.path === "/gizmos") {
      return { items: [GIZMO_ROW], total: 1, page: 1, page_size: 25 };
    }
    return { items, total: items.length, page: 1, page_size: 25 };
  });
  mockCreateEntity.mockResolvedValue({ id: "new-1" });
  mockCreateLinkRow.mockResolvedValue({});
  mockCreateViaCompoundRoute.mockResolvedValue({ id: "new-compound-1" });
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

/** The `Requirement` -> "Test conditions (linked)" shape: no picker, one request. */
const AUTO_LINKING = "?tab=widget-thing-links";
/** The `TestCase` -> "Defects (linked)" shape: pick a parent, then two requests. */
const PICKER_TWO_CALL = "?tab=widget-gadget-links";

const THING_COMPOUND_CODE = "thing.author";
const THING_LINK_CODE = "widget_thing_link.create";
const GADGET_COMPOUND_CODE = "gadget.author";
const GADGET_LINK_CODE = "widget_gadget_link.create";
/** The direction with no create path at all — no generic `create`, no declaration. */
const NO_CREATE_PATH = "?tab=widget-doodad-links";
const DOODAD_LINK_CODE = "widget_doodad_link.create";

describe("EntityRelationTab compound create (ADR-0078)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    schemaState.isLoading = false;
  });

  // --- TC-ADMIN-124: no parent picker, the route links the row itself ------------------------

  it("TC-ADMIN-124: Create new renders even though the far entity has no generic create, with no parent picker", async () => {
    /**
     * The whole point of ADR-0078, stated as the one assertion ADR-0076
     * Amendment 1 could not make: `things` has no `"create"` in `methods`, so
     * Amendment 1's own condition 3 (`farConfig.methods.includes("create")`)
     * refused the action outright and this tab showed "Link existing" alone —
     * for exactly the entities whose authoring is least discoverable.
     * `createLinkMode` resolving to `"compound"` off the link entity's own
     * declaration is what makes the button appear.
     *
     * And no picker: the `pathTemplate`'s single placeholder (`widget_id`) IS
     * this tab's `relation.scopeField`, so the parent is the record being
     * viewed and there is nothing to ask. Asserted with the modal OPEN — the
     * `Modal` renders nothing at all when closed, so a closed-modal assertion
     * would be vacuously true.
     */
    const user = userEvent.setup();
    primeMocks([THING_COMPOUND_CODE, THING_LINK_CODE]);

    renderPage(AUTO_LINKING);

    const createLink = await screen.findByTestId("entity-relation-create-link");
    // Icon-only button — the accessible name lives in `aria-label`, and it names
    // the FAR entity, never the link table.
    expect(createLink).toHaveAccessibleName(/create new things/i);

    await user.click(createLink);

    // The form is there...
    expect(await screen.findByLabelText("Name", { exact: true })).toBeInTheDocument();
    // ...and the parent step is not, in either of its two rendered parts.
    // `FkAutocomplete` carries this as its element `id` (it has no test id of
    // its own), which is also what makes the label/input association work.
    expect(document.getElementById("entity-relation-compound-parent-picker")).toBeNull();
    expect(screen.queryByTestId("entity-relation-compound-parent-hint")).not.toBeInTheDocument();
    // The parent is locked into the form instead — the far entity's own FK
    // column, disabled, showing which record this is created under.
    expect(screen.getByLabelText("Widget", { exact: true })).toBeDisabled();
  });

  it("TC-ADMIN-124: submitting calls the bespoke route once and NEVER the generic create or the link route", async () => {
    /**
     * Three claims, and the third is the load-bearing one: with
     * `linksAutomatically: true` the route wrote this junction's link row inside
     * its own transaction, so a following `createLinkRow` would `409` on the
     * pair it just wrote. Its absence is the assertion — `createLinkMode` and
     * `createLinkNeedsLinkCall` are only correct together.
     */
    const user = userEvent.setup();
    primeMocks([THING_COMPOUND_CODE, THING_LINK_CODE]);
    mockCreateViaCompoundRoute.mockResolvedValue({ id: "t-new", name: "Freshly made thing" });

    renderPage(AUTO_LINKING);

    await user.click(await screen.findByTestId("entity-relation-create-link"));
    await user.type(await screen.findByLabelText("Name", { exact: true }), "Freshly made thing");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockCreateViaCompoundRoute).toHaveBeenCalledTimes(1));
    const [action, parentValues, body] = mockCreateViaCompoundRoute.mock.calls[0];
    // The served declaration, not a path this component built.
    expect(action).toMatchObject({
      farField: "thing_id",
      pathTemplate: "/widgets/{widget_id}/things",
      permission: THING_COMPOUND_CODE,
      linksAutomatically: true,
    });
    // Keyed by the template's own placeholder, valued by the record being
    // viewed — the tab holds it, so nothing was asked of the user.
    expect(parentValues).toEqual({ widget_id: "w-1" });
    expect(body).toMatchObject({ name: "Freshly made thing" });

    // Not the generic path...
    expect(mockCreateEntity).not.toHaveBeenCalled();
    // ...and NOT a second write. The route already linked it; calling
    // `linkCreate` here is the `409` ADR-0078 exists to avoid.
    expect(mockCreateLinkRow).not.toHaveBeenCalled();

    // Success closes the modal and leaves no "created, not linked" notice —
    // that state is unreachable on this path by construction.
    await waitFor(() => expect(screen.queryByLabelText("Name", { exact: true })).not.toBeInTheDocument());
    expect(screen.queryByTestId("entity-relation-create-link-error")).not.toBeInTheDocument();
  });

  // --- TC-ADMIN-125: parent picker, then the second call ------------------------------------

  it("TC-ADMIN-125: the parent picker gates the create form until a parent is chosen", async () => {
    /**
     * The form is *about* a record that does not exist yet, under a parent the
     * tab does not hold — so rendering it first would offer a submit that
     * cannot even be built into a URL. The hint is asserted as well as the
     * form's absence: silence and "choose a parent first" look identical to a
     * `queryBy*` and completely different to a user.
     */
    const user = userEvent.setup();
    primeMocks([GADGET_COMPOUND_CODE, GADGET_LINK_CODE]);

    renderPage(PICKER_TWO_CALL);

    await user.click(await screen.findByTestId("entity-relation-create-link"));

    const hint = await screen.findByTestId("entity-relation-compound-parent-hint");
    expect(hint).toHaveTextContent(/choose a sprocket first/i);
    expect(document.getElementById("entity-relation-compound-parent-picker")).not.toBeNull();
    // The far entity's own form has not rendered — `gadgets`' required `name`.
    expect(screen.queryByLabelText("Name", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create" })).not.toBeInTheDocument();

    // The picker's own scope, which is `compoundParentScopeParams`' new first
    // clause in rendered form: `sprockets` is scopeable by `widget_id`, the very
    // column this tab is scoped by, so it offers only THIS widget's sprockets —
    // plus the route's own declared `parentFilters`, which the picker cannot
    // otherwise see.
    await user.type(screen.getByLabelText("Sprocket", { exact: true }), "First");
    await waitFor(() =>
      expect(
        mockListEntities.mock.calls.some(
          ([config, , options]) =>
            (config as EntityConfig).path === "/sprockets" &&
            JSON.stringify((options as { params?: Record<string, string> })?.params) ===
              JSON.stringify({ widget_id: "w-1", state: "ready" }),
        ),
      ).toBe(true),
    );

    // Choosing one reveals the form. Re-queried fresh rather than reusing any
    // earlier reference — picking a parent re-renders this whole subtree.
    await user.click(await screen.findByText("First sprocket"));
    expect(await screen.findByLabelText("Name", { exact: true })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId("entity-relation-compound-parent-hint")).not.toBeInTheDocument(),
    );
  });

  it("TC-ADMIN-125: the PICKED parent is used, then the link call follows carrying the created id", async () => {
    /**
     * Four claims. The parent id is the one the user **picked** (`s-1`), not the
     * tab's own `parentId` (`w-1`) — a component reading `parentId` here would
     * file the new record under the wrong parent and still look completely
     * healthy. The second call is made at all (`linksAutomatically: false` — the
     * bespoke route linked the *sprocket*, not this junction). It carries the id
     * the FIRST call returned, keyed by the link row's own FK columns. And it
     * happens AFTER, which `invocationCallOrder` pins rather than inferring from
     * the fact that both ran.
     */
    const user = userEvent.setup();
    primeMocks([GADGET_COMPOUND_CODE, GADGET_LINK_CODE]);
    mockCreateViaCompoundRoute.mockResolvedValue({ id: "gad-new", name: "Fresh gadget" });

    renderPage(PICKER_TWO_CALL);

    await user.click(await screen.findByTestId("entity-relation-create-link"));
    await user.type(await screen.findByLabelText("Sprocket", { exact: true }), "First");
    await user.click(await screen.findByText("First sprocket"));

    // The picked parent is locked into the form too — the far entity's own FK
    // column, so the user can see what they are creating under.
    expect(await screen.findByLabelText("Owning sprocket", { exact: true })).toBeDisabled();

    await user.type(await screen.findByLabelText("Name", { exact: true }), "Fresh gadget");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockCreateViaCompoundRoute).toHaveBeenCalledTimes(1));
    const [action, parentValues, body] = mockCreateViaCompoundRoute.mock.calls[0];
    expect(action).toMatchObject({ pathTemplate: "/sprockets/{sprocket_id}/gadgets" });
    // `s-1` — the picked sprocket. NOT `w-1`, the record the tab is on.
    expect(parentValues).toEqual({ sprocket_id: "s-1" });
    expect(body).toMatchObject({ name: "Fresh gadget" });

    await waitFor(() => expect(mockCreateLinkRow).toHaveBeenCalledTimes(1));
    const [linkAction, linkValues] = mockCreateLinkRow.mock.calls[0];
    expect(linkAction).toMatchObject({
      pathTemplate: "/widgets/{widget_id}/gadget-links/{gadget_id}",
      permission: GADGET_LINK_CODE,
    });
    // The parent from the route, the far id from the FIRST call's response.
    expect(linkValues).toEqual({ widget_id: "w-1", gadget_id: "gad-new" });

    // Create strictly before link: the link route takes an id that has to exist.
    expect(mockCreateViaCompoundRoute.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateLinkRow.mock.invocationCallOrder[0],
    );
    // Still never the generic create — `gadgets` has no such route.
    expect(mockCreateEntity).not.toHaveBeenCalled();
  });

  it("TC-ADMIN-125: when the link half fails the modal closes and the created-not-linked alert appears", async () => {
    /**
     * The same partial state ADR-0076 Amendment 1 has, reached through
     * ADR-0078's first call instead of `createEntity` — which is exactly why
     * this path is shared rather than duplicated. Mirrors the sibling file's own
     * TC-ADMIN-098 assertions: label, id, the API's own reason verbatim, the
     * recovery, and the modal **gone**, so pressing Create again cannot mint a
     * second row for one intent.
     */
    const user = userEvent.setup();
    primeMocks([GADGET_COMPOUND_CODE, GADGET_LINK_CODE]);
    mockCreateViaCompoundRoute.mockResolvedValue({ id: "gad-new", name: "Fresh gadget" });
    mockCreateLinkRow.mockRejectedValue(
      new ApiError("This gadget belongs to a different project.", 422, { code: "validation_error" }),
    );

    renderPage(PICKER_TWO_CALL);

    await user.click(await screen.findByTestId("entity-relation-create-link"));
    await user.type(await screen.findByLabelText("Sprocket", { exact: true }), "First");
    await user.click(await screen.findByText("First sprocket"));
    await user.type(await screen.findByLabelText("Name", { exact: true }), "Fresh gadget");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const alert = await screen.findByTestId("entity-relation-create-link-error");
    expect(alert).toHaveTextContent("Fresh gadget");
    expect(alert).toHaveTextContent("gad-new");
    expect(alert).toHaveTextContent("This gadget belongs to a different project.");
    expect(alert).toHaveTextContent(/is NOT linked/);
    expect(alert).toHaveTextContent(/Link existing gadgets/);

    await waitFor(() => expect(screen.queryByLabelText("Name", { exact: true })).not.toBeInTheDocument());
    expect(mockCreateViaCompoundRoute).toHaveBeenCalledTimes(1);
  });

  // --- TC-ADMIN-126: the permission matrix for compound mode --------------------------------
  //
  // Four cells. The second is the single most surprising one and is the
  // deliberate relaxation ADR-0078 makes to ADR-0076 Amendment 1's rule — see
  // its own comment. Every cell uses the action's OWN declared `permission`
  // (`thing.author`/`gadget.author`), which is deliberately NOT
  // `<far resource>.create`, so a gate reading the conventional code fails here
  // instead of passing by coincidence.

  it("TC-ADMIN-126 (cell 1a): both the compound and link codes, linksAutomatically TRUE -> renders", async () => {
    primeMocks([THING_COMPOUND_CODE, THING_LINK_CODE]);

    renderPage(AUTO_LINKING);

    expect(await screen.findByTestId("entity-relation-create-link")).toBeInTheDocument();
    // Its sibling too — holding the link code means "Link existing" is
    // available, which is what makes this cell distinguishable from cell 2.
    expect(screen.getByTestId("entity-relation-link")).toBeInTheDocument();
  });

  it("TC-ADMIN-126 (cell 1b): both codes, linksAutomatically FALSE -> renders", async () => {
    primeMocks([GADGET_COMPOUND_CODE, GADGET_LINK_CODE]);

    renderPage(PICKER_TWO_CALL);

    expect(await screen.findByTestId("entity-relation-create-link")).toBeInTheDocument();
    expect(screen.getByTestId("entity-relation-link")).toBeInTheDocument();
  });

  it("TC-ADMIN-126 (cell 2): ONLY the compound code, linksAutomatically TRUE -> STILL renders", async () => {
    /**
     * The surprising cell, and the deliberate relaxation: ADR-0076 Amendment 1
     * gated "Create new" on the link permission **unconditionally**, and its
     * reason was specific — an actor who may create but may not link gets a
     * `201` then a `403`, stranding a real row this tab cannot display. When the
     * bespoke route does the linking itself there is no second call to be
     * refused, so requiring the link permission would hide a button for a
     * request that is never made: over-gating, not caution. The reason and the
     * condition move together, which is what `createLinkNeedsLinkCall` encodes.
     *
     * "Link existing" is correctly absent here for the ordinary reason (its own
     * code is missing) — which is also what proves this button rendered on its
     * own gate rather than riding along with its sibling.
     */
    primeMocks([THING_COMPOUND_CODE]);

    renderPage(AUTO_LINKING);

    expect(await screen.findByTestId("entity-relation-create-link")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-link")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-126 (cell 3): ONLY the compound code, linksAutomatically FALSE -> absent", async () => {
    /**
     * The other half of the same relaxation, and the reason it is a relaxation
     * rather than a removal: this route links something else, so the client
     * still owes a second, separately-gated call — ADR-0076 Amendment 1's
     * original reasoning applies unchanged and the button must not render.
     */
    primeMocks([GADGET_COMPOUND_CODE]);

    renderPage(PICKER_TWO_CALL);

    // Anchored on the tab's own table having rendered, so this is "the button
    // never appeared", not "the page had not finished loading".
    expect(await screen.findByText("No records found.")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-create-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-link")).not.toBeInTheDocument();
    // The whole strip is gone, not an empty strip reserving vertical space.
    expect(screen.queryByTestId("entity-relation-actions")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-126 (cell 4): neither code -> absent", async () => {
    primeMocks(["thing.read", "widget_thing_link.read"]);

    renderPage(AUTO_LINKING);

    expect(await screen.findByText("No records found.")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-create-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-actions")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-126: the conventional `<far resource>.create` code does NOT unlock the compound action", async () => {
    /**
     * The gate reads the declaration's own `permission`, never a
     * `${resource}.create` convention — which is the whole reason it is
     * declared. This actor holds `thing.create` (plausible, conventional, and
     * wrong) plus the link code, so nothing else can explain the absence.
     */
    primeMocks(["thing.create", THING_LINK_CODE]);

    renderPage(AUTO_LINKING);

    // The link action IS present, so the tab definitely rendered and the
    // absence below is not vacuous.
    expect(await screen.findByTestId("entity-relation-link")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-create-link")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-126 (link-only): the link code alone hides the compound action on BOTH directions", async () => {
    /**
     * The mirror of cell 2, and the reason the matrix is a *cross* rather than
     * a list. Cell 2 shows that dropping the LINK code can still leave the
     * button visible (when no link call is owed); this shows that dropping the
     * CREATE code never can, whatever `linksAutomatically` says — there is no
     * arrangement of the flag under which a create happens without the
     * permission its own route gates on.
     *
     * Asserted on both directions in one test on purpose: the claim is that the
     * answer does NOT vary with `linksAutomatically`, and two separate tests
     * would each be free to pass for a different reason.
     */
    primeMocks([THING_LINK_CODE]);
    const autoLinking = renderPage(AUTO_LINKING);
    // "Link existing" IS present, so the absence below is not a page that
    // simply never rendered.
    expect(await screen.findByTestId("entity-relation-link")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-create-link")).not.toBeInTheDocument();
    autoLinking.unmount();

    primeMocks([GADGET_LINK_CODE]);
    renderPage(PICKER_TWO_CALL);
    expect(await screen.findByTestId("entity-relation-link")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-create-link")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-126 (no create path): a direction with neither mechanism hides Create new in EVERY cell", async () => {
    /**
     * The API-capability half of the double gate, independent of permissions —
     * and the state all three real directions were in before ADR-0078.
     * `doodads` has no generic `create` and `widget-doodad-links` declares no
     * `compoundCreates` entry, so `createLinkMode` is `null` and no grant can
     * open it.
     *
     * Run across all four permission cells rather than one: a single-cell
     * assertion would be satisfied by the permission gate closing, which is a
     * different reason for the same observable outcome. Holding *every* code
     * and still seeing nothing is what isolates the capability gate.
     */
    const cells: Array<[string, string[]]> = [
      ["every code", ["doodad.author", "doodad.create", DOODAD_LINK_CODE]],
      ["far-create code only", ["doodad.create"]],
      ["link code only", [DOODAD_LINK_CODE]],
      ["neither", ["doodad.read"]],
    ];
    for (const [label, codes] of cells) {
      primeMocks(codes);
      const view = renderPage(NO_CREATE_PATH);
      await screen.findByText("No records found.");
      expect(
        screen.queryByTestId("entity-relation-create-link"),
        `"Create new" must stay absent with ${label}: this direction has no create path at all`,
      ).not.toBeInTheDocument();
      view.unmount();
    }
  });

  // --- Regression: the 9 directions whose far entity HAS a generic create -------------------

  it("a far entity with its own generic create still takes the generic path, untouched by ADR-0078", async () => {
    /**
     * `gizmos` registers `create` and `widget-gizmo-links` declares no
     * `compoundCreates` — the shape 9 of the 12 live link directions have, and
     * the one ADR-0078 changes nothing about. `createEntity` runs,
     * `createViaCompoundRoute` never does, and the second call is still owed.
     */
    const user = userEvent.setup();
    primeMocks(["widget_gizmo_link.create", "gizmo.create"]);
    mockCreateEntity.mockResolvedValue({ id: "g-new", name: "Freshly made gizmo" });

    renderPage("?tab=widget-gizmo-links");

    await user.click(await screen.findByTestId("entity-relation-create-link"));
    await user.type(await screen.findByLabelText("Name", { exact: true }), "Freshly made gizmo");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockCreateEntity).toHaveBeenCalledTimes(1));
    expect((mockCreateEntity.mock.calls[0][0] as EntityConfig).path).toBe("/gizmos");
    expect(mockCreateViaCompoundRoute).not.toHaveBeenCalled();

    await waitFor(() => expect(mockCreateLinkRow).toHaveBeenCalledTimes(1));
    expect(mockCreateLinkRow.mock.calls[0][1]).toEqual({ widget_id: "w-1", gizmo_id: "g-new" });
  });

  it("a generic create WINS over a compound declaration, and every gate agrees with the call", async () => {
    /**
     * **This test was written as a CHARACTERIZATION of a real defect, then
     * inverted when the defect was fixed — the sequence `docs/CLAUDE.md`
     * prescribes, kept rather than deleted because the inverted assertion is
     * the only thing that stops the bug returning.**
     *
     * As first written, `EntityRelationTab` branched its mutation body on
     * `compoundCreate` being truthy rather than on `createLinkMode`:
     *
     *     const created = compoundCreate ? await createViaCompoundRoute(...) : await createEntity(...)
     *
     * while `canCreateAndLink`, `createLinkPermission` and
     * `createLinkFormLockedValues` all branched on `createLinkMode`, which
     * prefers `"generic"`. So for a junction whose far entity HAS a generic
     * `create` and which ALSO declares a `compoundCreates` entry for this
     * direction, the button was permission-gated and locked-value-filled for
     * the generic path while the request actually sent was the bespoke compound
     * one. The two halves disagreed — not about which path is *better*, but
     * about which one was happening.
     *
     * The fix is one derivation, `activeCompoundCreate`, which every downstream
     * consumer reads instead of `compoundCreate`: a declaration is a *fallback*,
     * so it is `undefined` whenever the far entity can be created generically.
     * Gate, locked values, parent picker and request now cannot disagree,
     * because there is only one value to disagree about.
     *
     * Still not reachable from any live configuration — all three real
     * `compound_creates` declarations (`trace.py`) point at `TestCondition`/
     * `Defect`, neither of which has a generic `create`, and the backend's own
     * `test_no_declaration_is_dead_code` fails a declaration for a direction
     * that would not need one. That is precisely why it needs a test here:
     * "unreachable because another layer forbids it" is not the same as
     * "cannot be expressed here", and a client that silently disagrees with
     * itself the first time it is would be very hard to diagnose.
     */
    const user = userEvent.setup();
    primeMocks(["widget_cog_link.create", "cog.create"]);
    mockCreateEntity.mockResolvedValue({ id: "c-new", name: "Fresh cog" });

    renderPage("?tab=widget-cog-links");

    /**
     * The button renders off the GENERIC gate — this actor holds `cog.create`,
     * the conventional code, and NOT the declaration's own `cog.author`. That
     * it renders at all is the first half of the agreement being asserted.
     */
    await user.click(await screen.findByTestId("entity-relation-create-link"));
    // And no parent picker, even though the declaration carries picker
    // metadata: the declaration is not in effect, so neither is its UI step.
    expect(screen.queryByTestId("entity-relation-compound-parent-hint")).not.toBeInTheDocument();
    await user.type(await screen.findByLabelText("Name", { exact: true }), "Fresh cog");
    await user.click(screen.getByRole("button", { name: "Create" }));

    // ...and the GENERIC route is what gets called — the second half.
    await waitFor(() => expect(mockCreateEntity).toHaveBeenCalledTimes(1));
    expect((mockCreateEntity.mock.calls[0][0] as EntityConfig).path).toBe("/cogs");
    expect(mockCreateViaCompoundRoute).not.toHaveBeenCalled();
    // The link call is still owed, consistent with `createLinkMode === "generic"`.
    await waitFor(() => expect(mockCreateLinkRow).toHaveBeenCalledTimes(1));
    expect(mockCreateLinkRow.mock.calls[0][1]).toEqual({ widget_id: "w-1", cog_id: "c-new" });
  });
});

// --- TC-ADMIN-127: the three exported helpers, as pure functions ---------------------------
//
// Unit-tested directly rather than through rendered modals, for the same reason
// `pickerScopeParams`' own tests are: these three ARE the whole of ADR-0078's
// derivation rule (which parent, from where, scoped how), and pinning each
// branch through a render would cost several modals per clause and prove less.

describe("scopeArmsOf (ADR-0078)", () => {
  const base = { resource: "x", path: "/xs", methods: [], fields: [] } as unknown as EntityConfig;

  it("a string scopeField yields one arm", () => {
    expect(scopeArmsOf({ ...base, scopeField: "project_id" } as EntityConfig)).toEqual(["project_id"]);
  });

  it("a branching pair yields both arms", () => {
    /**
     * The case a strict `scopeField === "project_id"` silently answers *no* to,
     * which is why this exists at all — `TestExecution`'s own pair since
     * ADR-0078 is what makes `TestCase` -> "Defects (linked)" scopeable.
     */
    expect(
      scopeArmsOf({ ...base, scopeField: ["test_cycle_id", "test_case_id"] } as EntityConfig),
    ).toEqual(["test_cycle_id", "test_case_id"]);
  });

  it("an unscoped entity yields no arms", () => {
    expect(scopeArmsOf(base)).toEqual([]);
  });
});

describe("compoundParentField (ADR-0078)", () => {
  function action(pathTemplate: string): CompoundCreateAction {
    return {
      farField: "far_id",
      pathTemplate,
      permission: "far.create",
      linksAutomatically: false,
      parentEntity: null,
      parentLabel: null,
      parentLabelField: null,
      parentFilters: {},
    };
  }

  it("exactly one placeholder yields its name", () => {
    expect(compoundParentField(action("/requirements/{requirement_id}/test-conditions"))).toBe(
      "requirement_id",
    );
    expect(compoundParentField(action("/executions/{test_execution_id}/defects"))).toBe(
      "test_execution_id",
    );
  });

  it("zero placeholders yields null rather than throwing", () => {
    /**
     * A malformed declaration is a bug, not a runtime condition — but it must
     * fail **closed** (the action is simply not offered) rather than take down a
     * tab that renders fine otherwise. `createLinkMode` reads `null` here and
     * resolves to `null` itself.
     */
    expect(compoundParentField(action("/test-conditions"))).toBeNull();
  });

  it("two placeholders yields null rather than guessing which is the parent", () => {
    expect(compoundParentField(action("/widgets/{widget_id}/gadgets/{gadget_id}/cogs"))).toBeNull();
  });
});

describe("compoundParentScopeParams (ADR-0078)", () => {
  const base = { resource: "x", path: "/xs", methods: [], fields: [] } as unknown as EntityConfig;
  const relation: EntityRelation = {
    kind: "many-to-many",
    entity: "test-case-defect-links",
    scopeField: "test_case_id",
    label: "Defects (linked)",
    targetEntity: "defects",
    targetField: "defect_id",
  };

  it("the new clause: a parent scopeable by THIS tab's own scope column is scoped by the record being viewed", () => {
    /**
     * The clause that makes `TestCase` -> "Defects (linked)" correct rather than
     * merely present: `POST /executions/{id}/defects` files the defect against
     * `execution.test_case_id`, so an unnarrowed execution picker would let the
     * user create a row that lands on a different test case and never appears in
     * the tab they created it from. Asserted against the branching pair, since
     * that is the live shape and a single-string comparison would miss it.
     */
    const parentConfig = {
      ...base,
      scopeField: ["test_cycle_id", "test_case_id"],
    } as EntityConfig;
    expect(compoundParentScopeParams(parentConfig, relation, "tc-1", "p-1")).toEqual({
      test_case_id: "tc-1",
    });
  });

  it("falls through to pickerScopeParams: a project-scoped parent takes project_id from the route", () => {
    const parentConfig = { ...base, scopeField: "project_id" } as EntityConfig;
    expect(compoundParentScopeParams(parentConfig, relation, "tc-1", "p-1")).toEqual({
      project_id: "p-1",
    });
  });

  it("falls through to null: a parent needing a scope it cannot get, with a selector, defers to the ScopeSelector step", () => {
    /**
     * `null` is the signal the caller renders `ScopeSelector` inside the modal
     * first — the same two-stage shape the "Link existing" picker uses, reused
     * one level up rather than reinvented.
     */
    const parentConfig = {
      ...base,
      scopeField: "requirement_id",
      scopeSelector: { refEntity: "requirement", paramName: "requirement_id" },
    } as EntityConfig;
    expect(compoundParentScopeParams(parentConfig, relation, "tc-1", "p-1")).toBeNull();
  });
});
