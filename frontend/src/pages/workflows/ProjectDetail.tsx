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
 * REQ-3 (ADR-0028, UI Design Document 2026-09-06): the rigor path hangs off
 * that same Requirement list rather than a dedicated `RequirementDetail` page
 * (the Sitemap's stale 2026-09-05 reservation) — each Requirement row expands
 * (`CCollapse`) into its own TestCondition list, lazily fetched on first
 * expand, with a "New Test Condition" modal per requirement and a "New Test
 * Case" modal per condition. Two more independent `useForm` instances, same
 * per-section convention as above (four forms on this page now, none shared).
 * No per-condition TestCase list is rendered: no backend route lists
 * TestCases by condition (explicit YAGNI, ADR-0028's design spec), so the
 * create modal confirms with a `CToast` instead.
 *
 * None of the REQ-3 buttons are permission-hidden/disabled — this is a
 * bespoke workflow screen, so it keeps this page's existing attempt-then-
 * error convention (a 403 surfaces as the modal's inline `CAlert`), not the
 * generic admin surface's ADR-0027 hide/disable rule.
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
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CCol,
  CCollapse,
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
  CToast,
  CToastBody,
  CToaster,
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
import {
  createTestCondition,
  listTestConditions,
  TestConditionPriority,
  TestConditionSummary,
} from "../../lib/api/testConditions";
import { createTestCaseForTestCondition } from "../../lib/api/testCases";
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

const TEST_CONDITION_PRIORITIES: readonly TestConditionPriority[] = ["low", "medium", "high"];

/**
 * REQ-3 TestCondition form. `priority` is typed as a plain `string` rather
 * than `z.enum([...])` so the select can start on an empty "choose one"
 * option (`""` isn't a member of the enum, so a `z.enum` schema couldn't be
 * given an empty default without a cast); the `refine` still rejects anything
 * outside `low|medium|high`, which is the actual validation ADR-0028's design
 * asks for. The value is narrowed back to `TestConditionPriority` at the
 * submit boundary, where the refine has already guaranteed membership.
 */
const newTestConditionSchema = z.object({
  description: z.string().trim().min(1, "Description is required"),
  priority: z
    .string()
    .refine((value) => (TEST_CONDITION_PRIORITIES as readonly string[]).includes(value), {
      message: "Priority is required",
    }),
});

type NewTestConditionFormValues = z.infer<typeof newTestConditionSchema>;

/**
 * REQ-3 TestCase form. `testLevelId`/`testTypeId` are select-driven, so
 * "required" here really means "a selection was made" — surfaced as the same
 * required-field `CFormFeedback` message as any other field (ADR-0023's
 * `FormField` convention, which this page applies inline).
 */
const newTestCaseSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  preconditions: z.string().trim().optional(),
  expectedResult: z.string().trim().optional(),
  testLevelId: z.string().trim().min(1, "Test level is required"),
  testTypeId: z.string().trim().min(1, "Test type is required"),
});

type NewTestCaseFormValues = z.infer<typeof newTestCaseSchema>;

const TEST_CASE_CREATED_MESSAGE = "Test case created and linked to this test condition";

function priorityColor(priority: TestConditionPriority): string {
  switch (priority) {
    case "high":
      return "danger";
    case "medium":
      return "warning";
    default:
      return "secondary";
  }
}

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

  // --- REQ-3: per-Requirement TestCondition sections + the two create modals ---
  //
  // Keyed by requirement id rather than a single "expanded row" id (the
  // Releases section's own shape above): several Requirement rows may be
  // expanded at once here, and each keeps its own fetched list/loading/error
  // so collapsing one doesn't discard another's data.
  const [expandedRequirementIds, setExpandedRequirementIds] = useState<string[]>([]);
  const [conditionsByRequirement, setConditionsByRequirement] = useState<
    Record<string, TestConditionSummary[]>
  >({});
  const [conditionsLoading, setConditionsLoading] = useState<Record<string, boolean>>({});
  const [conditionsError, setConditionsError] = useState<Record<string, string | null>>({});

  // Global taxonomy catalog for the "New Test Case" modal's two selects —
  // fetched once per page load (not per modal open), per the UI design.
  const [testLevels, setTestLevels] = useState<TestLevelSummary[]>([]);
  const [testTypes, setTestTypes] = useState<TestTypeSummary[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // `null` = modal closed; otherwise the parent id the modal writes under.
  const [conditionModalRequirementId, setConditionModalRequirementId] = useState<string | null>(null);
  const [conditionApiError, setConditionApiError] = useState<string | null>(null);
  const [testCaseModalConditionId, setTestCaseModalConditionId] = useState<string | null>(null);
  const [testCaseApiError, setTestCaseApiError] = useState<string | null>(null);

  // `id` bumps per toast so a second confirmation re-mounts `CToast` (it
  // unmounts itself on exit) instead of silently reusing a hidden instance.
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);

  const {
    register: registerCondition,
    handleSubmit: handleSubmitCondition,
    reset: resetCondition,
    setError: setConditionError,
    formState: { errors: conditionErrors, isSubmitting: isSubmittingCondition },
  } = useForm<NewTestConditionFormValues>({
    resolver: zodResolver(newTestConditionSchema),
    defaultValues: { description: "", priority: "" },
  });

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

  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      try {
        const [levels, types] = await Promise.all([listTestLevels(), listTestTypes()]);
        if (cancelled) {
          return;
        }
        setTestLevels(levels.items);
        setTestTypes(types.items);
      } catch (err) {
        if (!cancelled) {
          setCatalogError(
            err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
          );
        }
      }
    }
    loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchTestConditions = useCallback(async (requirementId: string) => {
    setConditionsLoading((prev) => ({ ...prev, [requirementId]: true }));
    setConditionsError((prev) => ({ ...prev, [requirementId]: null }));
    try {
      const response = await listTestConditions(requirementId);
      setConditionsByRequirement((prev) => ({ ...prev, [requirementId]: response.items }));
    } catch (err) {
      setConditionsError((prev) => ({
        ...prev,
        [requirementId]:
          err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      }));
    } finally {
      setConditionsLoading((prev) => ({ ...prev, [requirementId]: false }));
    }
  }, []);

  function toggleTestConditions(requirementId: string) {
    const isExpanded = expandedRequirementIds.includes(requirementId);
    setExpandedRequirementIds((prev) =>
      isExpanded ? prev.filter((id) => id !== requirementId) : [...prev, requirementId],
    );
    // Lazy: fetched on first expand only, never on page load and never again
    // on a re-expand (a create refreshes it explicitly instead).
    if (!isExpanded && conditionsByRequirement[requirementId] === undefined) {
      fetchTestConditions(requirementId);
    }
  }

  function openConditionModal(requirementId: string) {
    setConditionApiError(null);
    resetCondition({ description: "", priority: "" });
    setConditionModalRequirementId(requirementId);
  }

  function closeConditionModal() {
    setConditionModalRequirementId(null);
  }

  async function onSubmitTestCondition(values: NewTestConditionFormValues) {
    const requirementId = conditionModalRequirementId;
    if (!requirementId) {
      return;
    }
    setConditionApiError(null);
    try {
      await createTestCondition(requirementId, {
        description: values.description,
        // Narrowing is safe: the schema's `refine` already rejected anything
        // outside `TEST_CONDITION_PRIORITIES`.
        priority: values.priority as TestConditionPriority,
      });
      closeConditionModal();
      await fetchTestConditions(requirementId);
    } catch (err) {
      if (err instanceof ApiError) {
        const descriptionError = fieldError(err, "description");
        const priorityError = fieldError(err, "priority");
        if (descriptionError) {
          setConditionError("description", { type: "server", message: descriptionError });
        } else if (priorityError) {
          setConditionError("priority", { type: "server", message: priorityError });
        } else {
          setConditionApiError(err.message);
        }
      } else {
        setConditionApiError("Something went wrong. Please try again.");
      }
    }
  }

  function openTestCaseModal(testConditionId: string) {
    setTestCaseApiError(null);
    resetTestCase({ title: "", preconditions: "", expectedResult: "", testLevelId: "", testTypeId: "" });
    setTestCaseModalConditionId(testConditionId);
  }

  function closeTestCaseModal() {
    setTestCaseModalConditionId(null);
  }

  async function onSubmitTestCase(values: NewTestCaseFormValues) {
    const testConditionId = testCaseModalConditionId;
    if (!testConditionId) {
      return;
    }
    setTestCaseApiError(null);
    try {
      await createTestCaseForTestCondition(testConditionId, {
        title: values.title,
        // Omitted (not sent as an empty string) when blank, matching the
        // backend's `str | None = None` optional-field convention.
        ...(values.preconditions ? { preconditions: values.preconditions } : {}),
        ...(values.expectedResult ? { expected_result: values.expectedResult } : {}),
        test_level_id: values.testLevelId,
        test_type_id: values.testTypeId,
      });
      closeTestCaseModal();
      // No list to re-fetch — no backend route lists TestCases by condition
      // (ADR-0028 YAGNI), so a toast is the only success feedback.
      setToast((prev) => ({ id: (prev?.id ?? 0) + 1, message: TEST_CASE_CREATED_MESSAGE }));
    } catch (err) {
      if (err instanceof ApiError) {
        const titleError = fieldError(err, "title");
        const levelError = fieldError(err, "test_level_id");
        const typeError = fieldError(err, "test_type_id");
        if (titleError) {
          setTestCaseError("title", { type: "server", message: titleError });
        } else if (levelError) {
          setTestCaseError("testLevelId", { type: "server", message: levelError });
        } else if (typeError) {
          setTestCaseError("testTypeId", { type: "server", message: typeError });
        } else {
          setTestCaseApiError(err.message);
        }
      } else {
        setTestCaseApiError("Something went wrong. Please try again.");
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
                        <CTableHeaderCell>Test conditions</CTableHeaderCell>
                      </CTableRow>
                    </CTableHead>
                    <CTableBody>
                      {requirements.map((requirement) => {
                        const expanded = expandedRequirementIds.includes(requirement.id);
                        const conditions = conditionsByRequirement[requirement.id] ?? [];
                        const loadingConditions = conditionsLoading[requirement.id] ?? false;
                        const conditionsLoadError = conditionsError[requirement.id] ?? null;
                        return (
                          <Fragment key={requirement.id}>
                            <CTableRow>
                              <CTableDataCell>{requirement.title}</CTableDataCell>
                              <CTableDataCell>{dashIfEmpty(requirement.external_ref)}</CTableDataCell>
                              <CTableDataCell>{dashIfEmpty(requirement.source)}</CTableDataCell>
                              <CTableDataCell>
                                <CButton
                                  color="link"
                                  className="p-0 text-decoration-none"
                                  aria-expanded={expanded}
                                  data-testid={`tc-section-toggle-${requirement.id}`}
                                  onClick={() => toggleTestConditions(requirement.id)}
                                >
                                  Test conditions {expanded ? "▲" : "▼"}
                                </CButton>
                              </CTableDataCell>
                            </CTableRow>
                            <CTableRow>
                              <CTableDataCell colSpan={4} className="p-0 border-0">
                                <CCollapse visible={expanded}>
                                  {/*
                                    Content is mounted only while expanded, so
                                    the collapsed state costs nothing and a
                                    never-expanded requirement never fetches
                                    (the "lazy on first expand" rule).
                                  */}
                                  {expanded && (
                                    <div className="bg-body-tertiary p-3">
                                      <div className="d-flex justify-content-between align-items-center mb-2">
                                        <h3 className="fs-6 mb-0">Test conditions</h3>
                                        <CButton
                                          color="primary"
                                          size="sm"
                                          data-testid={`new-test-condition-btn-${requirement.id}`}
                                          onClick={() => openConditionModal(requirement.id)}
                                        >
                                          New Test Condition
                                        </CButton>
                                      </div>

                                      {conditionsLoadError && (
                                        <CAlert color="danger" role="alert">
                                          {conditionsLoadError}
                                        </CAlert>
                                      )}

                                      {loadingConditions ? (
                                        <div className="d-flex justify-content-center py-2">
                                          <CSpinner size="sm" color="primary" />
                                        </div>
                                      ) : !conditionsLoadError && conditions.length === 0 ? (
                                        <p className="text-body-secondary mb-0">No test conditions yet.</p>
                                      ) : (
                                        !conditionsLoadError && (
                                          <CTable small responsive className="mb-0">
                                            <CTableHead>
                                              <CTableRow>
                                                <CTableHeaderCell>Description</CTableHeaderCell>
                                                <CTableHeaderCell>Priority</CTableHeaderCell>
                                                <CTableHeaderCell />
                                              </CTableRow>
                                            </CTableHead>
                                            <CTableBody>
                                              {conditions.map((condition) => (
                                                <CTableRow
                                                  key={condition.id}
                                                  data-testid={`test-condition-row-${condition.id}`}
                                                >
                                                  <CTableDataCell>{condition.description}</CTableDataCell>
                                                  <CTableDataCell>
                                                    <CBadge color={priorityColor(condition.priority)}>
                                                      {condition.priority}
                                                    </CBadge>
                                                  </CTableDataCell>
                                                  <CTableDataCell className="text-end">
                                                    <CButton
                                                      color="secondary"
                                                      variant="outline"
                                                      size="sm"
                                                      data-testid={`new-test-case-btn-${condition.id}`}
                                                      onClick={() => openTestCaseModal(condition.id)}
                                                    >
                                                      New Test Case
                                                    </CButton>
                                                  </CTableDataCell>
                                                </CTableRow>
                                              ))}
                                            </CTableBody>
                                          </CTable>
                                        )
                                      )}
                                    </div>
                                  )}
                                </CCollapse>
                              </CTableDataCell>
                            </CTableRow>
                          </Fragment>
                        );
                      })}
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

      <CModal
        visible={conditionModalRequirementId !== null}
        onClose={closeConditionModal}
        data-testid="test-condition-modal"
      >
        <CModalHeader>
          <CModalTitle>New Test Condition</CModalTitle>
        </CModalHeader>
        <CForm onSubmit={handleSubmitCondition(onSubmitTestCondition)} noValidate>
          <CModalBody>
            <div className="mb-3">
              <CFormLabel htmlFor="testConditionDescription">Description</CFormLabel>
              <CFormTextarea
                id="testConditionDescription"
                rows={3}
                data-testid="test-condition-description"
                invalid={!!conditionErrors.description}
                {...registerCondition("description")}
              />
              {conditionErrors.description && (
                <CFormFeedback invalid>{conditionErrors.description.message}</CFormFeedback>
              )}
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="testConditionPriority">Priority</CFormLabel>
              <CFormSelect
                id="testConditionPriority"
                data-testid="test-condition-priority"
                invalid={!!conditionErrors.priority}
                {...registerCondition("priority")}
              >
                <option value="">Select a priority…</option>
                {TEST_CONDITION_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </CFormSelect>
              {conditionErrors.priority && (
                <CFormFeedback invalid>{conditionErrors.priority.message}</CFormFeedback>
              )}
            </div>
            {conditionApiError && (
              <CAlert color="danger" role="alert">
                {conditionApiError}
              </CAlert>
            )}
          </CModalBody>
          <CModalFooter>
            <CButton color="secondary" variant="outline" onClick={closeConditionModal}>
              Cancel
            </CButton>
            <CButton
              type="submit"
              color="primary"
              data-testid="test-condition-submit"
              disabled={isSubmittingCondition}
            >
              {isSubmittingCondition ? "Creating..." : "Create"}
            </CButton>
          </CModalFooter>
        </CForm>
      </CModal>

      <CModal
        visible={testCaseModalConditionId !== null}
        onClose={closeTestCaseModal}
        data-testid="test-case-modal"
      >
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
                data-testid="test-case-title"
                invalid={!!testCaseErrors.title}
                {...registerTestCase("title")}
              />
              {testCaseErrors.title && <CFormFeedback invalid>{testCaseErrors.title.message}</CFormFeedback>}
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="testCasePreconditions">Preconditions</CFormLabel>
              <CFormTextarea
                id="testCasePreconditions"
                rows={2}
                data-testid="test-case-preconditions"
                {...registerTestCase("preconditions")}
              />
              <CFormText>Optional.</CFormText>
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="testCaseExpectedResult">Expected result</CFormLabel>
              <CFormTextarea
                id="testCaseExpectedResult"
                rows={2}
                data-testid="test-case-expected-result"
                {...registerTestCase("expectedResult")}
              />
              <CFormText>Optional.</CFormText>
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="testCaseTestLevel">Test level</CFormLabel>
              <CFormSelect
                id="testCaseTestLevel"
                data-testid="test-case-test-level"
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
                data-testid="test-case-test-type"
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
              {testCaseErrors.testTypeId && (
                <CFormFeedback invalid>{testCaseErrors.testTypeId.message}</CFormFeedback>
              )}
            </div>
            {/*
              Catalog-load failure is a non-field error, so it uses this
              page's page-level `CAlert` convention (ADR-0023) — the two
              selects simply render empty, and the required-field validation
              above is what blocks an unselectable submit.
            */}
            {catalogError && (
              <CAlert color="warning" role="alert">
                {catalogError}
              </CAlert>
            )}
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
            <CButton
              type="submit"
              color="primary"
              data-testid="test-case-submit"
              disabled={isSubmittingTestCase}
            >
              {isSubmittingTestCase ? "Creating..." : "Create"}
            </CButton>
          </CModalFooter>
        </CForm>
      </CModal>

      <CToaster placement="top-end">
        {toast && (
          <CToast key={toast.id} visible color="success" data-testid="test-case-created-toast">
            <CToastBody>{toast.message}</CToastBody>
          </CToast>
        )}
      </CToaster>

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
