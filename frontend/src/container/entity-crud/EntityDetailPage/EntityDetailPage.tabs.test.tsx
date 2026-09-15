import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityDetailPage from "./EntityDetailPage";
import { apiFetch } from "../../../lib/api/client";
import { getEntity, listEntities } from "../../../lib/api/entityCrud";

/**
 * ADR-0074 — relationship tabs on the generic detail page.
 *
 * Same mocking shape as `EntityDetailPage.test.tsx` (config via
 * `useEntitySchema`, permissions via `apiFetch`, the record via `getEntity`),
 * plus `listEntities` for the relationship tabs' own list requests.
 *
 * The fixtures are deliberately synthetic and mirror the *shapes* the real
 * derivation produces rather than naming real entities, because the claim
 * under test is that the component is driven by `config.relations` alone:
 *
 * - `widgets` — one one-to-many relation (`sprockets`, a plain child) and one
 *   many-to-many relation (`widget-gizmo-links`, a link table whose far side
 *   is `gizmos`). This is the `Requirement`/`TestCase` shape.
 * - `gadgets` — no relations at all, so no tab strip should render.
 *
 * `widgets` also has an `owner_id` fk pointing at a *parent* — a many-to-one —
 * which must produce no tab. That is the exclusion the whole design rests on.
 */
const schemaState = vi.hoisted(() => ({ isLoading: false }));

vi.mock("../../../pages/admin/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../pages/admin/registry")>();
  return {
    ...actual,
    entityLabelByKey: { widgets: "Widgets", gadgets: "Gadgets" },
    ADMIN_ENTITY_KEYS: new Set([
      "widgets",
      "gadgets",
      "sprockets",
      "gizmos",
      "widget-gizmo-links",
      "widget-owners",
    ]),
  };
});

vi.mock("../../../pages/admin/useEntitySchema", () => {
  const configs: Record<string, unknown> = {
    widgets: {
      resource: "widget",
      path: "/widgets",
      methods: ["list", "get", "update", "delete"],
      fields: [
        { name: "title", label: "Title", type: "string", required: true },
        { name: "owner_id", label: "Owner", type: "fk", refEntity: "widget-owner", labelField: "name" },
      ],
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
      ],
    },
    gadgets: {
      resource: "gadget",
      path: "/gadgets",
      methods: ["list", "get"],
      fields: [{ name: "name", label: "Name", type: "string", required: true }],
      relations: [],
    },
    sprockets: {
      resource: "sprocket",
      path: "/sprockets",
      methods: ["list", "get", "update", "delete"],
      fields: [
        { name: "name", label: "Name", type: "string" },
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
    },
    gizmos: {
      resource: "gizmo",
      path: "/gizmos",
      methods: ["list", "get"],
      fields: [{ name: "name", label: "Name", type: "string" }],
      relations: [],
    },
    "widget-owners": {
      resource: "widget_owner",
      path: "/widget-owners",
      methods: ["list", "get"],
      fields: [{ name: "name", label: "Name", type: "string" }],
      relations: [],
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
  return { ...actual, getEntity: vi.fn(), listEntities: vi.fn() };
});

vi.mock("../../../lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockGetEntity = vi.mocked(getEntity);
const mockListEntities = vi.mocked(listEntities);
const mockApiFetch = vi.mocked(apiFetch);

const WIDGET_ROW = { id: "w-1", title: "First widget", owner_id: "o-1" };

let lastLocation = "";

function LocationProbe() {
  const location = useLocation();
  lastLocation = `${location.pathname}${location.search}`;
  return null;
}

function renderPage(entity: "widgets" | "gadgets" = "widgets", search = "") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/orgs/org-1/admin/${entity}/w-1${search}`]}>
        <LocationProbe />
        <Routes>
          <Route path="/orgs/:orgId/admin/:entity/:id" element={<EntityDetailPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Default happy-path mocks: permissions, the record, and empty related lists. */
function primeMocks(items: Record<string, unknown>[] = []) {
  mockApiFetch.mockResolvedValue({ codes: [] });
  mockGetEntity.mockImplementation(async (config: { path: string }, id: string) =>
    config.path === "/widget-owners" ? { id, name: "Ada Owner" } : WIDGET_ROW,
  );
  mockListEntities.mockResolvedValue({ items, total: items.length, page: 1, page_size: 25 });
}

describe("EntityDetailPage relationship tabs (ADR-0074)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    schemaState.isLoading = false;
    lastLocation = "";
  });

  /**
   * TC-ADMIN-065: Info is the first tab and is the one shown on arrival, with
   * the all-fields view ADR-0073 shipped still rendered underneath it.
   */
  it("TC-ADMIN-065: opens on an Info tab that is first in the strip and renders the all-fields view", async () => {
    primeMocks();

    renderPage();

    expect(await screen.findByTestId("entity-detail-field-title")).toHaveTextContent("First widget");

    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveTextContent("Info");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    // The Info panel is ADR-0073's field list, unchanged.
    expect(screen.getByTestId("entity-detail-fields")).toBeInTheDocument();
    // No relationship list request fires until a relationship tab is opened.
    expect(mockListEntities).not.toHaveBeenCalled();
  });

  /**
   * TC-ADMIN-065 (negative half): an entity the backend reports no
   * relationships for renders no tab strip at all — the page is byte-for-byte
   * the pre-ADR-0074 one.
   */
  it("TC-ADMIN-065: renders no tab strip for an entity with no relationships", async () => {
    primeMocks();

    renderPage("gadgets");

    await waitFor(() => expect(screen.getByTestId("entity-detail-fields")).toBeInTheDocument());
    expect(screen.queryByTestId("entity-detail-tablist")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  /**
   * TC-ADMIN-066: exactly one tab per served relationship, in the order
   * served, labelled by the relation's own label — and *no* tab for the
   * entity's own many-to-one fk (`owner_id` -> `widget-owners`), which is the
   * exclusion the design rests on.
   */
  it("TC-ADMIN-066: renders one tab per 1-n and n-n relation and none for a many-to-one fk", async () => {
    primeMocks();

    renderPage();
    await screen.findByTestId("entity-detail-field-title");

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Info",
      "Sprockets",
      "Gizmos (linked)",
    ]);

    // `widgets` declares an `owner_id` fk pointing at its parent...
    expect(screen.getByTestId("entity-detail-field-owner_id")).toBeInTheDocument();
    // ...which must not have become a tab.
    expect(screen.queryByTestId("entity-detail-tab-widget-owners")).not.toBeInTheDocument();
  });

  /**
   * TC-ADMIN-067: opening a relationship tab lists the related entity's rows
   * scoped to this record — the request carries `?{scopeField}={parentId}` —
   * and the scoping column is suppressed because it holds the same value on
   * every row.
   */
  it("TC-ADMIN-067: lists the related rows scoped by the parent id and hides the scoping column", async () => {
    const user = userEvent.setup();
    primeMocks([{ id: "s-1", name: "First sprocket", widget_id: "w-1" }]);

    renderPage();
    await screen.findByTestId("entity-detail-field-title");
    await user.click(screen.getByTestId("entity-detail-tab-sprockets"));

    await waitFor(() => expect(mockListEntities).toHaveBeenCalled());

    // The list request is scoped to this record, via the relation's own scopeField.
    const [config, , query] = mockListEntities.mock.calls[0];
    expect((config as { path: string }).path).toBe("/sprockets");
    expect((query as { params: Record<string, string> }).params).toEqual({ widget_id: "w-1" });

    // The related row renders...
    expect(await screen.findByText("First sprocket")).toBeInTheDocument();
    // ...with a "Name" column but no "Widget" column: `widget_id` is the
    // scoping field, identical on every row in this tab.
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toContain("Name");
    expect(headers).not.toContain("Widget");
  });

  /**
   * TC-ADMIN-068 (one-to-many half): the listed row *is* the record, so a row
   * click opens that row's own detail page under the current admin scope.
   */
  it("TC-ADMIN-068: a one-to-many row click opens the listed row's own detail page", async () => {
    const user = userEvent.setup();
    primeMocks([{ id: "s-1", name: "First sprocket", widget_id: "w-1" }]);

    renderPage();
    await screen.findByTestId("entity-detail-field-title");
    await user.click(screen.getByTestId("entity-detail-tab-sprockets"));
    await user.click(await screen.findByTestId("entity-table-row-s-1"));

    await waitFor(() => expect(lastLocation).toBe("/orgs/org-1/admin/sprockets/s-1"));
  });

  /**
   * TC-ADMIN-068 (many-to-many half): the listed row is an ADR-0005 link row,
   * which is bookkeeping — the click follows `targetField` to the *far*
   * record's id and opens that entity's detail page instead of the link's.
   */
  it("TC-ADMIN-068: a many-to-many row click follows targetField to the far entity's detail page", async () => {
    const user = userEvent.setup();
    primeMocks([{ id: "link-1", widget_id: "w-1", gizmo_id: "g-9" }]);

    renderPage();
    await screen.findByTestId("entity-detail-field-title");
    await user.click(screen.getByTestId("entity-detail-tab-widget-gizmo-links"));
    await user.click(await screen.findByTestId("entity-table-row-link-1"));

    // `gizmos/g-9`, NOT `widget-gizmo-links/link-1`.
    await waitFor(() => expect(lastLocation).toBe("/orgs/org-1/admin/gizmos/g-9"));
  });

  /**
   * TC-ADMIN-069: the active tab is in the URL, so a relationship tab is
   * shareable and survives a reload — arriving with `?tab=` opens it directly,
   * without an Info-tab render first.
   */
  it("TC-ADMIN-069: opens the tab named by ?tab= on arrival", async () => {
    primeMocks([{ id: "s-1", name: "First sprocket", widget_id: "w-1" }]);

    renderPage("widgets", "?tab=sprockets");

    expect(await screen.findByText("First sprocket")).toBeInTheDocument();
    expect(screen.getByTestId("entity-detail-tab-sprockets")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("entity-detail-tab-info")).toHaveAttribute("aria-selected", "false");
    // The Info panel is not rendered at the same time.
    expect(screen.queryByTestId("entity-detail-fields")).not.toBeInTheDocument();
  });

  /**
   * TC-ADMIN-069 (fallback half): a stale bookmark naming a relationship this
   * entity does not serve falls back to Info rather than rendering an empty
   * panel or erroring.
   */
  it("TC-ADMIN-069: falls back to Info for a ?tab= this entity does not serve", async () => {
    primeMocks();

    renderPage("widgets", "?tab=not-a-relation");

    expect(await screen.findByTestId("entity-detail-fields")).toBeInTheDocument();
    expect(screen.getByTestId("entity-detail-tab-info")).toHaveAttribute("aria-selected", "true");
    expect(mockListEntities).not.toHaveBeenCalled();
  });

  /**
   * TC-ADMIN-069 (write half): selecting a tab puts it in the URL, and
   * returning to Info removes the param rather than leaving `?tab=info`.
   */
  it("TC-ADMIN-069: writes the selected tab to ?tab= and clears it on returning to Info", async () => {
    const user = userEvent.setup();
    primeMocks();

    renderPage();
    await screen.findByTestId("entity-detail-field-title");

    await user.click(screen.getByTestId("entity-detail-tab-sprockets"));
    await waitFor(() => expect(lastLocation).toBe("/orgs/org-1/admin/widgets/w-1?tab=sprockets"));

    await user.click(screen.getByTestId("entity-detail-tab-info"));
    await waitFor(() => expect(lastLocation).toBe("/orgs/org-1/admin/widgets/w-1"));
  });

  /**
   * ADR-0074's Amendment — Tabler's documented "tabs in the card header"
   * markup, asserted structurally rather than by eye, because every class here
   * is load-bearing: `.tab-content > .tab-pane` is `display:none` in both
   * design systems' shipped CSS, so a pane that loses `active` renders an
   * invisible (but present, and therefore still query-able) panel.
   */
  it("mounts the tab strip as the card header and each panel as a .tab-pane in the card body", async () => {
    primeMocks();

    const { container } = renderPage();
    await screen.findByTestId("entity-detail-field-title");

    // The strip is the card header's own — and only — child.
    const tablist = screen.getByTestId("entity-detail-tablist");
    expect(tablist).toHaveClass("nav", "nav-tabs", "card-header-tabs");
    const header = tablist.parentElement!;
    expect(header).toHaveClass("card-header");
    expect(header.children).toHaveLength(1);

    // The panel is an active pane inside the card body's own `.tab-content`.
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveClass("tab-pane", "active", "show");
    expect(panel.parentElement).toHaveClass("card-body", "tab-content");

    // Header and body belong to the *same* card — one card spans every tab.
    const card = container.querySelector(".card")!;
    expect(card).toContainElement(header as HTMLElement);
    expect(card).toContainElement(panel);
    expect(container.querySelectorAll(".card")).toHaveLength(1);
  });

  /**
   * The a11y pair ADR-0074's Amendment completes: the active tab points at the
   * panel with `aria-controls`, and the panel points back with
   * `aria-labelledby`. Both ends move together when a tab is switched.
   */
  it("links the rendered panel and the active tab in both directions", async () => {
    const user = userEvent.setup();
    primeMocks();

    renderPage();
    await screen.findByTestId("entity-detail-field-title");

    const infoTab = screen.getByTestId("entity-detail-tab-info");
    const infoPanel = screen.getByRole("tabpanel");
    expect(infoTab).toHaveAttribute("aria-controls", infoPanel.id);
    expect(infoPanel).toHaveAttribute("aria-labelledby", infoTab.id);
    // The id as a *string*: React reuses the same panel element across a tab
    // switch and rewrites its attributes in place, so holding the node and
    // reading `.id` later would read the new value (`frontend/CLAUDE.md`'s
    // "don't hold a DOM reference across a state change" rule).
    const infoPanelId = infoPanel.id;

    await user.click(screen.getByTestId("entity-detail-tab-sprockets"));

    const sprocketsTab = screen.getByTestId("entity-detail-tab-sprockets");
    const sprocketsPanel = screen.getByRole("tabpanel");
    expect(sprocketsPanel.id).not.toBe(infoPanelId);
    expect(sprocketsTab).toHaveAttribute("aria-controls", sprocketsPanel.id);
    expect(sprocketsPanel).toHaveAttribute("aria-labelledby", sprocketsTab.id);
  });

  /**
   * The relationship pane renders `EntityTable` in `bare` mode, so the page's
   * one card isn't given a second card inside its own body — the visible
   * defect (a bordered, shadowed box around the table, titled with the tab's
   * own label) that moving the strip into the header would otherwise create.
   */
  it("renders a relationship tab's table inside the page's own card, not a nested one", async () => {
    const user = userEvent.setup();
    primeMocks([{ id: "s-1", name: "First sprocket", widget_id: "w-1" }]);

    const { container } = renderPage();
    await screen.findByTestId("entity-detail-field-title");
    await user.click(screen.getByTestId("entity-detail-tab-sprockets"));
    expect(await screen.findByText("First sprocket")).toBeInTheDocument();

    expect(container.querySelectorAll(".card")).toHaveLength(1);
    // ...and exactly one card header: the tab strip's.
    expect(container.querySelectorAll(".card-header")).toHaveLength(1);
    expect(screen.getByRole("tabpanel")).toContainElement(screen.getByRole("table"));
  });

  /**
   * The negative half: with no relationships there is no header to give the
   * strip, so the card carries none — and nothing renders `tab-content`/
   * `tab-pane`/`role="tabpanel"`, which would be a tabpanel with no tablist.
   */
  it("renders no card header and no tabpanel markup for an entity with no relationships", async () => {
    primeMocks();

    const { container } = renderPage("gadgets");
    await screen.findByTestId("entity-detail-fields");

    expect(container.querySelector(".card-header")).toBeNull();
    expect(container.querySelector(".tab-content")).toBeNull();
    expect(container.querySelector(".tab-pane")).toBeNull();
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
  });

  /**
   * The heading and Back/Edit moved out of the card header, because Tabler's
   * `.card-header-tabs` is `flex:1` with negative margins on all four sides
   * and paints over any sibling there. They must still be present on *every*
   * tab, not only Info — which is what putting them above the card buys.
   */
  it("keeps the heading and Back action above the card, on every tab", async () => {
    const user = userEvent.setup();
    primeMocks([{ id: "s-1", name: "First sprocket", widget_id: "w-1" }]);

    const { container } = renderPage();
    await screen.findByTestId("entity-detail-field-title");

    const card = container.querySelector(".card")!;
    const heading = screen.getByRole("heading", { name: "Widgets details" });
    expect(card).not.toContainElement(heading);
    expect(card).not.toContainElement(screen.getByTestId("entity-detail-back"));

    // Still there after switching to a relationship tab — under the old
    // markup the whole header lived in the Info panel and vanished with it.
    await user.click(screen.getByTestId("entity-detail-tab-sprockets"));
    expect(await screen.findByText("First sprocket")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Widgets details" })).toBeInTheDocument();
    expect(screen.getByTestId("entity-detail-back")).toBeInTheDocument();
  });

  /**
   * A relationship tab is read-only, matching the page it sits on: no Edit, no
   * Delete, no New. Every related record is fully editable on its own screen.
   */
  it("TC-ADMIN-067: renders relationship rows read-only, with no row actions", async () => {
    const user = userEvent.setup();
    primeMocks([{ id: "s-1", name: "First sprocket", widget_id: "w-1" }]);

    renderPage();
    await screen.findByTestId("entity-detail-field-title");
    await user.click(screen.getByTestId("entity-detail-tab-sprockets"));

    expect(await screen.findByText("First sprocket")).toBeInTheDocument();
    // `sprockets` declares update+delete, so an Actions column would appear if
    // this tab passed the handlers — it deliberately does not.
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).not.toContain("Actions");
  });
});
