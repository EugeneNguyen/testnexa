/**
 * ADR-0057 addendum: one call site per scope wires up the whole ADR-0025
 * generic admin CRUD surface (List/Add/Edit/Delete) instead of hand-writing
 * 2 `<Route>` elements per scope. `App.tsx` calls this once per scope
 * (`/orgs/:orgId/admin`, `/projects/:projectId/admin`) — 4 hand-written
 * `<Route>`s collapse to 2 one-line calls.
 *
 * Returns a `<React.Fragment>` of `<Route>` elements, the officially
 * supported react-router v6 pattern for grouping routes under one call
 * without an extra layout route
 * (https://reactrouter.com/en/main/components/routes) — `<Routes>`'s own
 * `createRoutesFromChildren` recurses into `Fragment` children looking for
 * `<Route>`, so this composes with `App.tsx`'s existing hand-written
 * `<Route>`s in the same `<Routes>` tree with no special-casing needed.
 *
 * `key={basePath}` on the fragment is required — `App.tsx` calls this twice
 * (org-scoped, project-scoped) as siblings, and React needs a stable key to
 * tell the two fragments apart across re-renders.
 */
import { Fragment } from "react";
import { Route } from "react-router-dom";
import ProtectedRoute from "../../auth/ProtectedRoute";
import EntityFormPage from "./EntityFormPage";
import EntityListPage from "./EntityListPage";

/**
 * @param basePath e.g. `/orgs/:orgId/admin` or `/projects/:projectId/admin`
 *   — no trailing slash, no `:entity` suffix (added here).
 */
export function entityCrudRoutes(basePath: string) {
  return (
    <Fragment key={basePath}>
      <Route
        path={`${basePath}/:entity`}
        element={
          <ProtectedRoute>
            <EntityListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path={`${basePath}/:entity/:id/edit`}
        element={
          <ProtectedRoute>
            <EntityFormPage />
          </ProtectedRoute>
        }
      />
    </Fragment>
  );
}
