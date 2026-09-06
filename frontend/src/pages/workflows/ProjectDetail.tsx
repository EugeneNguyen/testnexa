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
 * REQ-1 (ADR-0022/ADR-0025): a second, independent section on this same page
 * — Requirement list (searchable by `?q=` title/description/external_ref/
 * source substring, per FR-REQ-1's own AC) + "New Requirement" modal, same
 * RHF+Zod+CoreUI convention as "New Release" above, its own separate
 * `useForm` instance (two independent forms on one page, not a shared one).
 *
 * REQ-2 (ADR-0006): each Requirement row expands in place (same
 * click-to-expand convention the Release rows above already use) to list its
 * directly-linked TestCases (`GET /requirements/{id}/test-cases`, no
 * TestCondition anywhere in the chain) + a "New Test Case" modal. Each
 * TestCase row itself expands one level further to list/add/edit its
 * TestSteps — independently editable, ordered by `sequence`.
 *
 * Built with CoreUI (ADR-0012).
 */
import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
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
  CFormSelect,
  CFormText,
  CFormTextarea,
  CInputGroup,
  CListGroup,
  CListGroupItem,
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
import { projectScopedEntities } from "../admin/registry";
import { createRequirement, listRequirements, RequirementSummary } from "../../lib/api/requirements";
import { createTestCase, listTestCasesForRequirement, TestCaseSummary } from "../../lib/api/testCases";
import { createTestStep, listTestSteps, updateTestStep, TestStepSummary } from "../../lib/api/testSteps";
import { listTestLevels, listTestTypes, TestLevelSummary, TestTypeSummary } from "../../lib/api/taxonomy";

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

const newTestCaseSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  preconditions: z.string().trim().optional(),
  expectedResult: z.string().trim().optional(),
  testLevelId: z.string().trim().min(1, "Test level is required"),
  testTypeId: z.string().trim().min(1, "Test type is required"),
});

type NewTestCaseFormValues = z.infer<typeof newTestCaseSchema>;

const newTestStepSchema = z.object({
  action: z.string().trim().min(1, "Action is required"),
  expectedResult: z.string().trim().optional(),
});

type NewTestStepFormValues = z.infer<typeof newTestStepSchema>;

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

  // --- REQ-2: directly-linked TestCases per expanded Requirement row ------------------------
  const [expandedRequirementId, setExpandedRequirementId] = useState<string | null>(null);
  const [testCases, setTestCases] = useState<TestCaseSummary[]>([]);
  const [testCasesLoading, setTestCasesLoading] = useState(false);
  const [testCasesError, setTestCasesError] = useState<string | null>(null);

  const [testLevels, setTestLevels] = useState<TestLevelSummary[]>([]);
  const [testTypes, setTestTypes] = useState<TestTypeSummary[]>([]);

  const [showTestCaseModal, setShowTestCaseModal] = useState(false);
  const [testCaseModalRequirementId, setTestCaseModalRequirementId] = useState<string | null>(null);
  const [testCaseApiError, setTestCaseApiError] = useState<string | null>(null);

  const {
    register: registerTestCase,
    handleSubmit: handleSubmitTestCase,
    reset: resetTestCase,
    setError: setTestCaseError,
    formState: { errors: testCaseErrors, isSubmitting: isSubmittingTestCase },
  } = useForm<NewTestCaseFormValues>({
    resolver: zodResolver(newTestCaseSchema),
    defaultValues: { title: "", preconditions: "", expectedResult: "", testLevelId: "", testTypeId: "" },
  });

  // TestSteps of whichever TestCase row is currently expanded (one at a time,
  // same single-active-expansion convention as Release/Requirement rows above).
  const [expandedTestCaseId, setExpandedTestCaseId] = useState<string | null>(null);
  const [testSteps, setTestSteps] = useState<TestStepSummary[]>([]);
  const [testStepsLoading, setTestStepsLoading] = useState(false);
  const [testStepsError, setTestStepsError] = useState<string | null>(null);

  const {
    register: registerTestStep,
    handleSubmit: handleSubmitTestStep,
    reset: resetTestStep,
    formState: { errors: testStepErrors, isSubmitting: isSubmittingTestStep },
  } = useForm<NewTestStepFormValues>({
    resolver: zodResolver(newTestStepSchema),
    defaultValues: { action: "", expectedResult: "" },
  });
  const [testStepApiError, setTestStepApiError] = useState<string | null>(null);

  // Inline per-step edit (independently editable, REQ-2 AC3) — plain local
  // state rather than a second RHF instance: only two fields, one row at a
  // time, no validation beyond "non-empty action" already guaranteed by the
  // step existing.
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editAction, setEditAction] = useState("");
  const [editExpectedResult, setEditExpectedResult] = useState("");
  const [editStepApiError, setEditStepApiError] = useState<string | null>(null);
  const [editStepSubmitting, setEditStepSubmitting] = useState(false);

  useEffect(() => {
    listTestLevels()
      .then((response) => setTestLevels(response.items))
      .catch(() => setTestLevels([]));
    listTestTypes()
      .then((response) => setTestTypes(response.items))
      .catch(() => setTestTypes([]));
  }, []);

  async function fetchTestCases(requirementId: string) {
    setTestCasesLoading(true);
    setTestCasesError(null);
    try {
      const response = await listTestCasesForRequirement(requirementId);
      setTestCases(response.items);
    } catch (err) {
      setTestCasesError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setTestCasesLoading(false);
    }
  }

  async function toggleRequirementExpand(requirement: RequirementSummary) {
    if (expandedRequirementId === requirement.id) {
      setExpandedRequirementId(null);
      return;
    }
    setExpandedRequirementId(requirement.id);
    setExpandedTestCaseId(null);
    setTestCases([]);
    await fetchTestCases(requirement.id);
  }

  function openTestCaseModal(requirementId: string) {
    setTestCaseApiError(null);
    resetTestCase({ title: "", preconditions: "", expectedResult: "", testLevelId: "", testTypeId: "" });
    setTestCaseModalRequirementId(requirementId);
    setShowTestCaseModal(true);
  }

  function closeTestCaseModal() {
    setShowTestCaseModal(false);
    setTestCaseModalRequirementId(null);
  }

  async function onSubmitTestCase(values: NewTestCaseFormValues) {
    if (!testCaseModalRequirementId) {
      return;
    }
    setTestCaseApiError(null);
    try {
      await createTestCase(testCaseModalRequirementId, {
        title: values.title,
        test_level_id: values.testLevelId,
        test_type_id: values.testTypeId,
        ...(values.preconditions ? { preconditions: values.preconditions } : {}),
        ...(values.expectedResult ? { expected_result: values.expectedResult } : {}),
      });
      closeTestCaseModal();
      await fetchTestCases(testCaseModalRequirementId);
    } catch (err) {
      if (err instanceof ApiError) {
        const titleError = fieldError(err, "title");
        if (titleError) {
          setTestCaseError("title", { type: "server", message: titleError });
        } else {
          setTestCaseApiError(err.message);
        }
      } else {
        setTestCaseApiError("Something went wrong. Please try again.");
      }
    }
  }

  async function fetchTestSteps(testCaseId: string) {
    setTestStepsLoading(true);
    setTestStepsError(null);
    try {
      const response = await listTestSteps(testCaseId);
      setTestSteps([...response.items].sort((a, b) => a.sequence - b.sequence));
    } catch (err) {
      setTestStepsError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setTestStepsLoading(false);
    }
  }

  async function toggleTestCaseExpand(testCase: TestCaseSummary) {
    if (expandedTestCaseId === testCase.id) {
      setExpandedTestCaseId(null);
      return;
    }
    setExpandedTestCaseId(testCase.id);
    setEditingStepId(null);
    resetTestStep({ action: "", expectedResult: "" });
    setTestStepApiError(null);
    setTestSteps([]);
    await fetchTestSteps(testCase.id);
  }

  async function onSubmitTestStep(values: NewTestStepFormValues) {
    if (!expandedTestCaseId) {
      return;
    }
    setTestStepApiError(null);
    try {
      await createTestStep({
        test_case_id: expandedTestCaseId,
        sequence: testSteps.length + 1,
        action: values.action,
        ...(values.expectedResult ? { expected_result: values.expectedResult } : {}),
      });
      resetTestStep({ action: "", expectedResult: "" });
      await fetchTestSteps(expandedTestCaseId);
    } catch (err) {
      setTestStepApiError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    }
  }

  function startEditStep(step: TestStepSummary) {
    setEditingStepId(step.id);
    setEditAction(step.action);
    setEditExpectedResult(step.expected_result ?? "");
    setEditStepApiError(null);
  }

  function cancelEditStep() {
    setEditingStepId(null);
    setEditStepApiError(null);
  }

  async function saveEditStep(stepId: string) {
    setEditStepSubmitting(true);
    setEditStepApiError(null);
    try {
      await updateTestStep(stepId, {
        action: editAction,
        expected_result: editExpectedResult || null,
      });
      setEditingStepId(null);
      if (expandedTestCaseId) {
        await fetchTestSteps(expandedTestCaseId);
      }
    } catch (err) {
      setEditStepApiError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setEditStepSubmitting(false);
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
                        <Fragment key={requirement.id}>
                          <CTableRow
                            style={{ cursor: "pointer" }}
                            onClick={() => toggleRequirementExpand(requirement)}
                          >
                            <CTableDataCell>{requirement.title}</CTableDataCell>
                            <CTableDataCell>{dashIfEmpty(requirement.external_ref)}</CTableDataCell>
                            <CTableDataCell>{dashIfEmpty(requirement.source)}</CTableDataCell>
                          </CTableRow>
                          {expandedRequirementId === requirement.id && (
                            <CTableRow key={`${requirement.id}-detail`}>
                              <CTableDataCell colSpan={3} className="bg-body-tertiary">
                                <div className="d-flex justify-content-between align-items-center mb-2">
                                  <h3 className="fs-6 mb-0">Test cases</h3>
                                  <CButton
                                    size="sm"
                                    color="primary"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openTestCaseModal(requirement.id);
                                    }}
                                  >
                                    New Test Case
                                  </CButton>
                                </div>

                                {testCasesError && (
                                  <CAlert color="danger" role="alert">
                                    {testCasesError}
                                  </CAlert>
                                )}

                                {testCasesLoading ? (
                                  <div className="d-flex justify-content-center py-2">
                                    <CSpinner size="sm" color="primary" />
                                  </div>
                                ) : !testCasesError && testCases.length === 0 ? (
                                  <p className="text-body-secondary mb-0">No test cases yet.</p>
                                ) : (
                                  // Flat `<ul>`, not a nested `<CTable>` — same convention the
                                  // Release-cycles audit view above already uses, and for the
                                  // same reason: a `<table>` nested inside a `<td>` of an outer
                                  // `<table>` makes the outer row's accessible name aggregate the
                                  // inner rows' text too (no ARIA role boundary between them),
                                  // which breaks `getByRole("row", {name})`-style lookups.
                                  <ul className="list-unstyled mb-0">
                                    {testCases.map((testCase) => (
                                      <li key={testCase.id} className="mb-2">
                                        <div
                                          role="button"
                                          tabIndex={0}
                                          style={{ cursor: "pointer" }}
                                          className="fw-semibold"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleTestCaseExpand(testCase);
                                          }}
                                        >
                                          {testCase.title} — {testCase.status}
                                        </div>
                                        {expandedTestCaseId === testCase.id && (
                                          <div className="ms-3 mt-1">
                                            {testStepsError && (
                                              <CAlert color="danger" role="alert">
                                                {testStepsError}
                                              </CAlert>
                                            )}
                                            {testStepsLoading ? (
                                              <div className="d-flex justify-content-center py-2">
                                                <CSpinner size="sm" color="primary" />
                                              </div>
                                            ) : (
                                              <>
                                                {testSteps.length === 0 && !testStepsError && (
                                                  <p className="text-body-secondary small mb-2">No steps yet.</p>
                                                )}
                                                {testSteps.length > 0 && (
                                                  <ol className="mb-2">
                                                    {testSteps.map((step) => (
                                                      <li key={step.id} className="mb-2">
                                                        {editingStepId === step.id ? (
                                                          <div>
                                                            <CFormInput
                                                              aria-label={`Step ${step.sequence} action`}
                                                              className="mb-1"
                                                              value={editAction}
                                                              onChange={(e) => setEditAction(e.target.value)}
                                                            />
                                                            <CFormInput
                                                              aria-label={`Step ${step.sequence} expected result`}
                                                              className="mb-1"
                                                              placeholder="Expected result (optional)"
                                                              value={editExpectedResult}
                                                              onChange={(e) =>
                                                                setEditExpectedResult(e.target.value)
                                                              }
                                                            />
                                                            {editStepApiError && (
                                                              <CAlert color="danger" role="alert" className="py-1">
                                                                {editStepApiError}
                                                              </CAlert>
                                                            )}
                                                            <CButton
                                                              size="sm"
                                                              color="primary"
                                                              className="me-1"
                                                              disabled={editStepSubmitting}
                                                              onClick={() => saveEditStep(step.id)}
                                                            >
                                                              Save
                                                            </CButton>
                                                            <CButton
                                                              size="sm"
                                                              color="secondary"
                                                              variant="outline"
                                                              onClick={cancelEditStep}
                                                            >
                                                              Cancel
                                                            </CButton>
                                                          </div>
                                                        ) : (
                                                          <div>
                                                            <span>{step.action}</span>
                                                            {step.expected_result && (
                                                              <span className="text-body-secondary">
                                                                {" "}
                                                                — {step.expected_result}
                                                              </span>
                                                            )}
                                                            <CButton
                                                              size="sm"
                                                              color="link"
                                                              className="p-0 ms-2"
                                                              onClick={() => startEditStep(step)}
                                                            >
                                                              Edit
                                                            </CButton>
                                                          </div>
                                                        )}
                                                      </li>
                                                    ))}
                                                  </ol>
                                                )}
                                              </>
                                            )}

                                            <CForm onSubmit={handleSubmitTestStep(onSubmitTestStep)} noValidate>
                                              <CInputGroup className="mb-1">
                                                <CFormInput
                                                  aria-label="New step action"
                                                  placeholder="Action"
                                                  invalid={!!testStepErrors.action}
                                                  {...registerTestStep("action")}
                                                />
                                                <CFormInput
                                                  aria-label="New step expected result"
                                                  placeholder="Expected result (optional)"
                                                  {...registerTestStep("expectedResult")}
                                                />
                                                <CButton
                                                  type="submit"
                                                  color="secondary"
                                                  variant="outline"
                                                  disabled={isSubmittingTestStep}
                                                >
                                                  Add step
                                                </CButton>
                                              </CInputGroup>
                                              {testStepErrors.action && (
                                                <CFormFeedback invalid className="d-block">
                                                  {testStepErrors.action.message}
                                                </CFormFeedback>
                                              )}
                                              {testStepApiError && (
                                                <CAlert color="danger" role="alert" className="py-1">
                                                  {testStepApiError}
                                                </CAlert>
                                              )}
                                            </CForm>
                                          </div>
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

            {/*
              ADR-0026 / UI Design Document §7: the 20 project-scoped
              generic-admin entities, linked from this bespoke screen's own
              body (the sidebar has no project-context nav today) —
              generated from the registry (`pages/admin/registry.ts`), never
              a hardcoded literal per entity. No link points back from here
              into `projects`/`releases`' own generic admin pages beyond
              what's already in this list — §6's "no cross-link from a
              bespoke screen into its own entity's generic page" is about
              *this* project/release, not about the other 18 entities.
            */}
            <CCard className="mt-4">
              <CCardBody className="p-4">
                <h2 className="fs-5 mb-3">Admin</h2>
                <CListGroup>
                  {projectScopedEntities.map((item) => (
                    <CListGroupItem
                      key={item.key}
                      as={Link}
                      to={`/projects/${projectId}/admin/${item.key}`}
                      data-testid={`project-admin-link-${item.key}`}
                    >
                      {item.label}
                    </CListGroupItem>
                  ))}
                </CListGroup>
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>
      </CContainer>

      <CModal visible={showTestCaseModal} onClose={closeTestCaseModal}>
        <CModalHeader>
          <CModalTitle>New Test Case</CModalTitle>
        </CModalHeader>
        <CForm onSubmit={handleSubmitTestCase(onSubmitTestCase)} noValidate>
          <CModalBody>
            <div className="mb-3">
              <CFormLabel htmlFor="testCaseTitle">Title</CFormLabel>
              <CFormInput
                id="testCaseTitle"
                type="text"
                invalid={!!testCaseErrors.title}
                {...registerTestCase("title")}
              />
              {testCaseErrors.title && <CFormFeedback invalid>{testCaseErrors.title.message}</CFormFeedback>}
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="testCasePreconditions">Preconditions</CFormLabel>
              <CFormTextarea id="testCasePreconditions" rows={2} {...registerTestCase("preconditions")} />
              <CFormText>Optional.</CFormText>
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="testCaseExpectedResult">Expected result</CFormLabel>
              <CFormTextarea id="testCaseExpectedResult" rows={2} {...registerTestCase("expectedResult")} />
              <CFormText>Optional.</CFormText>
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="testCaseTestLevel">Test level</CFormLabel>
              <CFormSelect
                id="testCaseTestLevel"
                invalid={!!testCaseErrors.testLevelId}
                {...registerTestCase("testLevelId")}
              >
                <option value="">Select a test level…</option>
                {testLevels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.name}
                  </option>
                ))}
              </CFormSelect>
              {testCaseErrors.testLevelId && (
                <CFormFeedback invalid>{testCaseErrors.testLevelId.message}</CFormFeedback>
              )}
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="testCaseTestType">Test type</CFormLabel>
              <CFormSelect
                id="testCaseTestType"
                invalid={!!testCaseErrors.testTypeId}
                {...registerTestCase("testTypeId")}
              >
                <option value="">Select a test type…</option>
                {testTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </CFormSelect>
              {testCaseErrors.testTypeId && <CFormFeedback invalid>{testCaseErrors.testTypeId.message}</CFormFeedback>}
            </div>
            {testCaseApiError && (
              <CAlert color="danger" role="alert">
                {testCaseApiError}
              </CAlert>
            )}
          </CModalBody>
          <CModalFooter>
            <CButton color="secondary" variant="outline" onClick={closeTestCaseModal}>
              Cancel
            </CButton>
            <CButton type="submit" color="primary" disabled={isSubmittingTestCase}>
              {isSubmittingTestCase ? "Creating..." : "Create"}
            </CButton>
          </CModalFooter>
        </CForm>
      </CModal>

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
