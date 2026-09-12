import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { entityCrudRoutes } from "./entityCrudRoutes";

/**
 * ADR-0057 addendum: `entityCrudRoutes()` is a pure route-wiring helper, so
 * this test only proves the wiring (path -> component, `ProtectedRoute`
 * applied) — not `EntityListPage`/`EntityFormPage`'s own behavior, which
 * their own test files already cover. Both are mocked to a stub `data-testid`
 * for that reason.
 */
vi.mock("../../auth/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="protected-route">{children}</div>
  ),
}));
vi.mock("./EntityListPage", () => ({
  default: () => <div data-testid="entity-list-page-stub" />,
}));
vi.mock("./EntityFormPage", () => ({
  default: () => <div data-testid="entity-form-page-stub" />,
}));

function renderAt(initialPath: string, basePath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>{entityCrudRoutes(basePath)}</Routes>
    </MemoryRouter>,
  );
}

describe("entityCrudRoutes", () => {
  it("wires the list route (org-scoped) behind ProtectedRoute", async () => {
    renderAt("/orgs/org-1/admin/roles", "/orgs/:orgId/admin");
    expect(await screen.findByTestId("protected-route")).toBeInTheDocument();
    expect(await screen.findByTestId("entity-list-page-stub")).toBeInTheDocument();
  });

  it("wires the edit route (org-scoped) behind ProtectedRoute", async () => {
    renderAt("/orgs/org-1/admin/roles/role-1/edit", "/orgs/:orgId/admin");
    expect(await screen.findByTestId("protected-route")).toBeInTheDocument();
    expect(await screen.findByTestId("entity-form-page-stub")).toBeInTheDocument();
  });

  it("wires both routes for a different scope's basePath (project-scoped)", async () => {
    renderAt("/projects/proj-1/admin/test-cases", "/projects/:projectId/admin");
    expect(await screen.findByTestId("entity-list-page-stub")).toBeInTheDocument();

    renderAt("/projects/proj-1/admin/test-cases/tc-1/edit", "/projects/:projectId/admin");
    expect(await screen.findByTestId("entity-form-page-stub")).toBeInTheDocument();
  });
});
