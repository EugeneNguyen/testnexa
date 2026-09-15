import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFkLabels } from "./useFkLabels";
import { getEntity } from "../../lib/api/entityCrud";
import { FieldConfig } from "../../entityConfigs/types";

/**
 * ADR-0074, Amendment 1 on [ADR-0073](../../../../docs/adr/0073-generic-entity-detail-page.md):
 * a regression guard on an unbounded fetch loop.
 *
 * `useFkLabels`' effect used to key on the `rows` **array identity**. Any
 * caller that built that array inline — `EntityDetailPage`'s
 * `row ? [row] : EMPTY_ROWS` did exactly this — got a fresh array on every
 * render, so the effect re-ran every render, and every run ended in
 * `setFkLabels(next)` with a fresh object, which re-rendered. Measured **2913
 * `getEntity` calls in 400ms** before the fix.
 *
 * **The reason this needs a dedicated test rather than being covered by the
 * page's own suite:** the rendered output is byte-for-byte identical whether
 * the effect runs once or forever. Every assertion about what the page *shows*
 * passes either way — which is precisely why ADR-0073's own unit tests and its
 * live manual verification both missed it. The only thing that can see this
 * defect is counting the requests, so that is what this file does.
 */
vi.mock("../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/entityCrud")>();
  return { ...actual, getEntity: vi.fn() };
});

vi.mock("./useEntitySchema", () => ({
  resolveEntityKey: (key: string) => (key.endsWith("s") ? key : `${key}s`),
  useEntitySchemas: () => ({
    "widget-owners": {
      resource: "widget_owner",
      path: "/widget-owners",
      methods: ["get"],
      fields: [],
    },
  }),
}));

const mockGetEntity = vi.mocked(getEntity);

const FK_FIELDS = [
  { name: "owner_id", label: "Owner", type: "fk", refEntity: "widget-owner", labelField: "name" },
] as FieldConfig[];

const ROW = { id: "w-1", owner_id: "o-1" };

/** Rebuilds `rows` inline on every render — the shape that used to loop. */
function ProbeWithInlineRows({ row }: { row: Record<string, unknown> | undefined }) {
  const labels = useFkLabels(FK_FIELDS, row ? [row] : [], FK_FIELDS);
  return <div data-testid="label">{labels.owner_id?.["o-1"] ?? "—"}</div>;
}

describe("useFkLabels (ADR-0074 regression guard)", () => {
  it("settles after resolving each distinct fk id once, and stops fetching", async () => {
    mockGetEntity.mockResolvedValue({ id: "o-1", name: "Ada Owner" } as never);

    render(<ProbeWithInlineRows row={ROW} />);

    // It still does its actual job.
    await waitFor(() => expect(screen.getByTestId("label")).toHaveTextContent("Ada Owner"));

    const callsOnceSettled = mockGetEntity.mock.calls.length;
    // One distinct fk id => a small, bounded number of resolutions. Before the
    // fix this was already climbing past 3 by the time the label rendered.
    expect(callsOnceSettled).toBeLessThanOrEqual(3);

    // The real assertion: left alone, it does not keep going. Pre-fix this
    // reached ~2900 over the same window.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mockGetEntity.mock.calls.length).toBe(callsOnceSettled);
  });

  it("does not refetch when a caller hands over a new array with unchanged fk ids", async () => {
    mockGetEntity.mockResolvedValue({ id: "o-1", name: "Ada Owner" } as never);

    const { rerender } = render(<ProbeWithInlineRows row={ROW} />);
    await waitFor(() => expect(screen.getByTestId("label")).toHaveTextContent("Ada Owner"));
    const before = mockGetEntity.mock.calls.length;

    // A different row object carrying the same fk value — a new array, and a
    // new element identity, but nothing this hook needs to re-resolve.
    rerender(<ProbeWithInlineRows row={{ ...ROW }} />);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockGetEntity.mock.calls.length).toBe(before);
  });

  it("does refetch when the fk ids actually change", async () => {
    mockGetEntity.mockImplementation(async (_config, id: string) => ({ id, name: `Owner ${id}` }) as never);

    const { rerender } = render(<ProbeWithInlineRows row={ROW} />);
    await waitFor(() => expect(screen.getByTestId("label")).toHaveTextContent("Owner o-1"));

    rerender(<ProbeWithInlineRows row={{ id: "w-1", owner_id: "o-2" }} />);

    await waitFor(() =>
      expect(mockGetEntity.mock.calls.some(([, id]) => id === "o-2")).toBe(true),
    );
  });
});
