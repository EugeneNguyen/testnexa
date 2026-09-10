/**
 * ADR-0025: the surface's other page component — the dedicated `/edit`
 * route only (UI Design Document §2: create renders inside a modal on
 * `EntityListPage` instead). Route:
 * `/orgs/:orgId/admin/:entity/:id/edit` or
 * `/projects/:projectId/admin/:entity/:id/edit`.
 *
 * **ADR-0042 (CoreUI -> AdminLTE v4):** raw Bootstrap 5 markup —
 * `CContainer fluid` -> `<div class="container-fluid">`, `CCard`/`CCardBody`
 * -> `<div class="card">`/`<div class="card-body">`, `CAlert` -> `<div
 * class="alert alert-danger" role="alert">`, `CSpinner` -> `<div
 * class="spinner-border" role="status">`. The `h-100` stretch pattern is
 * unchanged (`frontend/CLAUDE.md`: the card is the sole child of its sizing
 * context here, so a plain height utility is correct).
 *
 * **EXEC-3 (ADR-0044)** adds one exception to this page's otherwise fully
 * generic shape: a read-only "Defects" section when `entityKey ===
 * "test-cases"` (§4). Its badge uses `bg-*` per this repo's own AdminLTE
 * convention (not Bootstrap 5.3's `text-bg-*`).
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import EntityForm from "../../components/organisms/entity-form";
import { ApiError } from "../../lib/api/client";
import { EntityRow, getEntity, updateEntity } from "../../lib/api/entityCrud";
import { listDefectsForTestCase, type DefectSummary } from "../../lib/api/defects";
import { useAdminRouteContext } from "./useAdminRouteContext";

/** UI Design Document §4 (EXEC-3, ADR-0044) — one color per `DefectSeverity`. */
function severityColor(severity: string): string {
  switch (severity) {
    case "critical":
      return "danger";
    case "high":
      return "warning";
    case "medium":
      return "info";
    default:
      return "secondary";
  }
}

function fieldErrorsFrom(error: unknown): Record<string, string> | undefined {
  if (!(error instanceof ApiError)) {
    return undefined;
  }
  const body = error.body as { field_errors?: Record<string, string[]> } | undefined;
  if (!body?.field_errors) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(body.field_errors).map(([field, messages]) => [field, messages[0]]));
}

function EntityFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { entityKey, config, label, schemaLoading } = useAdminRouteContext();

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>(undefined);

  const itemQuery = useQuery({
    queryKey: ["entity-item", entityKey, id],
    queryFn: () => getEntity<EntityRow>(config!, id as string),
    enabled: Boolean(config) && Boolean(id),
  });

  const updateMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => updateEntity(config!, id as string, values),
    onSuccess: () => navigate(-1),
    onError: (error: unknown) => {
      const errors = fieldErrorsFrom(error);
      if (errors) {
        setFieldErrors(errors);
      } else {
        setSubmitError(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
      }
    },
  });

  /**
   * EXEC-3 (ADR-0044), UI Design Document §4: `TestCase`'s only detail view
   * (there is no bespoke `TestCaseDetail` page) gains a read-only "Defects"
   * section, most-recent-first exactly as `GET /test-cases/{id}/defects`
   * returns it — no client-side re-sort needed. Only fetched for the
   * `test-case` entity; every other entity's edit page is unaffected.
   */
  const isTestCaseEntity = entityKey === "test-cases";
  const defectsQuery = useQuery({
    queryKey: ["test-case-defects", id],
    queryFn: () => listDefectsForTestCase(id as string),
    enabled: isTestCaseEntity && Boolean(id),
  });

  /**
   * ADR-0053: `config` is `undefined` for one round trip while
   * `GET /entities/{resource}/schema` is in flight, not only for an unknown
   * `:entity` — gate the error branch below on the fetch having actually
   * settled, or every edit page flashes "Unknown admin entity" first. Reuses
   * this page's own item-fetch spinner markup.
   */
  if (schemaLoading) {
    return (
      <div className="container-fluid px-4 py-4 h-100">
        <div className="card h-100">
          <div className="card-body">
            <div className="d-flex justify-content-center py-4">
              <div className="spinner-border text-primary" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="container-fluid px-4 py-4 h-100">
        <div className="card h-100">
          <div className="card-body">
            <div className="alert alert-danger" role="alert">
              Unknown admin entity &quot;{entityKey}&quot;.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid px-4 py-4 h-100">
      <div className="card h-100">
        <div className="card-body">
          <h1 className="fs-4 mb-3">Edit {label ?? entityKey.replace(/-/g, " ")}</h1>

          {itemQuery.isLoading ? (
            <div className="d-flex justify-content-center py-4">
              <div className="spinner-border text-primary" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
            </div>
          ) : itemQuery.isError ? (
            <div className="alert alert-danger" role="alert">
              Something went wrong loading this record.
            </div>
          ) : (
            <EntityForm
              config={config}
              mode="edit"
              initialValues={itemQuery.data}
              submitError={submitError}
              serverFieldErrors={fieldErrors}
              onCancel={() => navigate(-1)}
              onSubmit={async (values) => {
                setSubmitError(null);
                setFieldErrors(undefined);
                await updateMutation.mutateAsync(values);
              }}
            />
          )}

          {isTestCaseEntity && (
            <div className="mt-4" data-testid="test-case-defects-section">
              <h2 className="fs-5 mb-3">Defects</h2>

              {defectsQuery.isLoading ? (
                <div className="d-flex justify-content-center py-3">
                  <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                </div>
              ) : defectsQuery.isError ? (
                <div className="alert alert-danger" role="alert" data-testid="test-case-defects-error">
                  Something went wrong loading this test case's defects.
                </div>
              ) : defectsQuery.data && defectsQuery.data.length > 0 ? (
                /* Flat <ul>/<li>, per frontend/CLAUDE.md's nested-list convention. */
                <ul className="list-unstyled mb-0" data-testid="test-case-defects-list">
                  {defectsQuery.data.map((defect: DefectSummary) => (
                    <li
                      key={defect.id}
                      className="border-bottom py-2"
                      data-testid={`test-case-defect-${defect.id}`}
                    >
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        <span
                          className={`badge bg-${severityColor(defect.severity)}`}
                          data-testid={`test-case-defect-${defect.id}-severity`}
                        >
                          {defect.severity}
                        </span>
                        <span data-testid={`test-case-defect-${defect.id}-external-ref`}>
                          {defect.external_ref ?? "(no external ref)"}
                        </span>
                        <span
                          className="text-body-secondary small"
                          data-testid={`test-case-defect-${defect.id}-status`}
                        >
                          {defect.status}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body-secondary mb-0" data-testid="test-case-defects-empty">
                  No defects raised against this test case yet.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default EntityFormPage;
