/**
 * ADR-0025: the surface's other page component — the dedicated `/edit`
 * route only (UI Design Document §2: create renders inside a modal on
 * `EntityListPage` instead). Route:
 * `/orgs/:orgId/admin/:entity/:id/edit` or
 * `/projects/:projectId/admin/:entity/:id/edit`.
 *
 * **ADR-0042 (CoreUI -> AdminLTE v4):** raw Bootstrap 5 markup —
 * `CContainer fluid` -> `<div class="container-fluid">`, `CCard`/`CCardBody`
 * -> the `Card` atom, `CAlert` -> the `Alert` atom, `CSpinner` -> the new
 * `Spinner` atom (this page's own three near-identical hand-rolled spinner
 * blocks are what prompted extracting it — see `frontend/CLAUDE.md`'s
 * component-reuse rule). The `h-100` stretch pattern is unchanged
 * (`frontend/CLAUDE.md`: the card is the sole child of its sizing context
 * here, so a plain height utility is correct).
 *
 * **EXEC-3 (ADR-0044)** adds one exception to this page's otherwise fully
 * generic shape: a read-only "Defects" section when `entityKey ===
 * "test-cases"` (§4). Its badge uses `bg-*` per this repo's own AdminLTE
 * convention (not Bootstrap 5.3's `text-bg-*`).
 *
 * **REQ-5 (ADR-0069)** adds a second `test-cases`-only section, "Link to
 * Requirement" — a conditional action shown only when the loaded case has
 * no existing Requirement traceability (`GET /test-cases/{id}/requirement-link`,
 * same read-on-mount shape the Defects section above already established).
 * Unlinked: a short note + button opening a small `Modal` with a
 * project-scoped `FkAutocomplete` Requirement picker. Linked: a read-only
 * `FkAutocomplete` (disabled) showing the linked Requirement's own title,
 * reusing its built-in id->label lookup rather than a second fetch.
 *

 * **ADR-0060:** optional `entityKeyOverride` prop, for a route with no
 * `:entity` segment at all (`/orgs/:orgId/projects/:id/edit`, `Project`'s
 * retired-`ProjectsPage` replacement) — passed straight through to
 * `useAdminRouteContext`. Every other mount omits it and behaves exactly as
 * before.
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, FkAutocomplete, Modal, Spinner, EntityForm } from "../../../components";
import { ApiError } from "../../../lib/api/client";
import { EntityRow, getEntity, updateEntity } from "../../../lib/api/entityCrud";
import { listDefectsForTestCase, type DefectSummary } from "../../../lib/api/defects";
import { getTestCaseRequirementLink, linkTestCaseToRequirement } from "../../../lib/api/testCases";
import { useAdminRouteContext } from "../../../pages/admin/useAdminRouteContext";

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

function EntityFormPage({ entityKeyOverride }: { entityKeyOverride?: string } = {}) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { entityKey, config, label, schemaLoading } = useAdminRouteContext(entityKeyOverride);

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
   * REQ-5 (ADR-0069): whether this case already has Requirement
   * traceability — same read-on-mount shape as `defectsQuery` above.
   */
  const queryClient = useQueryClient();
  const requirementLinkQuery = useQuery({
    queryKey: ["test-case-requirement-link", id],
    queryFn: () => getTestCaseRequirementLink(id as string),
    enabled: isTestCaseEntity && Boolean(id),
  });
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [pendingRequirementId, setPendingRequirementId] = useState<string | undefined>(undefined);
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkMutation = useMutation({
    mutationFn: (requirementId: string) =>
      linkTestCaseToRequirement(id as string, { requirement_id: requirementId }),
    onSuccess: () => {
      setShowLinkModal(false);
      setPendingRequirementId(undefined);
      setLinkError(null);
      queryClient.invalidateQueries({ queryKey: ["test-case-requirement-link", id] });
    },
    onError: (error: unknown) => {
      setLinkError(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
    },
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
        <Card className="h-100">
          <Card.Body>
            <Spinner wrapperClassName="py-4" />
          </Card.Body>
        </Card>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="container-fluid px-4 py-4 h-100">
        <Card className="h-100">
          <Card.Body>
            <Alert color="danger">Unknown admin entity &quot;{entityKey}&quot;.</Alert>
          </Card.Body>
        </Card>
      </div>
    );
  }

  return (
    <div className="container-fluid px-4 py-4 h-100">
      <Card className="h-100">
        <Card.Header>
          <Card.Title as="h1" className="fs-4 mb-0">
            Edit {label ?? entityKey.replace(/-/g, " ")}
          </Card.Title>
        </Card.Header>

        {itemQuery.isLoading ? (
          <Card.Body>
            <Spinner wrapperClassName="py-4" />
          </Card.Body>
        ) : itemQuery.isError ? (
          <Card.Body>
            <Alert color="danger">Something went wrong loading this record.</Alert>
          </Card.Body>
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
            BodySection={Card.Body}
            FooterSection={Card.Footer}
          />
        )}

        {isTestCaseEntity && (
          <Card.Body className="border-top">
            <div data-testid="test-case-defects-section">
              <h2 className="fs-5 mb-3">Defects</h2>

              {defectsQuery.isLoading ? (
                <Spinner wrapperClassName="py-3" />
              ) : defectsQuery.isError ? (
                <Alert color="danger" data-testid="test-case-defects-error">
                  Something went wrong loading this test case's defects.
                </Alert>
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
          </Card.Body>
        )}

        {isTestCaseEntity && (
          <Card.Body className="border-top">
            <div data-testid="test-case-requirement-link-section">
              <h2 className="fs-5 mb-3">Requirement</h2>

              {requirementLinkQuery.isLoading ? (
                <Spinner wrapperClassName="py-3" />
              ) : requirementLinkQuery.isError ? (
                <Alert color="danger" data-testid="test-case-requirement-link-error">
                  Something went wrong loading this test case's Requirement link.
                </Alert>
              ) : requirementLinkQuery.data?.requirement_id ? (
                <FkAutocomplete
                  id="test-case-linked-requirement"
                  label="Linked Requirement"
                  refEntity="requirement"
                  labelField="title"
                  value={requirementLinkQuery.data.requirement_id}
                  onChange={() => {}}
                  disabled
                />
              ) : (
                <>
                  <p className="text-body-secondary" data-testid="test-case-requirement-link-empty">
                    This test case has no Requirement.
                  </p>
                  <Button
                    type="button"
                    color="secondary"
                    data-testid="test-case-link-requirement-button"
                    onClick={() => setShowLinkModal(true)}
                  >
                    Link to Requirement
                  </Button>
                </>
              )}
            </div>
          </Card.Body>
        )}
      </Card>

      {isTestCaseEntity && (
        <Modal
          visible={showLinkModal}
          title="Link to Requirement"
          onClose={() => {
            setShowLinkModal(false);
            setPendingRequirementId(undefined);
            setLinkError(null);
          }}
        >
          <Modal.Body>
            <FkAutocomplete
              id="test-case-link-requirement-picker"
              label="Requirement"
              refEntity="requirement"
              labelField="title"
              value={pendingRequirementId}
              onChange={setPendingRequirementId}
              extraParams={{ project_id: (itemQuery.data?.project_id as string | undefined) ?? undefined }}
              error={linkError ?? undefined}
            />
          </Modal.Body>
          <Modal.Footer>
            <Button type="button" color="secondary" onClick={() => setShowLinkModal(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              color="primary"
              data-testid="test-case-link-requirement-submit"
              disabled={!pendingRequirementId || linkMutation.isPending}
              onClick={() => pendingRequirementId && linkMutation.mutate(pendingRequirementId)}
            >
              Link
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </div>
  );
}

export default EntityFormPage;
