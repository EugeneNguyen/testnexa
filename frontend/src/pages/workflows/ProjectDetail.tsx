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
 * query) — read-only, no edit UI, this is an audit view only. PLAN-2
 * (ADR-0032) adds each cycle's parent plan's `exit`-type EntryExitCriteria to
 * that same expanded row, as a second flat `<ul>` above the executions one, so
 * exit criteria and execution progress are visible in one view without a
 * separate lookup. Read-only there too: criteria are edited only on
 * `TestPlanDetail`'s own section.
 *
 * REQ-1 (ADR-0022/ADR-0025): a second, independent section on this same page
 * — Requirement list (searchable by `?q=` title/description/external_ref/
 * source substring, per FR-REQ-1's own AC) + "New Requirement" modal, same
 * RHF+Zod+CoreUI convention as "New Release" above, its own separate
 * `useForm` instance (two independent forms on one page, not a shared one).
 *
 * REQ-2 (ADR-0006): each Requirement row itself is click-to-expand (same
 * convention the Release rows above already use) to list its directly-linked
 * TestCases (`GET /requirements/{id}/test-cases`, no TestCondition anywhere
 * in the chain) + a "New Test Case" modal. Each TestCase row itself expands
 * one level further to list/add/edit its TestSteps — independently
 * editable, ordered by `sequence`.
 *
 * REQ-3 (ADR-0028, UI Design Document 2026-09-06): the rigor path hangs off
 * that same Requirement list too, coexisting with REQ-2's direct-link
 * section per ADR-0006 (a Requirement can have both directly-linked
 * TestCases and TestCondition-mediated ones) rather than a dedicated
 * `RequirementDetail` page (the Sitemap's stale 2026-09-05 reservation) —
 * a dedicated "Test conditions" toggle button on each Requirement row (kept
 * independent of REQ-2's row-click expand, via its own `stopPropagation`)
 * expands (`CCollapse`) into its own TestCondition list, lazily fetched on
 * first expand, with a "New Test Condition" modal per requirement and a
 * "New Test Case" modal per condition. Two more independent `useForm`
 * instances beyond REQ-2's own two (Release/Requirement/TestCase/TestStep),
 * each section keeping its own separate instance rather than a shared one.
 * No per-condition TestCase list is rendered: no backend route lists
 * TestCases by condition (explicit YAGNI, ADR-0028's design spec), so the
 * create modal confirms with a `CToast` instead.
 *
 * The "New Test Case" modal itself (form fields, schema, RHF instance) is
 * shared verbatim between REQ-2's direct-link path and REQ-3's rigor path —
 * both need the exact same fields (title/preconditions/expected result/test
 * level/test type) and only one can be open at a time, so `onSubmitTestCase`
 * branches on which target id (`testCaseModalRequirementId` vs
 * `testCaseModalConditionId`) is set rather than duplicating the form.
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
  CDropdown,
  CDropdownItem,
  CDropdownMenu,
  CDropdownToggle,
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
  createTestCase,
  createTestCaseForTestCondition,
  listTestCasesForRequirement,
  listTestCasesForTestCondition,
  TestCaseSummary,
} from "../../lib/api/testCases";
import {
  addTestCaseToSuite,
  createTestSuite,
  listSuiteTestCases,
  listTestSuites,
  removeTestCaseFromSuite,
  TestSuiteSummary,
} from "../../lib/api/testSuites";
import { listTestPlans, TestPlanSummary } from "../../lib/api/testPlans";
import { createTestStep, listTestSteps, updateTestStep, TestStepSummary } from "../../lib/api/testSteps";
import {
  createTestCondition,
  listTestConditions,
  TestConditionPriority,
  TestConditionSummary,
} from "../../lib/api/testConditions";
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
 * Shared "New Test Case" form (REQ-2's direct-link path and REQ-3's rigor
 * path both use it — same fields either way). `testLevelId`/`testTypeId`
 * are select-driven, so "required" here really means "a selection was made"
 * — surfaced as the same required-field `CFormFeedback` message as any
 * other field (ADR-0023's `FormField` convention, which this page applies
 * inline).
 */
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
 * REQ-4 TestSuite form (UI Design Document §3): `name` required, `purpose`
 * free text with **no client-side enum restriction** — "regression"/"smoke"/
 * "acceptance" are conventional values, not schema-level ones (the column is a
 * nullable free-text string per the Database Document), so constraining them
 * here would invent a rule the backend doesn't have.
 */
const newTestSuiteSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  purpose: z.string().trim().optional(),
});

type NewTestSuiteFormValues = z.infer<typeof newTestSuiteSchema>;

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
 * PLAN-1 UI Design Document §2's TestPlan status colours — kept identical to
 * `TestPlanDetail.tsx`'s own mapping so a plan reads the same on both screens.
 */
function testPlanStatusColor(status: TestPlanSummary["status"]): string {
  switch (status) {
    case "approved":
      return "success";
    case "superseded":
      return "dark";
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

  // --- REQ-2: directly-linked TestCases per expanded Requirement row ------------------------
  const [expandedRequirementId, setExpandedRequirementId] = useState<string | null>(null);
  const [testCases, setTestCases] = useState<TestCaseSummary[]>([]);
  const [testCasesLoading, setTestCasesLoading] = useState(false);
  const [testCasesError, setTestCasesError] = useState<string | null>(null);

  const [showTestCaseModal, setShowTestCaseModal] = useState(false);
  const [testCaseModalRequirementId, setTestCaseModalRequirementId] = useState<string | null>(null);
  const [testCaseApiError, setTestCaseApiError] = useState<string | null>(null);

  // --- REQ-3: per-Requirement TestCondition sections + the two create modals ---
  //
  // Keyed by requirement id rather than a single "expanded row" id (REQ-2's
  // own shape above, which this section intentionally keeps independent of
  // — a Requirement's Test Cases section and its Test Conditions section
  // expand/collapse separately): several Requirement rows may have their
  // Test Conditions section expanded at once here, and each keeps its own
  // fetched list/loading/error so collapsing one doesn't discard another's
  // data.
  const [expandedRequirementIds, setExpandedRequirementIds] = useState<string[]>([]);
  const [conditionsByRequirement, setConditionsByRequirement] = useState<
    Record<string, TestConditionSummary[]>
  >({});
  const [conditionsLoading, setConditionsLoading] = useState<Record<string, boolean>>({});
  const [conditionsError, setConditionsError] = useState<Record<string, string | null>>({});

  // Global taxonomy catalog for the "New Test Case" modal's two selects —
  // fetched once per page load (not per modal open), per the UI design.
  // Shared by both REQ-2's and REQ-3's "New Test Case" modals.
  const [testLevels, setTestLevels] = useState<TestLevelSummary[]>([]);
  const [testTypes, setTestTypes] = useState<TestTypeSummary[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // `null` = modal closed; otherwise the parent id the modal writes under.
  const [conditionModalRequirementId, setConditionModalRequirementId] = useState<string | null>(null);
  const [conditionApiError, setConditionApiError] = useState<string | null>(null);
  const [testCaseModalConditionId, setTestCaseModalConditionId] = useState<string | null>(null);

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

  // Shared "New Test Case" form instance — REQ-2's direct-link modal and
  // REQ-3's per-condition modal both bind to this one RHF instance, since
  // only one of the two modals can ever be open at a time (see module
  // docstring). `onSubmitTestCase` below branches on which target id is set.
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

  // --- REQ-4 (ADR-0030, UI Design Document 2026-09-06): Test Suites section ---
  //
  // A top-level section of its own (alongside Releases/Requirements), not a
  // child of any Requirement — a TestSuite is project-scoped, not
  // requirement-scoped.
  const [testSuites, setTestSuites] = useState<TestSuiteSummary[]>([]);
  const [suitesLoading, setSuitesLoading] = useState(true);
  const [suitesLoadError, setSuitesLoadError] = useState<string | null>(null);
  const [showSuiteModal, setShowSuiteModal] = useState(false);
  const [suiteApiError, setSuiteApiError] = useState<string | null>(null);

  // Membership of whichever suite row is currently expanded (one at a time,
  // same single-active-expansion convention as the Release rows above).
  //
  // Deliberately NOT keyed-by-id/cached the way the TestCondition sections
  // above are: AC2's "reflects current membership" means this list is
  // re-fetched on *every* expand, never restored from a previous one, so a
  // membership changed elsewhere (or in another tab) can't be shown stale.
  // PLAN-1: the project's TestPlans — a plain linked list, no create/expand
  // here (creation stays on the generic admin surface, detail lives on
  // `TestPlanDetail`).
  const [testPlans, setTestPlans] = useState<TestPlanSummary[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansLoadError, setPlansLoadError] = useState<string | null>(null);

  const [expandedSuiteId, setExpandedSuiteId] = useState<string | null>(null);
  const [suiteMembers, setSuiteMembers] = useState<TestCaseSummary[]>([]);
  const [suiteMembersLoading, setSuiteMembersLoading] = useState(false);
  const [suiteMembersError, setSuiteMembersError] = useState<string | null>(null);

  // REQ-4 also fills the gap REQ-3 left open (ADR-0028's YAGNI call): the list
  // of TestCases under a TestCondition, so each one can carry an "Add to
  // suite" action. Keyed by condition id, same shape as the condition lists.
  const [expandedConditionIds, setExpandedConditionIds] = useState<string[]>([]);
  const [casesByCondition, setCasesByCondition] = useState<Record<string, TestCaseSummary[]>>({});
  const [conditionCasesLoading, setConditionCasesLoading] = useState<Record<string, boolean>>({});
  const [conditionCasesError, setConditionCasesError] = useState<Record<string, string | null>>({});

  // Per-TestCase inline feedback for the "Add to suite" dropdown — keyed by
  // test case id so a 422/409 stays next to the row it applies to (UI Design
  // Document §2: an inline dismissible `CAlert`, never a toast).
  const [addToSuiteError, setAddToSuiteError] = useState<Record<string, string | null>>({});

  const {
    register: registerSuite,
    handleSubmit: handleSubmitSuite,
    reset: resetSuite,
    setError: setSuiteError,
    formState: { errors: suiteErrors, isSubmitting: isSubmittingSuite },
  } = useForm<NewTestSuiteFormValues>({
    resolver: zodResolver(newTestSuiteSchema),
    defaultValues: { name: "", purpose: "" },
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
    setTestCaseModalConditionId(null);
    setTestCaseModalRequirementId(requirementId);
    setShowTestCaseModal(true);
  }

  function closeTestCaseModal() {
    setShowTestCaseModal(false);
    setTestCaseModalRequirementId(null);
    setTestCaseModalConditionId(null);
  }

  /**
   * Shared submit handler for both "New Test Case" modals — branches on
   * which target id is currently set. REQ-2's direct-link path
   * (`testCaseModalRequirementId`) creates via `createTestCase` and
   * re-fetches that requirement's TestCase list; REQ-3's rigor path
   * (`testCaseModalConditionId`) creates via `createTestCaseForTestCondition`
   * and confirms with a toast instead (no per-condition list to re-fetch,
   * ADR-0028 YAGNI).
   */
  async function onSubmitTestCase(values: NewTestCaseFormValues) {
    if (testCaseModalRequirementId) {
      const requirementId = testCaseModalRequirementId;
      setTestCaseApiError(null);
      try {
        await createTestCase(requirementId, {
          title: values.title,
          test_level_id: values.testLevelId,
          test_type_id: values.testTypeId,
          ...(values.preconditions ? { preconditions: values.preconditions } : {}),
          ...(values.expectedResult ? { expected_result: values.expectedResult } : {}),
        });
        closeTestCaseModal();
        await fetchTestCases(requirementId);
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
      return;
    }

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

  function openConditionTestCaseModal(testConditionId: string) {
    setTestCaseApiError(null);
    resetTestCase({ title: "", preconditions: "", expectedResult: "", testLevelId: "", testTypeId: "" });
    setTestCaseModalRequirementId(null);
    setTestCaseModalConditionId(testConditionId);
  }

  // --- REQ-4: Test Suites section + membership actions ------------------------

  const fetchTestSuites = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setSuitesLoading(true);
    setSuitesLoadError(null);
    try {
      const response = await listTestSuites(projectId);
      setTestSuites(response.items);
    } catch (err) {
      setSuitesLoadError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setSuitesLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchTestSuites();
  }, [fetchTestSuites]);

  function openSuiteModal() {
    setSuiteApiError(null);
    resetSuite({ name: "", purpose: "" });
    setShowSuiteModal(true);
  }

  function closeSuiteModal() {
    setShowSuiteModal(false);
  }

  async function onSubmitTestSuite(values: NewTestSuiteFormValues) {
    if (!projectId) {
      return;
    }
    setSuiteApiError(null);
    try {
      await createTestSuite(projectId, {
        name: values.name,
        // Blank optional field omitted rather than sent as an empty string,
        // same convention as the "New Test Case" modal's optional fields.
        ...(values.purpose ? { purpose: values.purpose } : {}),
      });
      closeSuiteModal();
      await fetchTestSuites();
    } catch (err) {
      if (err instanceof ApiError) {
        const nameError = fieldError(err, "name");
        const purposeError = fieldError(err, "purpose");
        if (nameError) {
          setSuiteError("name", { type: "server", message: nameError });
        } else if (purposeError) {
          setSuiteError("purpose", { type: "server", message: purposeError });
        } else {
          setSuiteApiError(err.message);
        }
      } else {
        setSuiteApiError("Something went wrong. Please try again.");
      }
    }
  }

  const fetchSuiteMembers = useCallback(async (testSuiteId: string) => {
    setSuiteMembersLoading(true);
    setSuiteMembersError(null);
    try {
      const response = await listSuiteTestCases(testSuiteId);
      setSuiteMembers(response.items);
    } catch (err) {
      setSuiteMembersError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setSuiteMembersLoading(false);
    }
  }, []);

  function toggleSuiteMembership(testSuiteId: string) {
    if (expandedSuiteId === testSuiteId) {
      setExpandedSuiteId(null);
      return;
    }
    setExpandedSuiteId(testSuiteId);
    setSuiteMembers([]);
    // Re-fetched on EVERY expand, never restored from a previous one — the
    // literal mechanism behind AC2's "reflects current membership" claim.
    fetchSuiteMembers(testSuiteId);
  }

  async function onRemoveFromSuite(testSuiteId: string, testCaseId: string) {
    setSuiteMembersError(null);
    try {
      await removeTestCaseFromSuite(testSuiteId, testCaseId);
    } catch (err) {
      setSuiteMembersError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
    }
    // Re-fetch either way (not an optimistic local splice), so the view always
    // reflects the server's own current state — including after a failed
    // remove, where the case is still a member.
    await fetchSuiteMembers(testSuiteId);
  }

  const fetchConditionTestCases = useCallback(async (testConditionId: string) => {
    setConditionCasesLoading((prev) => ({ ...prev, [testConditionId]: true }));
    setConditionCasesError((prev) => ({ ...prev, [testConditionId]: null }));
    try {
      const items = await listTestCasesForTestCondition(testConditionId);
      setCasesByCondition((prev) => ({ ...prev, [testConditionId]: items }));
    } catch (err) {
      setConditionCasesError((prev) => ({
        ...prev,
        [testConditionId]:
          err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      }));
    } finally {
      setConditionCasesLoading((prev) => ({ ...prev, [testConditionId]: false }));
    }
  }, []);

  function toggleConditionTestCases(testConditionId: string) {
    const isExpanded = expandedConditionIds.includes(testConditionId);
    setExpandedConditionIds((prev) =>
      isExpanded ? prev.filter((id) => id !== testConditionId) : [...prev, testConditionId],
    );
    if (!isExpanded && casesByCondition[testConditionId] === undefined) {
      fetchConditionTestCases(testConditionId);
    }
  }

  async function onAddTestCaseToSuite(testSuiteId: string, testCaseId: string) {
    setAddToSuiteError((prev) => ({ ...prev, [testCaseId]: null }));
    try {
      await addTestCaseToSuite(testSuiteId, testCaseId);
    } catch (err) {
      // `409 already_in_suite` and `422 validation_error` (cross-project) both
      // surface here as the route's own message, inline next to this row — the
      // reason has to stay visible where it applies (UI Design Document §2).
      setAddToSuiteError((prev) => ({
        ...prev,
        [testCaseId]:
          err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      }));
      return;
    }
    // If the target suite happens to be the one currently expanded above, its
    // membership view must show the addition immediately.
    if (expandedSuiteId === testSuiteId) {
      await fetchSuiteMembers(testSuiteId);
    }
  }

  function dismissAddToSuiteError(testCaseId: string) {
    setAddToSuiteError((prev) => ({ ...prev, [testCaseId]: null }));
  }

  // --- PLAN-1 (ADR-0031, UI Design Document §1): Test Plans list ------------
  //
  // The one section on this page whose rows *link out* (to
  // `/projects/:projectId/test-plans/:testPlanId`) instead of expanding in
  // place — a TestPlan is its own multi-part object with its own detail route,
  // not one more facet of the Requirement→TestCase flow this page anchors.
  const fetchTestPlans = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setPlansLoading(true);
    setPlansLoadError(null);
    try {
      const response = await listTestPlans(projectId);
      setTestPlans(response.items);
    } catch (err) {
      setPlansLoadError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setPlansLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchTestPlans();
  }, [fetchTestPlans]);

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
                                        {/*
                                          PLAN-2 (ADR-0032, UI Design Document
                                          §2): the parent plan's `exit` criteria,
                                          read-only, above the executions list in
                                          this same <li>. Rendered as-is — the
                                          backend already filtered to `type =
                                          exit`, so there is deliberately no
                                          client-side filter here. Flat <ul>, not
                                          a nested <CTable> (frontend/CLAUDE.md).
                                        */}
                                        <div
                                          className="small text-body-secondary"
                                          data-testid={`cycle-exit-criteria-label-${cycle.id}`}
                                        >
                                          Exit criteria:
                                        </div>
                                        {cycle.exit_criteria.length === 0 ? (
                                          <div
                                            className="text-body-secondary small"
                                            data-testid={`cycle-exit-criteria-empty-${cycle.id}`}
                                          >
                                            No exit criteria defined.
                                          </div>
                                        ) : (
                                          <ul data-testid={`cycle-exit-criteria-${cycle.id}`}>
                                            {cycle.exit_criteria.map((criteria) => (
                                              <li
                                                key={criteria.id}
                                                className="small"
                                                data-testid={`cycle-exit-criterion-${criteria.id}`}
                                              >
                                                {criteria.condition_text}
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                        {/*
                                          The matching "Executions:" label from
                                          PLAN-2 UI Design Document §2's layout
                                          sketch. Added so the two sub-lists in
                                          this cell are symmetrically labelled —
                                          §2 shows both. The executions list
                                          itself, and its "No executions yet."
                                          copy, are unchanged from ADR-0019.
                                        */}
                                        <div
                                          className="small text-body-secondary"
                                          data-testid={`cycle-executions-label-${cycle.id}`}
                                        >
                                          Executions:
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
                            <CTableRow
                              style={{ cursor: "pointer" }}
                              onClick={() => toggleRequirementExpand(requirement)}
                            >
                              <CTableDataCell>{requirement.title}</CTableDataCell>
                              <CTableDataCell>{dashIfEmpty(requirement.external_ref)}</CTableDataCell>
                              <CTableDataCell>{dashIfEmpty(requirement.source)}</CTableDataCell>
                              <CTableDataCell>
                                <CButton
                                  color="link"
                                  className="p-0 text-decoration-none"
                                  aria-expanded={expanded}
                                  data-testid={`tc-section-toggle-${requirement.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleTestConditions(requirement.id);
                                  }}
                                >
                                  Test conditions {expanded ? "▲" : "▼"}
                                </CButton>
                              </CTableDataCell>
                            </CTableRow>
                            {expandedRequirementId === requirement.id && (
                              <CTableRow key={`${requirement.id}-detail`}>
                                <CTableDataCell colSpan={4} className="bg-body-tertiary">
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
                                              {conditions.map((condition) => {
                                                const casesExpanded = expandedConditionIds.includes(
                                                  condition.id,
                                                );
                                                const conditionCases =
                                                  casesByCondition[condition.id] ?? [];
                                                const loadingCases =
                                                  conditionCasesLoading[condition.id] ?? false;
                                                const casesLoadError =
                                                  conditionCasesError[condition.id] ?? null;
                                                return (
                                                  <Fragment key={condition.id}>
                                                    <CTableRow
                                                      data-testid={`test-condition-row-${condition.id}`}
                                                    >
                                                      <CTableDataCell>
                                                        {condition.description}
                                                      </CTableDataCell>
                                                      <CTableDataCell>
                                                        <CBadge color={priorityColor(condition.priority)}>
                                                          {condition.priority}
                                                        </CBadge>
                                                      </CTableDataCell>
                                                      <CTableDataCell className="text-end">
                                                        {/*
                                                          REQ-4: the TestCase
                                                          sub-list REQ-3
                                                          deliberately didn't
                                                          render (ADR-0028's
                                                          YAGNI call), now
                                                          needed so each case
                                                          can carry an "Add to
                                                          suite" action.
                                                        */}
                                                        <CButton
                                                          color="secondary"
                                                          variant="ghost"
                                                          size="sm"
                                                          className="me-2"
                                                          data-testid={`tc-cases-toggle-${condition.id}`}
                                                          aria-expanded={casesExpanded}
                                                          onClick={() =>
                                                            toggleConditionTestCases(condition.id)
                                                          }
                                                        >
                                                          Test Cases
                                                        </CButton>
                                                        <CButton
                                                          color="secondary"
                                                          variant="outline"
                                                          size="sm"
                                                          data-testid={`new-test-case-btn-${condition.id}`}
                                                          onClick={() =>
                                                            openConditionTestCaseModal(condition.id)
                                                          }
                                                        >
                                                          New Test Case
                                                        </CButton>
                                                      </CTableDataCell>
                                                    </CTableRow>
                                                    <CTableRow>
                                                      <CTableDataCell
                                                        colSpan={3}
                                                        className="p-0 border-0"
                                                      >
                                                        <CCollapse visible={casesExpanded}>
                                                          {casesExpanded && (
                                                            <div className="bg-body p-3">
                                                              {casesLoadError && (
                                                                <CAlert color="danger" role="alert">
                                                                  {casesLoadError}
                                                                </CAlert>
                                                              )}
                                                              {loadingCases ? (
                                                                <div className="d-flex justify-content-center py-2">
                                                                  <CSpinner size="sm" color="primary" />
                                                                </div>
                                                              ) : !casesLoadError &&
                                                                conditionCases.length === 0 ? (
                                                                <p className="text-body-secondary mb-0">
                                                                  No test cases yet.
                                                                </p>
                                                              ) : (
                                                                !casesLoadError && (
                                                                  /*
                                                                    Flat <ul>/<li>, never a nested
                                                                    <CTable>: a <table> inside
                                                                    another <table>'s <td> has no
                                                                    ARIA role boundary, so the outer
                                                                    row's accessible name would
                                                                    absorb these rows' text and make
                                                                    Playwright's getByRole("row")
                                                                    ambiguous (frontend/CLAUDE.md).
                                                                  */
                                                                  <ul
                                                                    className="list-unstyled mb-0"
                                                                    data-testid={`tc-case-list-${condition.id}`}
                                                                  >
                                                                    {conditionCases.map((testCase) => (
                                                                      <li
                                                                        key={testCase.id}
                                                                        className="d-flex flex-column border-bottom py-2"
                                                                        data-testid={`tc-case-item-${testCase.id}`}
                                                                      >
                                                                        <div className="d-flex justify-content-between align-items-center gap-2">
                                                                          <span>
                                                                            {testCase.title}{" "}
                                                                            <CBadge color="secondary">
                                                                              {testCase.status}
                                                                            </CBadge>
                                                                          </span>
                                                                          <CDropdown variant="btn-group">
                                                                            <CDropdownToggle
                                                                              color="secondary"
                                                                              variant="outline"
                                                                              size="sm"
                                                                              disabled={
                                                                                testSuites.length === 0
                                                                              }
                                                                              data-testid={`add-to-suite-toggle-${testCase.id}`}
                                                                            >
                                                                              Add to suite
                                                                            </CDropdownToggle>
                                                                            <CDropdownMenu>
                                                                              {/*
                                                                                Empty-state is a
                                                                                disabled toggle plus
                                                                                this placeholder, not
                                                                                a hidden control, so
                                                                                the ordering
                                                                                dependency (create a
                                                                                suite first) stays
                                                                                visible (UI Design
                                                                                Document §4).
                                                                              */}
                                                                              {testSuites.length === 0 ? (
                                                                                <CDropdownItem
                                                                                  disabled
                                                                                  data-testid={`add-to-suite-empty-${testCase.id}`}
                                                                                >
                                                                                  No suites yet — create
                                                                                  one above
                                                                                </CDropdownItem>
                                                                              ) : (
                                                                                testSuites.map((suite) => (
                                                                                  <CDropdownItem
                                                                                    key={suite.id}
                                                                                    role="button"
                                                                                    data-testid={`add-to-suite-${testCase.id}-${suite.id}`}
                                                                                    onClick={() =>
                                                                                      onAddTestCaseToSuite(
                                                                                        suite.id,
                                                                                        testCase.id,
                                                                                      )
                                                                                    }
                                                                                  >
                                                                                    {suite.name}
                                                                                  </CDropdownItem>
                                                                                ))
                                                                              )}
                                                                            </CDropdownMenu>
                                                                          </CDropdown>
                                                                        </div>
                                                                        {addToSuiteError[testCase.id] && (
                                                                          <CAlert
                                                                            color="danger"
                                                                            role="alert"
                                                                            dismissible
                                                                            className="mt-2 mb-0 py-1"
                                                                            data-testid={`add-to-suite-error-${testCase.id}`}
                                                                            onClose={() =>
                                                                              dismissAddToSuiteError(
                                                                                testCase.id,
                                                                              )
                                                                            }
                                                                          >
                                                                            {addToSuiteError[testCase.id]}
                                                                          </CAlert>
                                                                        )}
                                                                      </li>
                                                                    ))}
                                                                  </ul>
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
              REQ-4 (ADR-0030, UI Design Document 2026-09-06): Test Suites, a
              top-level section of this page rather than the dedicated
              `TestSuiteBuilder` route the Sitemap once reserved — same
              correction REQ-2/REQ-3 already made for `RequirementDetail`.

              The suite's own name/purpose CRUD is the generic factory's
              (`POST`/`GET /test-suites`); only the membership view below is
              bespoke, because a many-to-many join is not a plain-field form.
            */}
            <CCard className="mt-4">
              <CCardBody className="p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h2 className="fs-5 mb-0">Test Suites</h2>
                  <CButton color="primary" data-testid="new-test-suite-btn" onClick={openSuiteModal}>
                    New Test Suite
                  </CButton>
                </div>

                {suitesLoadError && (
                  <CAlert color="danger" role="alert">
                    {suitesLoadError}
                  </CAlert>
                )}

                {suitesLoading ? (
                  <div className="d-flex justify-content-center py-3">
                    <CSpinner color="primary" />
                  </div>
                ) : !suitesLoadError && testSuites.length === 0 ? (
                  <p className="text-body-secondary mb-0">No test suites yet.</p>
                ) : (
                  !suitesLoadError && (
                    <CTable hover responsive className="mb-0">
                      <CTableHead>
                        <CTableRow>
                          <CTableHeaderCell>Name</CTableHeaderCell>
                          <CTableHeaderCell>Purpose</CTableHeaderCell>
                        </CTableRow>
                      </CTableHead>
                      <CTableBody>
                        {testSuites.map((suite) => {
                          const suiteExpanded = expandedSuiteId === suite.id;
                          return (
                            <Fragment key={suite.id}>
                              <CTableRow
                                className="cursor-pointer"
                                data-testid={`test-suite-row-${suite.id}`}
                                aria-expanded={suiteExpanded}
                                onClick={() => toggleSuiteMembership(suite.id)}
                              >
                                <CTableDataCell>{suite.name}</CTableDataCell>
                                <CTableDataCell>
                                  {suite.purpose ? (
                                    <CBadge color="info">{suite.purpose}</CBadge>
                                  ) : (
                                    "—"
                                  )}
                                </CTableDataCell>
                              </CTableRow>
                              <CTableRow>
                                <CTableDataCell colSpan={2} className="p-0 border-0">
                                  <CCollapse visible={suiteExpanded}>
                                    {suiteExpanded && (
                                      <div
                                        className="bg-body-tertiary p-3"
                                        data-testid={`suite-membership-${suite.id}`}
                                      >
                                        <h3 className="fs-6 mb-2">Test cases in this suite</h3>

                                        {suiteMembersError && (
                                          <CAlert color="danger" role="alert">
                                            {suiteMembersError}
                                          </CAlert>
                                        )}

                                        {suiteMembersLoading ? (
                                          <div className="d-flex justify-content-center py-2">
                                            <CSpinner size="sm" color="primary" />
                                          </div>
                                        ) : !suiteMembersError && suiteMembers.length === 0 ? (
                                          /*
                                            Distinct from the section-level
                                            "No test suites yet." above — the
                                            suite exists, it just has no
                                            members (UI Design Document §4).
                                          */
                                          <p className="text-body-secondary mb-0">
                                            No test cases in this suite yet.
                                          </p>
                                        ) : (
                                          !suiteMembersError && (
                                            /* Flat <ul>/<li>, not a nested <CTable> — frontend/CLAUDE.md. */
                                            <ul
                                              className="list-unstyled mb-0"
                                              data-testid={`suite-member-list-${suite.id}`}
                                            >
                                              {suiteMembers.map((member) => (
                                                <li
                                                  key={member.id}
                                                  className="d-flex justify-content-between align-items-center border-bottom py-2 gap-2"
                                                  data-testid={`suite-member-${suite.id}-${member.id}`}
                                                >
                                                  <span>
                                                    {member.title}{" "}
                                                    <CBadge color="secondary">{member.status}</CBadge>
                                                  </span>
                                                  <CButton
                                                    color="danger"
                                                    variant="outline"
                                                    size="sm"
                                                    data-testid={`remove-from-suite-${suite.id}-${member.id}`}
                                                    onClick={() =>
                                                      onRemoveFromSuite(suite.id, member.id)
                                                    }
                                                  >
                                                    Remove
                                                  </CButton>
                                                </li>
                                              ))}
                                            </ul>
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
                  )
                )}
              </CCardBody>
            </CCard>

            {/*
              PLAN-1 (ADR-0031, UI Design Document §1): Test Plans. The only
              section here whose rows link to a dedicated route
              (`TestPlanDetail`) rather than expanding in place — see that
              page's own docstring for why PLAN-1 breaks the pattern every
              prior REQ-* section follows. Deliberately thin: no create modal
              (the generic admin `/test-plans` page owns that), no membership
              UI (that's the detail route's own).
            */}
            <CCard className="mt-4">
              <CCardBody className="p-4">
                <h2 className="fs-5 mb-3">Test Plans</h2>

                {plansLoadError && (
                  <CAlert color="danger" role="alert" data-testid="test-plans-error">
                    {plansLoadError}
                  </CAlert>
                )}

                {plansLoading ? (
                  <div className="d-flex justify-content-center py-3">
                    <CSpinner color="primary" />
                  </div>
                ) : !plansLoadError && testPlans.length === 0 ? (
                  <p className="text-body-secondary mb-0">No test plans yet.</p>
                ) : (
                  !plansLoadError && (
                    <CTable hover responsive className="mb-0">
                      <CTableHead>
                        <CTableRow>
                          <CTableHeaderCell>Identifier</CTableHeaderCell>
                          <CTableHeaderCell>Status</CTableHeaderCell>
                        </CTableRow>
                      </CTableHead>
                      <CTableBody>
                        {testPlans.map((plan) => (
                          <CTableRow key={plan.id} data-testid={`test-plan-row-${plan.id}`}>
                            <CTableDataCell>
                              <Link to={`/projects/${projectId}/test-plans/${plan.id}`}>
                                {plan.identifier}
                              </Link>
                            </CTableDataCell>
                            <CTableDataCell>
                              <CBadge color={testPlanStatusColor(plan.status)}>{plan.status}</CBadge>
                            </CTableDataCell>
                          </CTableRow>
                        ))}
                      </CTableBody>
                    </CTable>
                  )
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

      <CModal visible={showSuiteModal} onClose={closeSuiteModal} data-testid="test-suite-modal">
        <CModalHeader>
          <CModalTitle>New Test Suite</CModalTitle>
        </CModalHeader>
        <CForm onSubmit={handleSubmitSuite(onSubmitTestSuite)} noValidate>
          <CModalBody>
            <div className="mb-3">
              <CFormLabel htmlFor="testSuiteName">Name</CFormLabel>
              <CFormInput
                id="testSuiteName"
                type="text"
                data-testid="test-suite-name"
                invalid={!!suiteErrors.name}
                {...registerSuite("name")}
              />
              {suiteErrors.name && <CFormFeedback invalid>{suiteErrors.name.message}</CFormFeedback>}
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="testSuitePurpose">Purpose</CFormLabel>
              <CFormInput
                id="testSuitePurpose"
                type="text"
                data-testid="test-suite-purpose"
                invalid={!!suiteErrors.purpose}
                {...registerSuite("purpose")}
              />
              {suiteErrors.purpose ? (
                <CFormFeedback invalid>{suiteErrors.purpose.message}</CFormFeedback>
              ) : (
                <CFormText>Optional — e.g. regression, smoke, acceptance.</CFormText>
              )}
            </div>
            {suiteApiError && (
              <CAlert color="danger" role="alert">
                {suiteApiError}
              </CAlert>
            )}
          </CModalBody>
          <CModalFooter>
            <CButton color="secondary" variant="outline" onClick={closeSuiteModal}>
              Cancel
            </CButton>
            <CButton
              type="submit"
              color="primary"
              data-testid="test-suite-submit"
              disabled={isSubmittingSuite}
            >
              {isSubmittingSuite ? "Creating..." : "Create"}
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
              <CFormLabel htmlFor="conditionTestCaseTitle">Title</CFormLabel>
              <CFormInput
                id="conditionTestCaseTitle"
                type="text"
                data-testid="test-case-title"
                invalid={!!testCaseErrors.title}
                {...registerTestCase("title")}
              />
              {testCaseErrors.title && <CFormFeedback invalid>{testCaseErrors.title.message}</CFormFeedback>}
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="conditionTestCasePreconditions">Preconditions</CFormLabel>
              <CFormTextarea
                id="conditionTestCasePreconditions"
                rows={2}
                data-testid="test-case-preconditions"
                {...registerTestCase("preconditions")}
              />
              <CFormText>Optional.</CFormText>
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="conditionTestCaseExpectedResult">Expected result</CFormLabel>
              <CFormTextarea
                id="conditionTestCaseExpectedResult"
                rows={2}
                data-testid="test-case-expected-result"
                {...registerTestCase("expectedResult")}
              />
              <CFormText>Optional.</CFormText>
            </div>
            <div className="mb-3">
              <CFormLabel htmlFor="conditionTestCaseTestLevel">Test level</CFormLabel>
              <CFormSelect
                id="conditionTestCaseTestLevel"
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
              <CFormLabel htmlFor="conditionTestCaseTestType">Test type</CFormLabel>
              <CFormSelect
                id="conditionTestCaseTestType"
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
