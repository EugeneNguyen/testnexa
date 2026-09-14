import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FkSelect from "./fk-select";
import { listEntities } from "../../../lib/api/entityCrud";

/**
 * 2026-09-15, live-manual-test feedback ("test level, test type, test
 * condition should be dropdown select") — `FkSelect` fetches the ref
 * entity's full list once, no debounce, no `?q=` search. Mock shape mirrors
 * `fk-autocomplete.test.tsx`'s own `useEntitySchema` mock (stable config
 * object, same reasoning about re-render loops).
 */
const { schemaState, LEVEL_SCHEMA } = vi.hoisted(() => ({
  schemaState: { isLoading: false },
  LEVEL_SCHEMA: {
    resource: "test_level",
    path: "/test-levels",
    methods: ["list", "get"],
    fields: [{ name: "name", label: "Name", type: "string" }],
  },
}));

vi.mock("../../../pages/admin/useEntitySchema", () => ({
  useEntitySchema: (key: string) => ({
    config: key === "test-level" && !schemaState.isLoading ? LEVEL_SCHEMA : undefined,
    label: undefined,
    isLoading: schemaState.isLoading,
    isError: false,
  }),
}));

vi.mock("../../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/entityCrud")>();
  return { ...actual, listEntities: vi.fn() };
});

const mockListEntities = vi.mocked(listEntities);

describe("FkSelect", () => {
  beforeEach(() => {
    mockListEntities.mockResolvedValue({
      items: [
        { id: "level-1", name: "Unit" },
        { id: "level-2", name: "System" },
      ],
      total: 2,
      page: 1,
      page_size: 100,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    schemaState.isLoading = false;
  });

  it("fetches the ref entity's full list once on mount, no debounce", async () => {
    render(<FkSelect id="testLevelId" label="Test level" refEntity="test-level" labelField="name" onChange={vi.fn()} />);

    await waitFor(() => expect(mockListEntities).toHaveBeenCalledTimes(1));
    expect(mockListEntities).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "test_level" }),
      {},
      expect.objectContaining({ pageSize: 100 }),
    );
  });

  it("renders a native <select> with one <option> per fetched row", async () => {
    render(<FkSelect id="testLevelId" label="Test level" refEntity="test-level" labelField="name" onChange={vi.fn()} />);

    const select = await screen.findByLabelText("Test level");
    expect(select.tagName).toBe("SELECT");
    await waitFor(() => expect(screen.getByRole("option", { name: "Unit" })).toBeInTheDocument());
    expect(screen.getByRole("option", { name: "System" })).toBeInTheDocument();
  });

  it("calls onChange with the selected option's id", async () => {
    const onChange = vi.fn();
    render(<FkSelect id="testLevelId" label="Test level" refEntity="test-level" labelField="name" onChange={onChange} />);

    const select = await screen.findByLabelText("Test level");
    await waitFor(() => expect(screen.getByRole("option", { name: "Unit" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "level-1" } });

    expect(onChange).toHaveBeenCalledWith("level-1");
  });

  it("renders a disabled select while the ref-entity schema is still fetching", () => {
    schemaState.isLoading = true;
    render(<FkSelect id="testLevelId" label="Test level" refEntity="test-level" labelField="name" onChange={vi.fn()} />);

    expect(screen.getByLabelText("Test level")).toBeDisabled();
  });
});
