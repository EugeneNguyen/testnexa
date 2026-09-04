/**
 * Project-detail page (PROJ-2, ADR-0019) — the "select a project" landing
 * page PROJ-2's plan calls out as not existing yet, needed as a place to
 * hang Release UI off of. Route: `/projects/:projectId`.
 *
 * Release list is a real fetched list (unlike `OrgHome.tsx`'s Project list,
 * which is local-state-only because no `GET /orgs/{org_id}/projects` route
 * exists) — `GET /projects/{project_id}/releases` does exist for this story,
 * so a page reload does not lose data here.
 *
 * "New Release" modal copies `OrgHome.tsx`'s "New Project" modal convention
 * exactly: React Hook Form + Zod (ADR-0009) bound to CoreUI input
 * components, `CModal`/`CModalHeader`/`CModalBody`/`CModalFooter` structure,
 * inline `CAlert` for a non-field API error, `error.body.field_errors.<field>`
 * mapped onto the matching RHF field when present.
 *
 * Each Release row expands in place to fetch and render
 * `GET /releases/{id}/test-cycles` (ADR-0019 AC2's nested-executions audit
 * query) — read-only, no edit UI, this is an audit view only.
 *
 * Built with CoreUI (ADR-0012).
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CAlert,
  CButton,
  CCard,
  CCardBody,
  CCol,
  CContainer,
  CForm,
  CFormInput,
  CFormFeedback,
  CFormLabel,
  CFormText,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CRow,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from "@coreui/react";
import { ApiError } from "../../lib/api/client";
import {
  createRelease,
  getReleaseTestCycles,
  listReleases,
  ReleaseSummary,
  TestCycleSummary,
} from "../../lib/api/releases";

const newReleaseSchema = z.object({
  versionLabel: z.string().trim().min(1, "Version label is required"),
  targetDate: z.string().trim().optional(),
});

type NewReleaseFormValues = z.infer<typeof newReleaseSchema>;

/**
 * Pulls a `422` field-level message out of an `ApiError`'s body for `field`,
 * same convention as `OrgHome.tsx`'s own `fieldError` helper — kept as a
 * separate copy per this codebase's existing per-page precedent rather than
 * a shared import.
 */
function fieldError(error: ApiError, field: string): string | undefined {
  const body = error.body as { field_errors?: Record<string, string> } | undefined;
  return body?.field_errors?.[field];
}

function formatDate(value: string | null): string {
  return value ?? "—";
}

function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();

  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cycles, setCycles] = useState<TestCycleSummary[]>([]);
  const [cyclesLoading, setCyclesLoading] = useState(false);
  const [cyclesError, setCyclesError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<NewReleaseFormValues>({
    resolver: zodResolver(newReleaseSchema),
    defaultValues: { versionLabel: "", targetDate: "" },
  });

  const fetchReleases = useCallback(
    async (sortOrder: "asc" | "desc") => {
      if (!projectId) {
        return;
      }
      setLoading(true);
      setLoadError(null);
      try {
        const response = await listReleases(projectId, { sort: "target_date", order: sortOrder });
        setReleases(response.items);
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    fetchReleases(order);
  }, [fetchReleases, order]);

  function toggleSort() {
    setOrder((prev) => (prev === "asc" ? "desc" : "asc"));
  }

  function openModal() {
    setApiError(null);
    reset({ versionLabel: "", targetDate: "" });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
  }

  async function onSubmit(values: NewReleaseFormValues) {
    if (!projectId) {
      return;
    }
    setApiError(null);
    try {
      await createRelease(projectId, {
        version_label: values.versionLabel,
        // Omitted (not sent as an empty string) when blank, matching
        // `CreateReleaseRequest`'s `date | None = None` default.
        ...(values.targetDate ? { target_date: values.targetDate } : {}),
      });
      closeModal();
      // Re-fetch (rather than locally append) so the new release lands in
      // its correct sorted position per the current `order`.
      await fetchReleases(order);
    } catch (err) {
      if (err instanceof ApiError) {
        const versionLabelError = fieldError(err, "version_label");
        if (versionLabelError) {
          setError("versionLabel", { type: "server", message: versionLabelError });
        } else {
          setApiError(err.message);
        }
      } else {
        setApiError("Something went wrong. Please try again.");
      }
    }
  }

  async function toggleExpand(release: ReleaseSummary) {
    if (expandedId === release.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(release.id);
    setCyclesLoading(true);
    setCyclesError(null);
    setCycles([]);
    try {
      const result = await getReleaseTestCycles(release.id);
      setCycles(result);
    } catch (err) {
      setCyclesError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setCyclesLoading(false);
    }
  }

  if (!projectId) {
    return null;
  }

  return (
    <div className="min-vh-100 bg-body-secondary py-4">
      <CContainer>
        <CRow className="justify-content-center">
          <CCol md={10} lg={8}>
            <CCard>
              <CCardBody className="p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h1 className="fs-4 mb-0">Project: {projectId}</h1>
                  <CButton color="primary" onClick={openModal}>
                    New Release
                  </CButton>
                </div>

                {loadError && (
                  <CAlert color="danger" role="alert">
                    {loadError}
                  </CAlert>
                )}

                {loading ? (
                  <div className="d-flex justify-content-center py-4">
                    <CSpinner color="primary" />
                  </div>
                ) : releases.length === 0 ? (
                  <p className="text-body-secondary mb-0">No releases yet.</p>
                ) : (
                  <CTable hover responsive>
                    <CTableHead>
                      <CTableRow>
                        <CTableHeaderCell>Version label</CTableHeaderCell>
                        <CTableHeaderCell>
                          <CButton color="link" className="p-0 text-decoration-none" onClick={toggleSort}>
                            Target date {order === "asc" ? "▲" : "▼"}
                          </CButton>
                        </CTableHeaderCell>
                      </CTableRow>
                    </CTableHead>
                    <CTableBody>
                      {releases.map((release) => (
                        <Fragment key={release.id}>
                          <CTableRow
                            style={{ cursor: "pointer" }}
                            onClick={() => toggleExpand(release)}
                          >
                            <CTableDataCell>{release.version_label}</CTableDataCell>
                            <CTableDataCell>{formatDate(release.target_date)}</CTableDataCell>
                          </CTableRow>
                          {expandedId === release.id && (
                            <CTableRow key={`${release.id}-detail`}>
                              <CTableDataCell colSpan={2} className="bg-body-tertiary">
                                {cyclesLoading && (
                                  <div className="d-flex justify-content-center py-2">
                                    <CSpinner size="sm" color="primary" />
                                  </div>
                                )}
                                {cyclesError && (
                                  <CAlert color="danger" role="alert">
                                    {cyclesError}
                                  </CAlert>
                                )}
                                {!cyclesLoading && !cyclesError && cycles.length === 0 && (
                                  <p className="text-body-secondary mb-0">No test cycles yet.</p>
                                )}
                                {!cyclesLoading && !cyclesError && cycles.length > 0 && (
                                  <ul className="list-unstyled mb-0">
                                    {cycles.map((cycle) => (
                                      <li key={cycle.id} className="mb-2">
                                        <div className="fw-semibold">
                                          {cycle.name} ({formatDate(cycle.start_date)} – {formatDate(cycle.end_date)})
                                        </div>
                                        {cycle.executions.length === 0 ? (
                                          <div className="text-body-secondary small">No executions yet.</div>
                                        ) : (
                                          <ul>
                                            {cycle.executions.map((execution) => (
                                              <li key={execution.id} className="small">
                                                {execution.result} — {execution.executed_at}
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </CTableDataCell>
                            </CTableRow>
                          )}
                        </Fragment>
                      ))}
                    </CTableBody>
                  </CTable>
                )}
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>
      </CContainer>

      <CModal visible={showModal} onClose={closeModal}>
        <CModalHeader>
          <CModalTitle>New Release</CModalTitle>
        </CModalHeader>
        <CForm onSubmit={handleSubmit(onSubmit)} noValidate>
          <CModalBody>
            <div className="mb-3">
              <CFormLabel htmlFor="releaseVersionLabel">Version label</CFormLabel>
              <CFormInput
                id="releaseVersionLabel"
                type="text"
                invalid={!!errors.versionLabel}
                {...register("versionLabel")}
              />
              {errors.versionLabel && <CFormFeedback invalid>{errors.versionLabel.message}</CFormFeedback>}
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="releaseTargetDate">Target date</CFormLabel>
              <CFormInput id="releaseTargetDate" type="date" {...register("targetDate")} />
              <CFormText>Optional.</CFormText>
            </div>
            {apiError && (
              <CAlert color="danger" role="alert">
                {apiError}
              </CAlert>
            )}
          </CModalBody>
          <CModalFooter>
            <CButton color="secondary" variant="outline" onClick={closeModal}>
              Cancel
            </CButton>
            <CButton type="submit" color="primary" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create"}
            </CButton>
          </CModalFooter>
        </CForm>
      </CModal>
    </div>
  );
}

export default ProjectDetail;
