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
 * REQ-1 (ADR-0022/ADR-0024): a second, independent section on this same page
 * — Requirement list (searchable by `?q=` title/description/external_ref/
 * source substring, per FR-REQ-1's own AC) + "New Requirement" modal, same
 * RHF+Zod+CoreUI convention as "New Release" above, its own separate
 * `useForm` instance (two independent forms on one page, not a shared one).
 * No TestCondition/TestCase UI here — that's REQ-2/3's own separate scope.
 *
 * Built with CoreUI (ADR-0012).
 */
import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
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
  CFormTextarea,
  CInputGroup,
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
import { createRequirement, listRequirements, RequirementSummary } from "../../lib/api/requirements";

const newReleaseSchema = z.object({
  versionLabel: z.string().trim().min(1, "Version label is required"),
  targetDate: z.string().trim().optional(),
});

type NewReleaseFormValues = z.infer<typeof newReleaseSchema>;

const newRequirementSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().min(1, "Description is required"),
  source: z.string().trim().optional(),
  externalRef: z.string().trim().optional(),
});

type NewRequirementFormValues = z.infer<typeof newRequirementSchema>;

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

function dashIfEmpty(value: string | null): string {
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

  // --- REQ-1: Requirement list + "New Requirement" modal (independent of Releases above) ---
  const [requirements, setRequirements] = useState<RequirementSummary[]>([]);
  const [reqLoading, setReqLoading] = useState(true);
  const [reqLoadError, setReqLoadError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const [showReqModal, setShowReqModal] = useState(false);
  const [reqApiError, setReqApiError] = useState<string | null>(null);

  const {
    register: registerRequirement,
    handleSubmit: handleSubmitRequirement,
    reset: resetRequirement,
    setError: setRequirementError,
    formState: { errors: requirementErrors, isSubmitting: isSubmittingRequirement },
  } = useForm<NewRequirementFormValues>({
    resolver: zodResolver(newRequirementSchema),
    defaultValues: { title: "", description: "", source: "", externalRef: "" },
  });

  const fetchRequirements = useCallback(
    async (q: string) => {
      if (!projectId) {
        return;
      }
      setReqLoading(true);
      setReqLoadError(null);
      try {
        const response = await listRequirements(projectId, q ? { q } : {});
        setRequirements(response.items);
      } catch (err) {
        setReqLoadError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      } finally {
        setReqLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    fetchRequirements(searchTerm);
  }, [fetchRequirements, searchTerm]);

  function onSearchSubmit(event: FormEvent) {
    event.preventDefault();
    setSearchTerm(searchInput.trim());
  }

  function openReqModal() {
    setReqApiError(null);
    resetRequirement({ title: "", description: "", source: "", externalRef: "" });
    setShowReqModal(true);
  }

  function closeReqModal() {
    setShowReqModal(false);
  }

  async function onSubmitRequirement(values: NewRequirementFormValues) {
    if (!projectId) {
      return;
    }
    setReqApiError(null);
    try {
      await createRequirement(projectId, {
        title: values.title,
        description: values.description,
        // Omitted (not sent as an empty string) when blank, matching the
        // backend's `str | None = None` optional-field convention.
        ...(values.source ? { source: values.source } : {}),
        ...(values.externalRef ? { external_ref: values.externalRef } : {}),
      });
      closeReqModal();
      await fetchRequirements(searchTerm);
    } catch (err) {
      if (err instanceof ApiError) {
        const titleError = fieldError(err, "title");
        const descriptionError = fieldError(err, "description");
        if (titleError) {
          setRequirementError("title", { type: "server", message: titleError });
        } else if (descriptionError) {
          setRequirementError("description", { type: "server", message: descriptionError });
        } else {
          setReqApiError(err.message);
        }
      } else {
        setReqApiError("Something went wrong. Please try again.");
      }
    }
  }

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

            <CCard className="mt-4">
              <CCardBody className="p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h2 className="fs-4 mb-0">Requirements</h2>
                  <CButton color="primary" onClick={openReqModal}>
                    New Requirement
                  </CButton>
                </div>

                <CForm onSubmit={onSearchSubmit} className="mb-3">
                  <CInputGroup>
                    <CFormInput
                      aria-label="Search requirements"
                      placeholder="Search by title, description, source, or external ref…"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                    />
                    <CButton type="submit" color="secondary" variant="outline">
                      Search
                    </CButton>
                  </CInputGroup>
                </CForm>

                {reqLoadError && (
                  <CAlert color="danger" role="alert">
                    {reqLoadError}
                  </CAlert>
                )}

                {reqLoading ? (
                  <div className="d-flex justify-content-center py-4">
                    <CSpinner color="primary" />
                  </div>
                ) : requirements.length === 0 ? (
                  <p className="text-body-secondary mb-0">
                    {searchTerm ? "No requirements match your search." : "No requirements yet."}
                  </p>
                ) : (
                  <CTable hover responsive>
                    <CTableHead>
                      <CTableRow>
                        <CTableHeaderCell>Title</CTableHeaderCell>
                        <CTableHeaderCell>External ref</CTableHeaderCell>
                        <CTableHeaderCell>Source</CTableHeaderCell>
                      </CTableRow>
                    </CTableHead>
                    <CTableBody>
                      {requirements.map((requirement) => (
                        <CTableRow key={requirement.id}>
                          <CTableDataCell>{requirement.title}</CTableDataCell>
                          <CTableDataCell>{dashIfEmpty(requirement.external_ref)}</CTableDataCell>
                          <CTableDataCell>{dashIfEmpty(requirement.source)}</CTableDataCell>
                        </CTableRow>
                      ))}
                    </CTableBody>
                  </CTable>
                )}
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>
      </CContainer>

      <CModal visible={showReqModal} onClose={closeReqModal}>
        <CModalHeader>
          <CModalTitle>New Requirement</CModalTitle>
        </CModalHeader>
        <CForm onSubmit={handleSubmitRequirement(onSubmitRequirement)} noValidate>
          <CModalBody>
            <div className="mb-3">
              <CFormLabel htmlFor="requirementTitle">Title</CFormLabel>
              <CFormInput
                id="requirementTitle"
                type="text"
                invalid={!!requirementErrors.title}
                {...registerRequirement("title")}
              />
              {requirementErrors.title && <CFormFeedback invalid>{requirementErrors.title.message}</CFormFeedback>}
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="requirementDescription">Description</CFormLabel>
              <CFormTextarea
                id="requirementDescription"
                rows={3}
                invalid={!!requirementErrors.description}
                {...registerRequirement("description")}
              />
              {requirementErrors.description && (
                <CFormFeedback invalid>{requirementErrors.description.message}</CFormFeedback>
              )}
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="requirementSource">Source</CFormLabel>
              <CFormInput id="requirementSource" type="text" {...registerRequirement("source")} />
              <CFormText>Optional.</CFormText>
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="requirementExternalRef">External ref</CFormLabel>
              <CFormInput id="requirementExternalRef" type="text" {...registerRequirement("externalRef")} />
              <CFormText>Optional — e.g. a Jira/GitHub issue id.</CFormText>
            </div>
            {reqApiError && (
              <CAlert color="danger" role="alert">
                {reqApiError}
              </CAlert>
            )}
          </CModalBody>
          <CModalFooter>
            <CButton color="secondary" variant="outline" onClick={closeReqModal}>
              Cancel
            </CButton>
            <CButton type="submit" color="primary" disabled={isSubmittingRequirement}>
              {isSubmittingRequirement ? "Creating..." : "Create"}
            </CButton>
          </CModalFooter>
        </CForm>
      </CModal>

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
