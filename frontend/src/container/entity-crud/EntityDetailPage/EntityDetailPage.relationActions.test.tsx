import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityDetailPage from "./EntityDetailPage";
import { createdNotLinkedMessage, farRowDisplay, pickerScopeParams } from "./EntityRelationTab";
import type { EntityConfig } from "../../../entityConfigs/types";
import { ApiError, apiFetch } from "../../../lib/api/client";
import {
  createEntity,
  createLinkRow,
  deleteLinkRow,
  getEntity,
  listEntities,
} from "../../../lib/api/entityCrud";

/**
 * ADR-0076 — the relationship tabs' two write actions (TC-ADMIN-090,
 * TC-ADMIN-091, TC-ADMIN-092).
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
 *   from the route (case 2 of ADR-0076 Decision §5). `pickerScopeParams`'
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
      "things",
      "widget-thing-links",
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
        /**
         * ADR-0076 Amendment 1. A third many-to-many whose link entity DOES
         * declare a `linkCreate` but whose FAR entity registers no `create` —
         * the shape 3 of the 12 live link directions really have
         * (`TestCondition` and `Defect` are authored only through bespoke
         * routes, while their junctions have perfectly good link routes). It
         * exists to isolate the compound action's **API-capability** gate from
         * its permission gate: on this tab "Link existing" must render and
         * "Create new" must not, no matter what codes the actor holds. The
         * `widget-doodad-links` tab cannot make that distinction — it is
         * missing both halves at once.
         */
        {
          kind: "many-to-many",
          entity: "widget-thing-links",
          scopeField: "widget_id",
          label: "Things (linked)",
          targetEntity: "things",
          targetField: "thing_id",
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
      /**
       * ADR-0077. A **different permission code** from `linkCreate`'s, which
       * is the shape the four real ADR-0005 traceability links have
       * (`<link>.create` vs `<link>.delete`) — and the whole reason the two
       * actions are gated independently. A fixture reusing one code for both
       * would make every gating assertion below pass for the wrong reason.
       */
      linkDelete: {
        pathTemplate: "/widgets/{widget_id}/gizmo-links/{gizmo_id}",
        permission: "widget_gizmo_link.delete",
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
    "widget-thing-links": {
      resource: "widget_thing_link",
      path: "/widget-thing-links",
      methods: ["list", "get"],
      fields: [
        { name: "widget_id", label: "Widget", type: "fk", refEntity: "widget", labelField: "title" },
        { name: "thing_id", label: "Thing", type: "fk", refEntity: "thing", labelField: "name" },
      ],
      relations: [],
      // A real link route exists here — unlike `widget-doodad-links`.
      linkCreate: {
        pathTemplate: "/widgets/{widget_id}/thing-links/{thing_id}",
        permission: "widget_thing_link.create",
      },
      /**
       * ADR-0077: deliberately **no** `linkDelete`, which makes this the
       * pre-ADR-0077 shape — a junction that can be linked and not unlinked,
       * exactly what four of the six really were between the two ADRs. It is
       * what lets the unlink tests below isolate the *API-capability* half of
       * the gate: on this tab "Link existing" must render and Remove must not,
       * no matter which codes the actor holds. `widget-doodad-links` cannot
       * make that distinction (it is missing both keys at once), which is the
       * same reason that fixture could not isolate the create half.
       */
    },
    /** Authored only through a bespoke route: no generic `create`. */
    things: {
      resource: "thing",
      path: "/things",
      methods: ["list", "get"],
      scopeField: "project_id",
      fields: [{ name: "name", label: "Name", type: "string" }],
      relations: [],
    },
    /**
     * The far entity of the `widget-gizmo-links` tab. Registers `create` and
     * carries a `project_id` scope field (ADR-0076 Amendment 1's shape: the
     * far entity of 9 of the 12 live link directions is `project_id`-scoped
     * and factory-creatable, e.g. `TestCase`/`TestSuite`/`Requirement`), so
     * the compound "Create new ..." action has a real schema to render a form
     * from and a real scope to lock.
     */
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
  return {
    ...actual,
    getEntity: vi.fn(),
    listEntities: vi.fn(),
    createEntity: vi.fn(),
    createLinkRow: vi.fn(),
    // ADR-0077
    deleteLinkRow: vi.fn(),
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
const mockDeleteLinkRow = vi.mocked(deleteLinkRow);
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
    config.path === "/projects" ? { id, org_id: "org-1", name: "Project one" } : WIDGET_ROW,
  );
  mockListEntities.mockImplementation(async (config: EntityConfig) =>
    config.path === "/gizmos"
      ? { items: [GIZMO_ROW], total: 1, page: 1, page_size: 25 }
      : { items, total: items.length, page: 1, page_size: 25 },
  );
  mockCreateEntity.mockResolvedValue({ id: "new-1" });
  mockCreateLinkRow.mockResolvedValue({});
  mockDeleteLinkRow.mockResolvedValue(undefined);
}

/**
 * ADR-0077: one already-linked row on the `widget-gizmo-links` tab, so the
 * table has something to render a per-row Remove *in*. Its `gizmo_id` is the
 * far id the unlink route must be called with, and it is deliberately not
 * equal to its own `id` — a component reading the wrong one would otherwise
 * produce an identical request and the tests would not notice.
 */
const GIZMO_LINK_ROW = { id: "l-1", widget_id: "w-1", gizmo_id: "g-9" };

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

describe("EntityDetailPage relationship-tab write actions (ADR-0076)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    schemaState.isLoading = false;
  });

  // --- TC-ADMIN-090: the one-to-many "New" action ------------------------------------------

  it("TC-ADMIN-090: a one-to-many tab renders a New button when the actor holds the child's create code", async () => {
    primeMocks(["sprocket.create"]);

    renderPage(ONE_TO_MANY);

    // Icon-only button (CTO request, 2026-09-15) — the accessible name lives
    // in `aria-label`, not visible text content.
    expect(await screen.findByTestId("entity-relation-create")).toHaveAccessibleName(/new sprocket/i);
    // Exactly one action per tab — never the link action on a 1-n tab, which
    // has no far entity to pick.
    expect(screen.queryByTestId("entity-relation-link")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-097: while permissions are still loading, a placeholder renders instead of silently omitting the actions strip", async () => {
    /**
     * The bug this test pins (CTO-reported, 2026-09-15): `canCreateChild`
     * correctly fails closed while `permissions.isLoading` is true — but
     * nothing distinguished that from "permanently absent," so the whole
     * strip vanished for exactly as long as `GET .../permissions/mine` took,
     * then popped in. Whether a user noticed depended on React Query cache
     * warmth, which is what made it look like "sometimes shows, sometimes
     * doesn't" rather than a deterministic bug. A held (never-in-this-test
     * resolved) `apiFetch` promise reproduces the loading window on demand.
     */
    let resolvePermissions!: (value: { codes: never[] }) => void;
    mockApiFetch.mockReturnValue(new Promise((resolve) => (resolvePermissions = resolve)));
    mockGetEntity.mockImplementation(async (config: EntityConfig, id: string) =>
      config.path === "/projects" ? { id, org_id: "org-1", name: "Project one" } : WIDGET_ROW,
    );
    mockListEntities.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });

    renderPage(ONE_TO_MANY);

    expect(await screen.findByTestId("entity-relation-actions-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-actions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-create")).not.toBeInTheDocument();

    // Resolving with a genuinely held permission flips the placeholder to the
    // real strip — proving this is a loading state, not a second "hidden."
    resolvePermissions({ codes: [] });
    await waitFor(() => expect(screen.queryByTestId("entity-relation-actions-loading")).not.toBeInTheDocument());
  });

  it("TC-ADMIN-090: the New button is ABSENT, not disabled, without the create code", async () => {
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

  it("TC-ADMIN-090: the create modal locks the scope field and submits it with the parent's id", async () => {
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

  // --- TC-ADMIN-091: the many-to-many "Link existing" action --------------------------------

  it("TC-ADMIN-091: a many-to-many tab renders a Link button labelled by the FAR entity", async () => {
    primeMocks(["widget_gizmo_link.create"]);

    renderPage(MANY_TO_MANY);

    const button = await screen.findByTestId("entity-relation-link");
    // The tab is *about* the far entity (ADR-0074 §5) — `relation.label` minus
    // the `" (linked)"` suffix, never the link table's own name. Icon-only
    // button (CTO request, 2026-09-15) — accessible name, not text content.
    expect(button).toHaveAccessibleName(/link existing gizmos/i);
    expect(screen.queryByTestId("entity-relation-create")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-091: the Link button is absent without the code the backend declared", async () => {
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

  it("TC-ADMIN-091: picking a far row POSTs the declared route with both ids keyed by FK name", async () => {
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

  it("TC-ADMIN-091: the Link submit stays disabled until a far row is actually picked", async () => {
    const user = userEvent.setup();
    primeMocks(["widget_gizmo_link.create"]);

    renderPage(MANY_TO_MANY);
    await user.click(await screen.findByTestId("entity-relation-link"));

    expect(screen.getByTestId("entity-relation-link-submit")).toBeDisabled();
    expect(mockCreateLinkRow).not.toHaveBeenCalled();
  });

  // --- TC-ADMIN-092: the two gates are independent ------------------------------------------

  it("TC-ADMIN-092: no link action renders for a link entity whose schema declares no linkCreate", async () => {
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

  it("TC-ADMIN-092: a successful link refetches the tab's own list", async () => {
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

  // --- TC-ADMIN-096: both n-n actions render, and the permission matrix ----------------------
  //
  // ADR-0076 Amendment 1. The original rule was "exactly one action per tab";
  // an n-n tab now carries two, so the claim under test changes shape: it is
  // no longer "which one" but "which subset", and the subset is a function of
  // two independent permissions. All four cells are asserted, because three of
  // them are the ones a half-implemented gate gets wrong.

  const LINK_CODE = "widget_gizmo_link.create";
  const FAR_CREATE_CODE = "gizmo.create";

  it("TC-ADMIN-096: both Link existing and Create new render when the actor holds both codes", async () => {
    primeMocks([LINK_CODE, FAR_CREATE_CODE]);

    renderPage(MANY_TO_MANY);

    const link = await screen.findByTestId("entity-relation-link");
    const createLink = await screen.findByTestId("entity-relation-create-link");
    // Icon-only buttons (CTO request, 2026-09-15) — accessible name, not text.
    expect(link).toHaveAccessibleName(/link existing gizmos/i);
    // Labelled by the FAR entity, exactly like its sibling — never by the link
    // table, whose rows are not what the user is creating.
    expect(createLink).toHaveAccessibleName(/create new gizmos/i);
    // Still never the 1-n action: re-parenting an existing child is a
    // different, riskier operation this amendment does not add.
    expect(screen.queryByTestId("entity-relation-create")).not.toBeInTheDocument();
    // Side by side, in one strip — not two strips, and not in the card header.
    const strip = screen.getByTestId("entity-relation-actions");
    expect(strip).toContainElement(link);
    expect(strip).toContainElement(createLink);
  });

  it("TC-ADMIN-096: only Link existing renders when only the link code is held", async () => {
    primeMocks([LINK_CODE]);

    renderPage(MANY_TO_MANY);

    expect(await screen.findByTestId("entity-relation-link")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-create-link")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-096: NEITHER action renders when only the far entity's create code is held", async () => {
    /**
     * The fail-closed cell, and the one worth stating explicitly because the
     * intuitive expectation is "Create new renders on its own". It must not:
     * the compound action *ends* in the link request, so an actor holding
     * `gizmo.create` but not the link code would get a `201` followed by a
     * `403` and be left with a real, unlinked row this tab cannot even show —
     * precisely the orphan the two-permission gate exists to prevent. "Link
     * existing" is absent for the ordinary reason (its own code is missing).
     */
    primeMocks([FAR_CREATE_CODE]);

    renderPage(MANY_TO_MANY);

    expect(await screen.findByText("No records found.")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-create-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-link")).not.toBeInTheDocument();
    // The whole strip is gone, not an empty strip reserving vertical space.
    expect(screen.queryByTestId("entity-relation-actions")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-096: neither action renders when neither code is held", async () => {
    primeMocks(["widget_gizmo_link.read", "gizmo.read"]);

    renderPage(MANY_TO_MANY);

    expect(await screen.findByText("No records found.")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-create-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-actions")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-096: Create new is absent when the FAR entity has no generic create route, even though the link route exists", async () => {
    /**
     * The **API-capability** half of this action's own gate, genuinely
     * isolated from the permission half — which needs a tab where everything
     * else is satisfied. `widget-thing-links` declares a real `linkCreate`,
     * the actor holds that code *and* a plausible `thing.create`, and the only
     * missing ingredient is `things`' own `create` method. So "Link existing"
     * **renders** (proving the tab, the schema and the permissions are all
     * fine) while "Create new" does not.
     *
     * This is the shape 3 of the 12 live link directions really have —
     * `TestCondition` and `Defect` are authored only through bespoke routes,
     * while their junctions have perfectly good link routes — and it is the
     * cell the `widget-doodad-links` tab cannot test, because that one is
     * missing both halves at once and so proves nothing about which gate fired.
     */
    primeMocks(["widget_thing_link.create", "thing.create"]);

    renderPage("?tab=widget-thing-links");

    // Icon-only button (CTO request, 2026-09-15) — accessible name, not text.
    expect(await screen.findByTestId("entity-relation-link")).toHaveAccessibleName(/link existing things/i);
    expect(screen.queryByTestId("entity-relation-create-link")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-096: neither n-n action renders when the link entity declares no linkCreate at all", async () => {
    /**
     * The other end of the same conjunction, and the pre-amendment tab shape
     * TC-ADMIN-092 already pins for "Link existing": with no declared route,
     * the compound action has nothing to finish with either, so a plausible
     * `doodad.create` in hand changes nothing.
     */
    primeMocks(["doodad.create", "widget_doodad_link.create"]);

    renderPage("?tab=widget-doodad-links");

    expect(await screen.findByText("No records found.")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-create-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-link")).not.toBeInTheDocument();
  });

  // --- TC-ADMIN-097: the compound create-then-link success path ------------------------------

  it("TC-ADMIN-097: Create new runs the FAR entity's create, then links the new id, then refetches", async () => {
    /**
     * Four separate claims, because each can regress without the others
     * noticing: the form is backed by the **far** entity's schema (not the
     * link entity's, whose two FK columns are the whole row); the far entity's
     * own scope field is locked to the route's project rather than being the
     * user's to pick; the second call carries the id the *first* call returned,
     * keyed by the link row's own FK names; and the tab's list refetches, since
     * a write nobody can see reads exactly like a write that failed.
     */
    const user = userEvent.setup();
    primeMocks([LINK_CODE, FAR_CREATE_CODE]);
    mockCreateEntity.mockResolvedValue({ id: "g-new", name: "Freshly made gizmo" });

    renderPage(MANY_TO_MANY);

    const callsBefore = mockListEntities.mock.calls.filter(
      (call) => (call[0] as EntityConfig).path === "/widget-gizmo-links",
    ).length;

    await user.click(await screen.findByTestId("entity-relation-create-link"));

    // The far entity's scope, prefilled from the route and not editable.
    expect(await screen.findByLabelText("Project", { exact: true })).toBeDisabled();

    await user.type(await screen.findByLabelText("Name", { exact: true }), "Freshly made gizmo");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockCreateEntity).toHaveBeenCalledTimes(1));
    const [createConfig, , payload] = mockCreateEntity.mock.calls[0];
    expect((createConfig as EntityConfig).path).toBe("/gizmos");
    expect(payload).toMatchObject({ name: "Freshly made gizmo", project_id: "p-1" });

    await waitFor(() => expect(mockCreateLinkRow).toHaveBeenCalledTimes(1));
    const [action, values] = mockCreateLinkRow.mock.calls[0];
    expect(action).toMatchObject({ pathTemplate: "/widgets/{widget_id}/gizmo-links/{gizmo_id}" });
    expect(values).toEqual({ widget_id: "w-1", gizmo_id: "g-new" });

    // The modal closed on success, and the tab's own list refetched.
    await waitFor(() => expect(screen.queryByLabelText("Name", { exact: true })).not.toBeInTheDocument());
    await waitFor(() => {
      const callsAfter = mockListEntities.mock.calls.filter(
        (call) => (call[0] as EntityConfig).path === "/widget-gizmo-links",
      ).length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
    expect(screen.queryByTestId("entity-relation-create-link-error")).not.toBeInTheDocument();
  });

  // --- TC-ADMIN-098: created, but not linked -------------------------------------------------

  it("TC-ADMIN-098: when the link half fails, the created row is named back and the modal closes", async () => {
    /**
     * The partial state that has no transaction to prevent it. Asserted on
     * four things the user needs and one they must not get:
     *
     * - the created row's **label** and its **id** (so it can be found again
     *   by eye or by paste),
     * - the API's own **reason** verbatim, not a generic failure string,
     * - the **recovery** ("Link existing ..."), which now needs no form at all,
     * - and the modal is **gone**, so pressing Create again cannot mint a
     *   second row for one intent. `mockCreateEntity` is asserted to have run
     *   exactly once for the same reason.
     */
    const user = userEvent.setup();
    primeMocks([LINK_CODE, FAR_CREATE_CODE]);
    mockCreateEntity.mockResolvedValue({ id: "g-new", name: "Freshly made gizmo" });
    mockCreateLinkRow.mockRejectedValue(
      new ApiError("This gizmo belongs to a different project.", 422, { code: "validation_error" }),
    );

    renderPage(MANY_TO_MANY);

    await user.click(await screen.findByTestId("entity-relation-create-link"));
    await user.type(await screen.findByLabelText("Name", { exact: true }), "Freshly made gizmo");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const alert = await screen.findByTestId("entity-relation-create-link-error");
    expect(alert).toHaveTextContent("Freshly made gizmo");
    expect(alert).toHaveTextContent("g-new");
    expect(alert).toHaveTextContent("This gizmo belongs to a different project.");
    expect(alert).toHaveTextContent(/is NOT linked/);
    expect(alert).toHaveTextContent(/Link existing gizmos/);

    await waitFor(() => expect(screen.queryByLabelText("Name", { exact: true })).not.toBeInTheDocument());
    expect(mockCreateEntity).toHaveBeenCalledTimes(1);
  });

  it("TC-ADMIN-098: an ordinary create failure keeps the form open and never links", async () => {
    /**
     * The opposite handling, and the reason the two failures need separate
     * paths at all: nothing was written, so the form must stay open with the
     * user's input intact to be corrected — and no "created, not linked"
     * notice may appear, since nothing was created.
     */
    const user = userEvent.setup();
    primeMocks([LINK_CODE, FAR_CREATE_CODE]);
    mockCreateEntity.mockRejectedValue(new ApiError("Gizmo names must be unique.", 409, { code: "conflict" }));

    renderPage(MANY_TO_MANY);

    await user.click(await screen.findByTestId("entity-relation-create-link"));
    await user.type(await screen.findByLabelText("Name", { exact: true }), "Freshly made gizmo");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Gizmo names must be unique.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name", { exact: true })).toBeInTheDocument();
    expect(mockCreateLinkRow).not.toHaveBeenCalled();
    expect(screen.queryByTestId("entity-relation-create-link-error")).not.toBeInTheDocument();
  });

  // --- ADR-0077: the per-row "Remove" action ------------------------------------------------
  //
  // Kept in this file rather than a sibling because the harness above — four
  // synthetic relations, a fake permission endpoint, a project-scoped route
  // whose `:orgId` has to be resolved before any gate can evaluate — is
  // exactly what an unlink test needs too, and two copies of it would drift.
  // The claim is the same *kind* as this file's ("which write action renders,
  // gated twice"), just for the third one.

  it("TC-ADMIN-104: an n-n tab renders a per-row Remove when the actor holds the link-delete code", async () => {
    primeMocks(["widget_gizmo_link.delete"], [GIZMO_LINK_ROW]);

    renderPage(MANY_TO_MANY);

    // Icon-only, same as every other action here — the accessible name lives
    // in `aria-label`. "Remove", not "Delete": the gizmo survives.
    expect(await screen.findByTestId("entity-table-unlink")).toHaveAccessibleName("Remove");
    // The *create* actions are absent, because this actor holds neither write
    // code — which is what proves the Remove above rendered on its own gate
    // rather than riding along with the strip.
    expect(screen.queryByTestId("entity-relation-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("entity-relation-create-link")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-104: the Remove action is absent when the actor holds the link-create code but not link-delete", async () => {
    /**
     * The gate's whole point. `widget_gizmo_link.create` and
     * `widget_gizmo_link.delete` are different codes (as the four real
     * traceability links' are), and holding the first says nothing about the
     * second — `tester` is a live example of exactly this asymmetry on three
     * of the four links. Hidden, not disabled: UI Design Document §5.
     */
    primeMocks(["widget_gizmo_link.create"], [GIZMO_LINK_ROW]);

    renderPage(MANY_TO_MANY);

    // The link action IS present, so the tab definitely rendered and the row
    // definitely listed — without this the absence below would be vacuous.
    expect(await screen.findByTestId("entity-relation-link")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-table-unlink")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-104: the Remove action is absent when the junction declares no linkDelete, however permissioned the actor", async () => {
    /**
     * The API-capability half, isolated from the permission half.
     * `widget-thing-links` declares a `linkCreate` and no `linkDelete` — the
     * pre-ADR-0077 shape four of the six junctions really had. The actor here
     * is given *both* plausible codes, so nothing about permissions can
     * explain the absence.
     */
    primeMocks(["widget_thing_link.create", "widget_thing_link.delete"], [
      { id: "tl-1", widget_id: "w-1", thing_id: "t-3" },
    ]);

    renderPage("?tab=widget-thing-links");

    expect(await screen.findByTestId("entity-relation-link")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-table-unlink")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-104: a one-to-many tab never renders Remove, even for a fully-permissioned actor", async () => {
    /**
     * A 1-n tab's rows are *records*, not link rows — removing one would mean
     * deleting the child, a different and much larger action. Asserted with
     * every code this actor could plausibly hold, so the absence is
     * structural rather than a permission accident.
     */
    primeMocks(["sprocket.create", "sprocket.delete", "widget_gizmo_link.delete"], [
      { id: "s-1", name: "First sprocket", widget_id: "w-1" },
    ]);

    renderPage(ONE_TO_MANY);

    expect(await screen.findByTestId("entity-relation-create")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-table-unlink")).not.toBeInTheDocument();
  });

  it("TC-ADMIN-105: clicking Remove asks for confirmation and writes nothing until it is given", async () => {
    const user = userEvent.setup();
    primeMocks(["widget_gizmo_link.delete"], [GIZMO_LINK_ROW]);

    renderPage(MANY_TO_MANY);

    await user.click(await screen.findByTestId("entity-table-unlink"));

    // The confirm is open and explains what survives — the assertion that
    // matters about the wording, since "Remove" alone reads as a delete.
    expect(await screen.findByTestId("entity-relation-unlink-submit")).toBeInTheDocument();
    expect(screen.getByText(/the record it points to is not deleted/i)).toBeInTheDocument();
    // ...and nothing has been written. A Remove that deleted on the first
    // click and *then* showed a dialog would pass a test that only checked
    // the dialog appears.
    expect(mockDeleteLinkRow).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByTestId("entity-relation-unlink-submit")).not.toBeInTheDocument(),
    );
    expect(mockDeleteLinkRow).not.toHaveBeenCalled();
  });

  it("TC-ADMIN-105: confirming calls the declared route with both ids and refetches the tab", async () => {
    const user = userEvent.setup();
    primeMocks(["widget_gizmo_link.delete"], [GIZMO_LINK_ROW]);

    renderPage(MANY_TO_MANY);

    await user.click(await screen.findByTestId("entity-table-unlink"));
    const listCallsBefore = mockListEntities.mock.calls.length;
    await user.click(await screen.findByTestId("entity-relation-unlink-submit"));

    await waitFor(() => expect(mockDeleteLinkRow).toHaveBeenCalledTimes(1));
    expect(mockDeleteLinkRow).toHaveBeenCalledWith(
      // The *served* declaration, not a path this component built — the whole
      // point of `linkDelete`. Note the permission is the delete code, so a
      // component that reused `config.linkCreate` here would fail this.
      {
        pathTemplate: "/widgets/{widget_id}/gizmo-links/{gizmo_id}",
        permission: "widget_gizmo_link.delete",
      },
      // Keyed by the link row's own FK columns: the parent from the route,
      // the far id read off the row. `g-9`, not the link row's own `l-1`.
      { widget_id: "w-1", gizmo_id: "g-9" },
    );

    // And the tab re-lists: a `204` followed by a stale table is the bug a
    // response-only assertion cannot see.
    await waitFor(() => expect(mockListEntities.mock.calls.length).toBeGreaterThan(listCallsBefore));
    await waitFor(() =>
      expect(screen.queryByTestId("entity-relation-unlink-submit")).not.toBeInTheDocument(),
    );
  });

  it("TC-ADMIN-106: a failed unlink keeps the confirm open and shows the API's own reason", async () => {
    /**
     * The opposite handling from ADR-0076 Amendment 1's compound create, and
     * deliberately so: nothing was written here, so leaving the dialog open
     * makes the confirm button a **retry** rather than a second write. The
     * API's own message is rendered verbatim because the two realistic
     * failures say different things a user can act on — a `404` means someone
     * else already removed it, a `403` means they may not.
     */
    const user = userEvent.setup();
    primeMocks(["widget_gizmo_link.delete"], [GIZMO_LINK_ROW]);
    mockDeleteLinkRow.mockRejectedValue(
      new ApiError("This gizmo is not linked to this widget.", 404, { code: "not_found" }),
    );

    renderPage(MANY_TO_MANY);

    await user.click(await screen.findByTestId("entity-table-unlink"));
    await user.click(await screen.findByTestId("entity-relation-unlink-submit"));

    expect(await screen.findByTestId("entity-relation-unlink-error")).toHaveTextContent(
      "This gizmo is not linked to this widget.",
    );
    expect(screen.getByTestId("entity-relation-unlink-submit")).toBeInTheDocument();
  });
});

// --- TC-ADMIN-098: the "created, not linked" message and its label lookup, as pure functions ---

describe("createdNotLinkedMessage / farRowDisplay (ADR-0076 Amendment 1)", () => {
  it("the message carries the label, the id, the reason and the recovery", () => {
    const message = createdNotLinkedMessage(
      "Freshly made gizmo",
      "g-new",
      "This gizmo belongs to a different project.",
      "gizmos",
    );
    expect(message).toContain('"Freshly made gizmo"');
    expect(message).toContain("g-new");
    expect(message).toContain("This gizmo belongs to a different project.");
    expect(message).toContain("is NOT linked");
    expect(message).toContain('Link existing gizmos');
  });

  it("farRowDisplay prefers the link entity's declared labelField", () => {
    expect(farRowDisplay({ id: "g-1", name: "Ninth gizmo" }, "name")).toBe("Ninth gizmo");
  });

  it("farRowDisplay falls back to the id when the label field is absent or blank", () => {
    /**
     * A create response is not guaranteed to carry the far entity's label
     * field (a `*Summary` schema can omit it, and the link entity's
     * `labelField` is declared against the summary, not the create response).
     * Falling back to the id keeps the notice actionable rather than naming
     * `""` — which is why the id is reported alongside the label, not instead.
     */
    expect(farRowDisplay({ id: "g-1" }, "name")).toBe("g-1");
    expect(farRowDisplay({ id: "g-1", name: "   " }, "name")).toBe("g-1");
    expect(farRowDisplay({ id: "g-1", name: "Ninth gizmo" }, undefined)).toBe("g-1");
  });
});

// --- TC-ADMIN-092: the picker's scoping rule, as a pure function -----------------------------

describe("pickerScopeParams (ADR-0076 Decision §5)", () => {
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
