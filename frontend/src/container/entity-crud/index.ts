/**
 * ADR-0057: single import site for the whole ADR-0025 generic admin CRUD
 * (List/Add/Edit/Delete) feature. A consumer needing this feature for a new
 * scope needs only:
 *
 *   import { entityCrudRoutes } from "./container/entity-crud";
 *   ...
 *   <Routes>{entityCrudRoutes("/some/:scopeId/admin")}</Routes>
 *
 * `EntityListPage`/`EntityFormPage`/`EntityDetailPage` stay individually
 * exported too, for a caller that needs one of the three screens directly
 * rather than the whole routed set (`App.tsx`'s ADR-0060 `projects` mount does
 * exactly that for the first two, kept for parity with every other barrel in
 * this codebase exporting its real named pieces, not just the aggregate).
 */
export { entityCrudRoutes } from "./entityCrudRoutes";
export { default as EntityListPage } from "./EntityListPage";
export { default as EntityFormPage } from "./EntityFormPage";
export { default as EntityDetailPage } from "./EntityDetailPage";
