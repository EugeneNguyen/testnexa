import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import AppSidebar from "../src/components/AppSidebar";
import Colors from "../src/pages/ui-elements/Colors";
import Icons from "../src/pages/ui-elements/Icons";
import Typography from "../src/pages/ui-elements/Typography";

/**
 * TC-SHELL-014: "UI Elements" reference pages (Colors/Typography/Icons) —
 * smoke-level only, per ADR-0020's explicit "template-parity scaffolding,
 * not product scope" framing. No content-correctness assertions: each page
 * renders without throwing, and the sidebar's "UI Elements" nav group
 * actually reaches all three routes.
 */
describe("UI Elements reference pages", () => {
  it("Colors renders", () => {
    render(<Colors />);
    expect(screen.getByRole("heading", { name: "Colors" })).toBeInTheDocument();
  });

  it("Typography renders", () => {
    render(<Typography />);
    expect(screen.getByRole("heading", { name: "Typography", level: 1 })).toBeInTheDocument();
  });

  it("Icons renders", () => {
    render(<Icons />);
    expect(screen.getByRole("heading", { name: "Icons" })).toBeInTheDocument();
  });

  it("sidebar's 'UI Elements' nav group reaches all 3 pages, only when orgId is present", () => {
    const ORG_ID = "org-1";
    render(
      <MemoryRouter initialEntries={[`/orgs/${ORG_ID}`]}>
        <Routes>
          <Route path="/orgs/:orgId" element={<AppSidebar visible onVisibleChange={vi.fn()} />} />
        </Routes>
      </MemoryRouter>,
    );

    const group = screen.getByTestId("sidebar-nav-group-ui-elements");
    expect(within(group).getByTestId("sidebar-nav-ui-colors")).toHaveAttribute(
      "href",
      `/orgs/${ORG_ID}/ui-elements/colors`,
    );
    expect(within(group).getByTestId("sidebar-nav-ui-typography")).toHaveAttribute(
      "href",
      `/orgs/${ORG_ID}/ui-elements/typography`,
    );
    expect(within(group).getByTestId("sidebar-nav-ui-icons")).toHaveAttribute(
      "href",
      `/orgs/${ORG_ID}/ui-elements/icons`,
    );
  });

  it("'UI Elements' nav group is absent with no org selected (/orgs/pick), same posture as the org-scoped nav items", () => {
    render(
      <MemoryRouter initialEntries={["/orgs/pick"]}>
        <Routes>
          <Route path="/orgs/pick" element={<AppSidebar visible onVisibleChange={vi.fn()} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("sidebar-nav-group-ui-elements")).not.toBeInTheDocument();
  });
});
