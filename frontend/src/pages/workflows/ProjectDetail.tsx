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
 * exactly: React Hook Form + Zod (ADR-0009) bound to plain Bootstrap 5 input
 * markup, the local `ProjectModal` helper's header/body/footer structure
 * (ADR-0042; was `CModal`/`CModalHeader`/`CModalBody`/`CModalFooter`), an
 * inline `div.alert.alert-danger[role=alert]` for a non-field API error, and
 * `error.body.field_errors.<field>` mapped onto the matching RHF field when
 * present.
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
 * RHF+Zod+Bootstrap convention as "New Release" above, its own separate
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
 * expands (a Bootstrap `div.collapse`, ADR-0042; was `CCollapse`) into its
 * own TestCondition list, lazily fetched on first expand, with a "New Test
 * Condition" modal per requirement and a "New Test Case" modal per condition.
 * Two more independent `useForm` instances beyond REQ-2's own two
 * (Release/Requirement/TestCase/TestStep), each section keeping its own
 * separate instance rather than a shared one. No per-condition TestCase list
 * is rendered: no backend route lists TestCases by condition (explicit YAGNI,
 * ADR-0028's design spec), so the create modal confirms with a Bootstrap
 * toast instead.
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
 * error convention (a 403 surfaces as the modal's own inline alert), not the
 * generic admin surface's ADR-0027 hide/disable rule.
 *
 * Built with AdminLTE v4 / Bootstrap 5 raw markup (ADR-0042, which supersedes
 * ADR-0012's CoreUI choice). Every `@coreui/react` component this screen used
 * is now hand-written markup against the same class contract: `CContainer`/
 * `CRow`/`CCol` -> `div.container-fluid`/`div.row`/`div.col-*`, `CCard` ->
 * `div.card`, `CTable*` -> real `<table>`/`<thead>`/`<tr>`/`<th scope="col">`/
 * `<td>`, `CForm*` -> `<form>`/`<label class="form-label">`/
 * `input.form-control`/`select.form-select`/`div.invalid-feedback.d-block`,
 * `CAlert` -> `div.alert.alert-*[role=alert]`, `CBadge` -> `span.badge.bg-*`,
 * `CSpinner` -> `div.spinner-border[role=status]`, `CCollapse` ->
 * `div.collapse(.show)`, and `CModal*`/`CDropdown*` -> the two local helper
 * components below. React Hook Form + Zod are untouched — only the rendered
 * element and its classes changed.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type FormEventHandler,
  type ReactNode,
} from "react";
import { Link, useParams } from "react-router-dom";
import Table from "../../container/Table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
 * — surfaced as the same required-field `.invalid-feedback` message as any
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

/**
 * ADR-0042: hand-rolled replacement for `CModal` + `CModalHeader`/
 * `CModalTitle`/`CModalBody`/`CModalFooter`. Extracted rather than inlined
 * because this page renders six of them (New Release, New Requirement, New
 * Test Suite, New Test Condition, and REQ-2's and REQ-3's two "New Test Case"
 * variants), and follows the same shape as `EntityListPage`'s own
 * `AdminModal` so the two hand-rolled modals in this codebase stay identical.
 *
 * The `<form>` sits inside `.modal-content` as a sibling of the header and
 * wraps both the body and the footer — exactly the nesting the
 * `<CModal><CModalHeader/><CForm><CModalBody/><CModalFooter/></CForm></CModal>`
 * structure it replaces had, so a footer submit button still submits the
 * body's fields.
 *
 * Deliberate parity choices:
 * - **Renders nothing at all when closed.** This page's tests assert
 *   `queryByRole("heading", {name: /^new release$/i})` is null once the modal
 *   closes, and only one of the two "New Test Case" modals may contribute its
 *   duplicate field labels to `getByLabelText` at a time — both depend on the
 *   unmount-when-hidden semantics `CModal` had.
 * - **ESC closes**, matching `CModal`'s own default `keyboard` behavior.
 * - The header's close `<button class="btn-close" aria-label="Close">` is
 *   kept — `CModalHeader` rendered one by default.
 *
 * Deliberate gaps, accepted in ADR-0042 rather than reimplemented: no focus
 * trap, no focus restore on close, and no backdrop-click-to-close (`CModal`
 * did close on backdrop click; the backdrop here is inert, so ESC and the
 * explicit Cancel/close buttons are the dismissal paths).
 */
function ProjectModal({
  visible,
  title,
  onClose,
  onSubmit,
  children,
  footer,
  testId,
}: {
  visible: boolean;
  title: ReactNode;
  onClose: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
  footer: ReactNode;
  testId?: string;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!visible) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, onClose]);

  if (!visible) {
    return null;
  }

  return (
    <>
      <div
        className="modal fade show d-block"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
      >
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title" id={titleId}>
                {title}
              </h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <form onSubmit={onSubmit} noValidate>
              <div className="modal-body">{children}</div>
              <div className="modal-footer">{footer}</div>
            </form>
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" />
    </>
  );
}

/**
 * ADR-0042: hand-rolled replacement for REQ-4's `CDropdown variant="btn-group"`
 * + `CDropdownToggle`/`CDropdownMenu`/`CDropdownItem`, reusing
 * `AppHeader.tsx`'s established pattern (a `useState` open boolean plus a
 * ref-scoped document click-outside listener toggling Bootstrap's own `.show`
 * class on both the toggle and the menu).
 *
 * A component rather than an inline block only because this dropdown renders
 * once per TestCase inside a `.map()` and React forbids calling the open-state
 * hook in a loop — not a behavioral refactor.
 *
 * `variant="btn-group"` maps to `div.btn-group`, **not** `div.dropdown` (spec
 * §4.5.10). Selecting an item closes the menu, matching `CDropdown`'s own
 * `autoClose` default: REQ-4's e2e spec reopens this same toggle for its
 * duplicate-add (409) case, which only works if the first selection closed it.
 */
function AddToSuiteDropdown({
  testCaseId,
  suites,
  onSelect,
}: {
  testCaseId: string;
  suites: TestSuiteSummary[];
  onSelect: (suiteId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [open]);

  return (
    <div className={open ? "btn-group show" : "btn-group"} ref={ref}>
      <button
        type="button"
        className={
          open
            ? "btn btn-outline-secondary btn-sm dropdown-toggle show"
            : "btn btn-outline-secondary btn-sm dropdown-toggle"
        }
        aria-expanded={open}
        disabled={suites.length === 0}
        data-testid={`add-to-suite-toggle-${testCaseId}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        Add to suite
      </button>
      <ul className={open ? "dropdown-menu show" : "dropdown-menu"}>
        {/*
          Empty-state is a disabled toggle plus this placeholder, not a
          hidden control, so the ordering dependency (create a suite first)
          stays visible (UI Design Document §4).
        */}
        {suites.length === 0 ? (
          <li className="dropdown-item disabled" data-testid={`add-to-suite-empty-${testCaseId}`}>
            No suites yet — create one above
          </li>
        ) : (
          suites.map((suite) => (
            <li key={suite.id}>
              <button
                type="button"
                className="dropdown-item"
                data-testid={`add-to-suite-${testCaseId}-${suite.id}`}
                onClick={() => {
                  setOpen(false);
                  onSelect(suite.id);
                }}
              >
                {suite.name}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();

  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  // DS-2/ADR-0041: Releases is the one ProjectDetail outer table migrated
  // onto `container/Table.tsx` in this pass (server mode) — proves the
  // container coexists correctly with this same screen's nested
  // Release→TestCycle flat <ul>/<li> audit view (TC-DS-017). The other outer
  // tables (Requirements, Test Suites, Risk Items) are unchanged; see
  // ADR-0041's own Consequences for that explicitly-flagged remaining scope.
  const [releasesPage, setReleasesPage] = useState(1);
  const [releasesPageSize, setReleasesPageSize] = useState(25);
  const [releasesTotal, setReleasesTotal] = useState(0);
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

  // `id` bumps per toast so a second confirmation re-mounts the toast element
  // instead of silently reusing the previous one. (Under CoreUI this mattered
  // because `CToast` unmounted itself on exit; under ADR-0042's raw markup the
  // `key` still forces a fresh node, and the effect below restarts the timer.)
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);

  // ADR-0042: `CToast`'s `autohide` (5s by default, and explicitly relied on
  // here — nothing else ever cleared `toast`) went away with the component, so
  // the auto-dismiss it provided is reimplemented. Keyed on the toast object,
  // so a second confirmation restarts the countdown rather than inheriting the
  // first one's remaining time.
  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
  // Document §2: an inline dismissible `.alert.alert-dismissible`, never a
  // toast).
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
    async (sortOrder: "asc" | "desc", page: number, pageSize: number) => {
      if (!projectId) {
        return;
      }
      setLoading(true);
      setLoadError(null);
      try {
        const response = await listReleases(projectId, {
          sort: "target_date",
          order: sortOrder,
          page,
          page_size: pageSize,
        });
        setReleases(response.items);
        setReleasesTotal(response.total);
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    fetchReleases(order, releasesPage, releasesPageSize);
  }, [fetchReleases, order, releasesPage, releasesPageSize]);

  function toggleSort() {
    setOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    setReleasesPage(1);
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
      // its correct sorted position per the current `order` — page 1, since
      // a newly-created release could land anywhere in sort order relative
      // to whatever page was previously showing.
      setReleasesPage(1);
      await fetchReleases(order, 1, releasesPageSize);
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
    <div className="min-vh-100 py-4">
      <div className="container-fluid px-4">
        <div className="row justify-content-center">
          <div className="col-md-10 col-lg-8">
            <div className="card">
              <div className="card-body p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h1 className="fs-4 mb-0">Project: {projectId}</h1>
                  <button type="button" className="btn btn-primary" onClick={openModal}>
                    New Release
                  </button>
                </div>

                {loadError && (
                  <div className="alert alert-danger" role="alert">
                    {loadError}
                  </div>
                )}

                {loading ? (
                  <div className="d-flex justify-content-center py-4">
                    <div className="spinner-border text-primary" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  </div>
                ) : releases.length === 0 ? (
                  <p className="text-body-secondary mb-0">No releases yet.</p>
                ) : (
                  <Table
                    mode="server"
                    items={releases}
                    total={releasesTotal}
                    page={releasesPage}
                    pageSize={releasesPageSize}
                    onPageChange={setReleasesPage}
                    onPageSizeChange={(size) => {
                      setReleasesPageSize(size);
                    }}
                    rowKey={(release) => release.id}
                    testIdPrefix="release-table"
                    columns={
                      <tr>
                        <th scope="col">Version label</th>
                        <th scope="col">
                          <button
                            type="button"
                            className="btn btn-link p-0 text-decoration-none"
                            onClick={toggleSort}
                          >
                            Target date {order === "asc" ? "▲" : "▼"}
                          </button>
                        </th>
                      </tr>
                    }
                    renderRow={(release) => (
                      <Fragment key={release.id}>
                          <tr
                            style={{ cursor: "pointer" }}
                            onClick={() => toggleExpand(release)}
                          >
                            <td>{release.version_label}</td>
                            <td>{formatDate(release.target_date)}</td>
                          </tr>
                          {expandedId === release.id && (
                            <tr key={`${release.id}-detail`}>
                              <td colSpan={2} className="bg-body-tertiary">
                                {cyclesLoading && (
                                  <div className="d-flex justify-content-center py-2">
                                    <div className="spinner-border spinner-border-sm text-primary" role="status">
                                      <span className="visually-hidden">Loading...</span>
                                    </div>
                                  </div>
                                )}
                                {cyclesError && (
                                  <div className="alert alert-danger" role="alert">
                                    {cyclesError}
                                  </div>
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
                                          a nested <table> (frontend/CLAUDE.md).
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
                              </td>
                            </tr>
                          )}
                      </Fragment>
                    )}
                  />
                )}
              </div>
            </div>

            <div className="card mt-4">
              <div className="card-body p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h2 className="fs-4 mb-0">Requirements</h2>
                  <button type="button" className="btn btn-primary" onClick={openReqModal}>
                    New Requirement
                  </button>
                </div>

                <form onSubmit={onSearchSubmit} className="mb-3">
                  <div className="input-group">
                    <input
                      type="text"
                      className="form-control"
                      aria-label="Search requirements"
                      placeholder="Search by title, description, source, or external ref…"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                    />
                    <button type="submit" className="btn btn-outline-secondary">
                      Search
                    </button>
                  </div>
                </form>

                {reqLoadError && (
                  <div className="alert alert-danger" role="alert">
                    {reqLoadError}
                  </div>
                )}

                {reqLoading ? (
                  <div className="d-flex justify-content-center py-4">
                    <div className="spinner-border text-primary" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  </div>
                ) : requirements.length === 0 ? (
                  <p className="text-body-secondary mb-0">
                    {searchTerm ? "No requirements match your search." : "No requirements yet."}
                  </p>
                ) : (
                  <div className="table-responsive">
                  <table className="table table-hover">
                    <thead>
                      <tr>
                        <th scope="col">Title</th>
                        <th scope="col">External ref</th>
                        <th scope="col">Source</th>
                        <th scope="col">Test conditions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requirements.map((requirement) => {
                        const expanded = expandedRequirementIds.includes(requirement.id);
                        const conditions = conditionsByRequirement[requirement.id] ?? [];
                        const loadingConditions = conditionsLoading[requirement.id] ?? false;
                        const conditionsLoadError = conditionsError[requirement.id] ?? null;
                        return (
                          <Fragment key={requirement.id}>
                            <tr
                              style={{ cursor: "pointer" }}
                              onClick={() => toggleRequirementExpand(requirement)}
                            >
                              <td>{requirement.title}</td>
                              <td>{dashIfEmpty(requirement.external_ref)}</td>
                              <td>{dashIfEmpty(requirement.source)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="btn btn-link p-0 text-decoration-none"
                                  aria-expanded={expanded}
                                  data-testid={`tc-section-toggle-${requirement.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleTestConditions(requirement.id);
                                  }}
                                >
                                  Test conditions {expanded ? "▲" : "▼"}
                                </button>
                              </td>
                            </tr>
                            {expandedRequirementId === requirement.id && (
                              <tr key={`${requirement.id}-detail`}>
                                <td colSpan={4} className="bg-body-tertiary">
                                  <div className="d-flex justify-content-between align-items-center mb-2">
                                    <h3 className="fs-6 mb-0">Test cases</h3>
                                    <button
                                      type="button"
                                      className="btn btn-primary btn-sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openTestCaseModal(requirement.id);
                                      }}
                                    >
                                      New Test Case
                                    </button>
                                  </div>

                                  {testCasesError && (
                                    <div className="alert alert-danger" role="alert">
                                      {testCasesError}
                                    </div>
                                  )}

                                  {testCasesLoading ? (
                                    <div className="d-flex justify-content-center py-2">
                                      <div className="spinner-border spinner-border-sm text-primary" role="status">
                                        <span className="visually-hidden">Loading...</span>
                                      </div>
                                    </div>
                                  ) : !testCasesError && testCases.length === 0 ? (
                                    <p className="text-body-secondary mb-0">No test cases yet.</p>
                                  ) : (
                                    // Flat `<ul>`, not a nested `<table>` — same convention the
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
                                                <div className="alert alert-danger" role="alert">
                                                  {testStepsError}
                                                </div>
                                              )}
                                              {testStepsLoading ? (
                                                <div className="d-flex justify-content-center py-2">
                                                  <div
                                                    className="spinner-border spinner-border-sm text-primary"
                                                    role="status"
                                                  >
                                                    <span className="visually-hidden">Loading...</span>
                                                  </div>
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
                                                              <input
                                                                type="text"
                                                                aria-label={`Step ${step.sequence} action`}
                                                                className="form-control mb-1"
                                                                value={editAction}
                                                                onChange={(e) => setEditAction(e.target.value)}
                                                              />
                                                              <input
                                                                type="text"
                                                                aria-label={`Step ${step.sequence} expected result`}
                                                                className="form-control mb-1"
                                                                placeholder="Expected result (optional)"
                                                                value={editExpectedResult}
                                                                onChange={(e) =>
                                                                  setEditExpectedResult(e.target.value)
                                                                }
                                                              />
                                                              {editStepApiError && (
                                                                <div
                                                                  className="alert alert-danger py-1"
                                                                  role="alert"
                                                                >
                                                                  {editStepApiError}
                                                                </div>
                                                              )}
                                                              <button
                                                                type="button"
                                                                className="btn btn-primary btn-sm me-1"
                                                                disabled={editStepSubmitting}
                                                                onClick={() => saveEditStep(step.id)}
                                                              >
                                                                Save
                                                              </button>
                                                              <button
                                                                type="button"
                                                                className="btn btn-outline-secondary btn-sm"
                                                                onClick={cancelEditStep}
                                                              >
                                                                Cancel
                                                              </button>
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
                                                              <button
                                                                type="button"
                                                                className="btn btn-link btn-sm p-0 ms-2"
                                                                onClick={() => startEditStep(step)}
                                                              >
                                                                Edit
                                                              </button>
                                                            </div>
                                                          )}
                                                        </li>
                                                      ))}
                                                    </ol>
                                                  )}
                                                </>
                                              )}

                                              <form onSubmit={handleSubmitTestStep(onSubmitTestStep)} noValidate>
                                                <div className="input-group mb-1">
                                                  <input
                                                    type="text"
                                                    aria-label="New step action"
                                                    placeholder="Action"
                                                    className={
                                                      testStepErrors.action
                                                        ? "form-control is-invalid"
                                                        : "form-control"
                                                    }
                                                    {...registerTestStep("action")}
                                                  />
                                                  <input
                                                    type="text"
                                                    className="form-control"
                                                    aria-label="New step expected result"
                                                    placeholder="Expected result (optional)"
                                                    {...registerTestStep("expectedResult")}
                                                  />
                                                  <button
                                                    type="submit"
                                                    className="btn btn-outline-secondary"
                                                    disabled={isSubmittingTestStep}
                                                  >
                                                    Add step
                                                  </button>
                                                </div>
                                                {testStepErrors.action && (
                                                  <div className="invalid-feedback d-block">
                                                    {testStepErrors.action.message}
                                                  </div>
                                                )}
                                                {testStepApiError && (
                                                  <div className="alert alert-danger py-1" role="alert">
                                                    {testStepApiError}
                                                  </div>
                                                )}
                                              </form>
                                            </div>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </td>
                              </tr>
                            )}
                            <tr>
                              <td colSpan={4} className="p-0 border-0">
                                <div className={expanded ? "collapse show" : "collapse"}>
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
                                        <button
                                          type="button"
                                          className="btn btn-primary btn-sm"
                                          data-testid={`new-test-condition-btn-${requirement.id}`}
                                          onClick={() => openConditionModal(requirement.id)}
                                        >
                                          New Test Condition
                                        </button>
                                      </div>

                                      {conditionsLoadError && (
                                        <div className="alert alert-danger" role="alert">
                                          {conditionsLoadError}
                                        </div>
                                      )}

                                      {loadingConditions ? (
                                        <div className="d-flex justify-content-center py-2">
                                          <div
                                            className="spinner-border spinner-border-sm text-primary"
                                            role="status"
                                          >
                                            <span className="visually-hidden">Loading...</span>
                                          </div>
                                        </div>
                                      ) : !conditionsLoadError && conditions.length === 0 ? (
                                        <p className="text-body-secondary mb-0">No test conditions yet.</p>
                                      ) : (
                                        !conditionsLoadError && (
                                          <div className="table-responsive">
                                          <table className="table table-sm mb-0">
                                            <thead>
                                              <tr>
                                                <th scope="col">Description</th>
                                                <th scope="col">Priority</th>
                                                <th scope="col" />
                                              </tr>
                                            </thead>
                                            <tbody>
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
                                                    <tr
                                                      data-testid={`test-condition-row-${condition.id}`}
                                                    >
                                                      <td>
                                                        {condition.description}
                                                      </td>
                                                      <td>
                                                        <span
                                                          className={`badge bg-${priorityColor(condition.priority)}`}
                                                        >
                                                          {condition.priority}
                                                        </span>
                                                      </td>
                                                      <td className="text-end">
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
                                                        {/*
                                                          ADR-0042: this was
                                                          `variant="ghost"`,
                                                          a CoreUI-only
                                                          variant with no
                                                          Bootstrap/AdminLTE
                                                          equivalent — spec
                                                          §4.5.1 says to use
                                                          `btn-link` rather
                                                          than emit the
                                                          now-unstyled
                                                          `btn-ghost-*`.
                                                        */}
                                                        <button
                                                          type="button"
                                                          className="btn btn-link btn-sm me-2"
                                                          data-testid={`tc-cases-toggle-${condition.id}`}
                                                          aria-expanded={casesExpanded}
                                                          onClick={() =>
                                                            toggleConditionTestCases(condition.id)
                                                          }
                                                        >
                                                          Test Cases
                                                        </button>
                                                        <button
                                                          type="button"
                                                          className="btn btn-outline-secondary btn-sm"
                                                          data-testid={`new-test-case-btn-${condition.id}`}
                                                          onClick={() =>
                                                            openConditionTestCaseModal(condition.id)
                                                          }
                                                        >
                                                          New Test Case
                                                        </button>
                                                      </td>
                                                    </tr>
                                                    <tr>
                                                      <td
                                                        colSpan={3}
                                                        className="p-0 border-0"
                                                      >
                                                        <div
                                                          className={
                                                            casesExpanded ? "collapse show" : "collapse"
                                                          }
                                                        >
                                                          {casesExpanded && (
                                                            <div className="bg-body p-3">
                                                              {casesLoadError && (
                                                                <div className="alert alert-danger" role="alert">
                                                                  {casesLoadError}
                                                                </div>
                                                              )}
                                                              {loadingCases ? (
                                                                <div className="d-flex justify-content-center py-2">
                                                                  <div
                                                                    className="spinner-border spinner-border-sm text-primary"
                                                                    role="status"
                                                                  >
                                                                    <span className="visually-hidden">
                                                                      Loading...
                                                                    </span>
                                                                  </div>
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
                                                                    <table>: a <table> inside
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
                                                                            <span className="badge bg-secondary">
                                                                              {testCase.status}
                                                                            </span>
                                                                          </span>
                                                                          <AddToSuiteDropdown
                                                                            testCaseId={testCase.id}
                                                                            suites={testSuites}
                                                                            onSelect={(suiteId) =>
                                                                              onAddTestCaseToSuite(
                                                                                suiteId,
                                                                                testCase.id,
                                                                              )
                                                                            }
                                                                          />
                                                                        </div>
                                                                        {addToSuiteError[testCase.id] && (
                                                                          <div
                                                                            className="alert alert-danger alert-dismissible mt-2 mb-0 py-1"
                                                                            role="alert"
                                                                            data-testid={`add-to-suite-error-${testCase.id}`}
                                                                          >
                                                                            {addToSuiteError[testCase.id]}
                                                                            <button
                                                                              type="button"
                                                                              className="btn-close"
                                                                              aria-label="Close"
                                                                              onClick={() =>
                                                                                dismissAddToSuiteError(
                                                                                  testCase.id,
                                                                                )
                                                                              }
                                                                            />
                                                                          </div>
                                                                        )}
                                                                      </li>
                                                                    ))}
                                                                  </ul>
                                                                )
                                                              )}
                                                            </div>
                                                          )}
                                                        </div>
                                                      </td>
                                                    </tr>
                                                  </Fragment>
                                                );
                                              })}
                                            </tbody>
                                          </table>
                                          </div>
                                        )
                                      )}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            </div>

            {/*
              REQ-4 (ADR-0030, UI Design Document 2026-09-06): Test Suites, a
              top-level section of this page rather than the dedicated
              `TestSuiteBuilder` route the Sitemap once reserved — same
              correction REQ-2/REQ-3 already made for `RequirementDetail`.

              The suite's own name/purpose CRUD is the generic factory's
              (`POST`/`GET /test-suites`); only the membership view below is
              bespoke, because a many-to-many join is not a plain-field form.
            */}
            <div className="card mt-4">
              <div className="card-body p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h2 className="fs-5 mb-0">Test Suites</h2>
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="new-test-suite-btn"
                    onClick={openSuiteModal}
                  >
                    New Test Suite
                  </button>
                </div>

                {suitesLoadError && (
                  <div className="alert alert-danger" role="alert">
                    {suitesLoadError}
                  </div>
                )}

                {suitesLoading ? (
                  <div className="d-flex justify-content-center py-3">
                    <div className="spinner-border text-primary" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  </div>
                ) : !suitesLoadError && testSuites.length === 0 ? (
                  <p className="text-body-secondary mb-0">No test suites yet.</p>
                ) : (
                  !suitesLoadError && (
                    <div className="table-responsive">
                    <table className="table table-hover mb-0">
                      <thead>
                        <tr>
                          <th scope="col">Name</th>
                          <th scope="col">Purpose</th>
                        </tr>
                      </thead>
                      <tbody>
                        {testSuites.map((suite) => {
                          const suiteExpanded = expandedSuiteId === suite.id;
                          return (
                            <Fragment key={suite.id}>
                              <tr
                                className="cursor-pointer"
                                data-testid={`test-suite-row-${suite.id}`}
                                aria-expanded={suiteExpanded}
                                onClick={() => toggleSuiteMembership(suite.id)}
                              >
                                <td>{suite.name}</td>
                                <td>
                                  {suite.purpose ? (
                                    <span className="badge bg-info">{suite.purpose}</span>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                              </tr>
                              <tr>
                                <td colSpan={2} className="p-0 border-0">
                                  <div className={suiteExpanded ? "collapse show" : "collapse"}>
                                    {suiteExpanded && (
                                      <div
                                        className="bg-body-tertiary p-3"
                                        data-testid={`suite-membership-${suite.id}`}
                                      >
                                        <h3 className="fs-6 mb-2">Test cases in this suite</h3>

                                        {suiteMembersError && (
                                          <div className="alert alert-danger" role="alert">
                                            {suiteMembersError}
                                          </div>
                                        )}

                                        {suiteMembersLoading ? (
                                          <div className="d-flex justify-content-center py-2">
                                            <div
                                              className="spinner-border spinner-border-sm text-primary"
                                              role="status"
                                            >
                                              <span className="visually-hidden">Loading...</span>
                                            </div>
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
                                            /* Flat <ul>/<li>, not a nested <table> — frontend/CLAUDE.md. */
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
                                                    <span className="badge bg-secondary">
                                                      {member.status}
                                                    </span>
                                                  </span>
                                                  <button
                                                    type="button"
                                                    className="btn btn-outline-danger btn-sm"
                                                    data-testid={`remove-from-suite-${suite.id}-${member.id}`}
                                                    onClick={() =>
                                                      onRemoveFromSuite(suite.id, member.id)
                                                    }
                                                  >
                                                    Remove
                                                  </button>
                                                </li>
                                              ))}
                                            </ul>
                                          )
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  )
                )}
              </div>
            </div>

            {/*
              PLAN-1 (ADR-0031, UI Design Document §1): Test Plans. The only
              section here whose rows link to a dedicated route
              (`TestPlanDetail`) rather than expanding in place — see that
              page's own docstring for why PLAN-1 breaks the pattern every
              prior REQ-* section follows. Deliberately thin: no create modal
              (the generic admin `/test-plans` page owns that), no membership
              UI (that's the detail route's own).
            */}
            <div className="card mt-4">
              <div className="card-body p-4">
                <h2 className="fs-5 mb-3">Test Plans</h2>

                {plansLoadError && (
                  <div className="alert alert-danger" role="alert" data-testid="test-plans-error">
                    {plansLoadError}
                  </div>
                )}

                {plansLoading ? (
                  <div className="d-flex justify-content-center py-3">
                    <div className="spinner-border text-primary" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  </div>
                ) : !plansLoadError && testPlans.length === 0 ? (
                  <p className="text-body-secondary mb-0">No test plans yet.</p>
                ) : (
                  !plansLoadError && (
                    <div className="table-responsive">
                    <table className="table table-hover mb-0">
                      <thead>
                        <tr>
                          <th scope="col">Identifier</th>
                          <th scope="col">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {testPlans.map((plan) => (
                          <tr key={plan.id} data-testid={`test-plan-row-${plan.id}`}>
                            <td>
                              <Link to={`/projects/${projectId}/test-plans/${plan.id}`}>
                                {plan.identifier}
                              </Link>
                            </td>
                            <td>
                              <span className={`badge bg-${testPlanStatusColor(plan.status)}`}>
                                {plan.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )
                )}
              </div>
            </div>

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
            <div className="card mt-4">
              <div className="card-body p-4">
                <h2 className="fs-5 mb-3">Admin</h2>
                <div className="list-group">
                  {projectScopedEntities.map((item) => (
                    <Link
                      key={item.key}
                      className="list-group-item list-group-item-action"
                      to={`/projects/${projectId}/admin/${item.key}`}
                      data-testid={`project-admin-link-${item.key}`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ProjectModal
        visible={showTestCaseModal}
        onClose={closeTestCaseModal}
        onSubmit={handleSubmitTestCase(onSubmitTestCase)}
        title="New Test Case"
        footer={
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={closeTestCaseModal}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmittingTestCase}>
              {isSubmittingTestCase ? "Creating..." : "Create"}
            </button>
          </>
        }
      >
        <div className="mb-3">
          <label className="form-label" htmlFor="testCaseTitle">Title</label>
          <input
            id="testCaseTitle"
            type="text"
            className={`form-control${testCaseErrors.title ? " is-invalid" : ""}`}
            {...registerTestCase("title")}
          />
          {testCaseErrors.title && <div className="invalid-feedback d-block">{testCaseErrors.title.message}</div>}
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="testCasePreconditions">Preconditions</label>
          <textarea
            id="testCasePreconditions"
            className="form-control"
            rows={2}
            {...registerTestCase("preconditions")}
          />
          <div className="form-text">Optional.</div>
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="testCaseExpectedResult">Expected result</label>
          <textarea
            id="testCaseExpectedResult"
            className="form-control"
            rows={2}
            {...registerTestCase("expectedResult")}
          />
          <div className="form-text">Optional.</div>
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="testCaseTestLevel">Test level</label>
          <select
            id="testCaseTestLevel"
            className={`form-select${testCaseErrors.testLevelId ? " is-invalid" : ""}`}
            {...registerTestCase("testLevelId")}
          >
            <option value="">Select a test level…</option>
            {testLevels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.name}
              </option>
            ))}
          </select>
          {testCaseErrors.testLevelId && (
            <div className="invalid-feedback d-block">{testCaseErrors.testLevelId.message}</div>
          )}
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="testCaseTestType">Test type</label>
          <select
            id="testCaseTestType"
            className={`form-select${testCaseErrors.testTypeId ? " is-invalid" : ""}`}
            {...registerTestCase("testTypeId")}
          >
            <option value="">Select a test type…</option>
            {testTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
          {testCaseErrors.testTypeId && (
            <div className="invalid-feedback d-block">{testCaseErrors.testTypeId.message}</div>
          )}
        </div>
        {testCaseApiError && (
          <div className="alert alert-danger" role="alert">
            {testCaseApiError}
          </div>
        )}
      </ProjectModal>

      <ProjectModal
        visible={showReqModal}
        onClose={closeReqModal}
        onSubmit={handleSubmitRequirement(onSubmitRequirement)}
        title="New Requirement"
        footer={
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={closeReqModal}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmittingRequirement}>
              {isSubmittingRequirement ? "Creating..." : "Create"}
            </button>
          </>
        }
      >
        <div className="mb-3">
          <label className="form-label" htmlFor="requirementTitle">Title</label>
          <input
            id="requirementTitle"
            type="text"
            className={`form-control${requirementErrors.title ? " is-invalid" : ""}`}
            {...registerRequirement("title")}
          />
          {requirementErrors.title && (
            <div className="invalid-feedback d-block">{requirementErrors.title.message}</div>
          )}
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="requirementDescription">Description</label>
          <textarea
            id="requirementDescription"
            className={`form-control${requirementErrors.description ? " is-invalid" : ""}`}
            rows={3}
            {...registerRequirement("description")}
          />
          {requirementErrors.description && (
            <div className="invalid-feedback d-block">{requirementErrors.description.message}</div>
          )}
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="requirementSource">Source</label>
          <input id="requirementSource" type="text" className="form-control" {...registerRequirement("source")} />
          <div className="form-text">Optional.</div>
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="requirementExternalRef">External ref</label>
          <input
            id="requirementExternalRef"
            type="text"
            className="form-control"
            {...registerRequirement("externalRef")}
          />
          <div className="form-text">Optional — e.g. a Jira/GitHub issue id.</div>
        </div>
        {reqApiError && (
          <div className="alert alert-danger" role="alert">
            {reqApiError}
          </div>
        )}
      </ProjectModal>

      <ProjectModal
        visible={showSuiteModal}
        onClose={closeSuiteModal}
        onSubmit={handleSubmitSuite(onSubmitTestSuite)}
        title="New Test Suite"
        testId="test-suite-modal"
        footer={
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={closeSuiteModal}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              data-testid="test-suite-submit"
              disabled={isSubmittingSuite}
            >
              {isSubmittingSuite ? "Creating..." : "Create"}
            </button>
          </>
        }
      >
        <div className="mb-3">
          <label className="form-label" htmlFor="testSuiteName">Name</label>
          <input
            id="testSuiteName"
            type="text"
            className={`form-control${suiteErrors.name ? " is-invalid" : ""}`}
            data-testid="test-suite-name"
            {...registerSuite("name")}
          />
          {suiteErrors.name && <div className="invalid-feedback d-block">{suiteErrors.name.message}</div>}
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="testSuitePurpose">Purpose</label>
          <input
            id="testSuitePurpose"
            type="text"
            className={`form-control${suiteErrors.purpose ? " is-invalid" : ""}`}
            data-testid="test-suite-purpose"
            {...registerSuite("purpose")}
          />
          {suiteErrors.purpose ? (
            <div className="invalid-feedback d-block">{suiteErrors.purpose.message}</div>
          ) : (
            <div className="form-text">Optional — e.g. regression, smoke, acceptance.</div>
          )}
        </div>
        {suiteApiError && (
          <div className="alert alert-danger" role="alert">
            {suiteApiError}
          </div>
        )}
      </ProjectModal>

      <ProjectModal
        visible={conditionModalRequirementId !== null}
        onClose={closeConditionModal}
        onSubmit={handleSubmitCondition(onSubmitTestCondition)}
        title="New Test Condition"
        testId="test-condition-modal"
        footer={
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={closeConditionModal}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              data-testid="test-condition-submit"
              disabled={isSubmittingCondition}
            >
              {isSubmittingCondition ? "Creating..." : "Create"}
            </button>
          </>
        }
      >
        <div className="mb-3">
          <label className="form-label" htmlFor="testConditionDescription">Description</label>
          <textarea
            id="testConditionDescription"
            className={`form-control${conditionErrors.description ? " is-invalid" : ""}`}
            rows={3}
            data-testid="test-condition-description"
            {...registerCondition("description")}
          />
          {conditionErrors.description && (
            <div className="invalid-feedback d-block">{conditionErrors.description.message}</div>
          )}
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="testConditionPriority">Priority</label>
          <select
            id="testConditionPriority"
            className={`form-select${conditionErrors.priority ? " is-invalid" : ""}`}
            data-testid="test-condition-priority"
            {...registerCondition("priority")}
          >
            <option value="">Select a priority…</option>
            {TEST_CONDITION_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
          {conditionErrors.priority && (
            <div className="invalid-feedback d-block">{conditionErrors.priority.message}</div>
          )}
        </div>
        {conditionApiError && (
          <div className="alert alert-danger" role="alert">
            {conditionApiError}
          </div>
        )}
      </ProjectModal>

      <ProjectModal
        visible={testCaseModalConditionId !== null}
        onClose={closeTestCaseModal}
        onSubmit={handleSubmitTestCase(onSubmitTestCase)}
        title="New Test Case"
        testId="test-case-modal"
        footer={
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={closeTestCaseModal}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              data-testid="test-case-submit"
              disabled={isSubmittingTestCase}
            >
              {isSubmittingTestCase ? "Creating..." : "Create"}
            </button>
          </>
        }
      >
        <div className="mb-3">
          <label className="form-label" htmlFor="conditionTestCaseTitle">Title</label>
          <input
            id="conditionTestCaseTitle"
            type="text"
            className={`form-control${testCaseErrors.title ? " is-invalid" : ""}`}
            data-testid="test-case-title"
            {...registerTestCase("title")}
          />
          {testCaseErrors.title && <div className="invalid-feedback d-block">{testCaseErrors.title.message}</div>}
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="conditionTestCasePreconditions">Preconditions</label>
          <textarea
            id="conditionTestCasePreconditions"
            className="form-control"
            rows={2}
            data-testid="test-case-preconditions"
            {...registerTestCase("preconditions")}
          />
          <div className="form-text">Optional.</div>
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="conditionTestCaseExpectedResult">Expected result</label>
          <textarea
            id="conditionTestCaseExpectedResult"
            className="form-control"
            rows={2}
            data-testid="test-case-expected-result"
            {...registerTestCase("expectedResult")}
          />
          <div className="form-text">Optional.</div>
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="conditionTestCaseTestLevel">Test level</label>
          <select
            id="conditionTestCaseTestLevel"
            className={`form-select${testCaseErrors.testLevelId ? " is-invalid" : ""}`}
            data-testid="test-case-test-level"
            {...registerTestCase("testLevelId")}
          >
            <option value="">Select a test level…</option>
            {testLevels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.name}
              </option>
            ))}
          </select>
          {testCaseErrors.testLevelId && (
            <div className="invalid-feedback d-block">{testCaseErrors.testLevelId.message}</div>
          )}
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="conditionTestCaseTestType">Test type</label>
          <select
            id="conditionTestCaseTestType"
            className={`form-select${testCaseErrors.testTypeId ? " is-invalid" : ""}`}
            data-testid="test-case-test-type"
            {...registerTestCase("testTypeId")}
          >
            <option value="">Select a test type…</option>
            {testTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
          {testCaseErrors.testTypeId && (
            <div className="invalid-feedback d-block">{testCaseErrors.testTypeId.message}</div>
          )}
        </div>
        {/*
          Catalog-load failure is a non-field error, so it uses this
          page's page-level alert convention (ADR-0023) — the two
          selects simply render empty, and the required-field validation
          above is what blocks an unselectable submit.
        */}
        {catalogError && (
          <div className="alert alert-warning" role="alert">
            {catalogError}
          </div>
        )}
        {testCaseApiError && (
          <div className="alert alert-danger" role="alert">
            {testCaseApiError}
          </div>
        )}
      </ProjectModal>

      <div className="toast-container position-fixed top-0 end-0 p-3">
        {toast && (
          <div
            key={toast.id}
            className="toast show text-bg-success border-0"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            data-testid="test-case-created-toast"
          >
            <div className="toast-body">{toast.message}</div>
          </div>
        )}
      </div>

      <ProjectModal
        visible={showModal}
        onClose={closeModal}
        onSubmit={handleSubmit(onSubmit)}
        title="New Release"
        footer={
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create"}
            </button>
          </>
        }
      >
        <div className="mb-3">
          <label className="form-label" htmlFor="releaseVersionLabel">Version label</label>
          <input
            id="releaseVersionLabel"
            type="text"
            className={`form-control${errors.versionLabel ? " is-invalid" : ""}`}
            {...register("versionLabel")}
          />
          {errors.versionLabel && <div className="invalid-feedback d-block">{errors.versionLabel.message}</div>}
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="releaseTargetDate">Target date</label>
          <input id="releaseTargetDate" type="date" className="form-control" {...register("targetDate")} />
          <div className="form-text">Optional.</div>
        </div>
        {apiError && (
          <div className="alert alert-danger" role="alert">
            {apiError}
          </div>
        )}
      </ProjectModal>
    </div>
  );
}

export default ProjectDetail;
