import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Tabs, panelId } from "./tabs";

/**
 * ADR-0071: the `Tabs` molecule built for `EntityDetailPage`'s Info +
 * relationship tabs.
 *
 * The two claims worth pinning are both about *not* handing control to a
 * library: the strip is a set of real `<button>`s React drives, and it carries
 * no `data-bs-toggle` for Tabler's own loaded JS bundle to act on
 * (`frontend/CLAUDE.md`'s Tabler section). Everything else is stock Bootstrap
 * 5 tab markup, asserted by class so a future restyle can't silently drop it.
 */
const ITEMS = [
  { id: "info", label: "Info" },
  { id: "test-steps", label: "Test steps" },
  { id: "test-case-defect-links", label: "Defects (linked)" },
];

function renderTabs(activeId = "info", onSelect = vi.fn()) {
  render(<Tabs items={ITEMS} activeId={activeId} onSelect={onSelect} testIdPrefix="entity-detail" />);
  return onSelect;
}

describe("Tabs molecule (ADR-0071)", () => {
  it("renders stock Bootstrap 5 tab markup with one tab per item", () => {
    renderTabs();

    const list = screen.getByTestId("entity-detail-tablist");
    expect(list.tagName).toBe("UL");
    expect(list).toHaveClass("nav", "nav-tabs");
    expect(list).toHaveAttribute("role", "tablist");
    expect(screen.getAllByRole("tab")).toHaveLength(ITEMS.length);
    ITEMS.forEach((item) => {
      expect(screen.getByTestId(`entity-detail-tab-${item.id}`)).toHaveTextContent(item.label);
    });
  });

  it("marks only the active tab with .active and aria-selected", () => {
    renderTabs("test-steps");

    const active = screen.getByTestId("entity-detail-tab-test-steps");
    expect(active).toHaveClass("nav-link", "active");
    expect(active).toHaveAttribute("aria-selected", "true");

    const inactive = screen.getByTestId("entity-detail-tab-info");
    expect(inactive).toHaveClass("nav-link");
    expect(inactive).not.toHaveClass("active");
    expect(inactive).toHaveAttribute("aria-selected", "false");
  });

  it("points each tab's aria-controls at the id panelId() generates", () => {
    renderTabs();

    expect(screen.getByTestId("entity-detail-tab-test-steps")).toHaveAttribute(
      "aria-controls",
      panelId("entity-detail", "test-steps"),
    );
  });

  it("fires onSelect with the clicked tab's id", async () => {
    const user = userEvent.setup();
    const onSelect = renderTabs();

    await user.click(screen.getByTestId("entity-detail-tab-test-case-defect-links"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("test-case-defect-links");
  });

  /**
   * Each tab is a real `<button>`, so keyboard activation is the platform's,
   * not something this component reimplements — which is exactly why it is a
   * `<button>` and not an `<a href="#">` or a `<div role="tab">`.
   */
  it("activates a focused tab from the keyboard", async () => {
    const user = userEvent.setup();
    const onSelect = renderTabs();

    screen.getByTestId("entity-detail-tab-test-steps").focus();
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith("test-steps");
  });

  /**
   * Load-bearing, not cosmetic: Tabler's JS bundle IS loaded (ADR-0053 Phase
   * 1) and would act on a `data-bs-toggle="tab"` attribute, fighting React for
   * ownership of which panel shows.
   */
  it("carries no data-bs-toggle for Tabler's bundled JS to hijack", () => {
    renderTabs();

    screen.getAllByRole("tab").forEach((tab) => {
      expect(tab).not.toHaveAttribute("data-bs-toggle");
      expect(tab).toHaveAttribute("type", "button");
    });
  });
});
