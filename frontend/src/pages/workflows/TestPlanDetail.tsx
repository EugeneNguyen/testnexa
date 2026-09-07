/**
 * TestPlan detail page (PLAN-1, ADR-0031, UI Design Document
 * `docs/ui-design/2026-09-06-plan-1-test-plan-membership-ui-design.md`).
 * Route: `/projects/:projectId/test-plans/:testPlanId`.
 *
 * Deliberately a route of its own rather than another `ProjectDetail`
 * expand-in-place section — every prior REQ-* story folded its bespoke UI into
 * `ProjectDetail`, but a `TestPlan` is its own multi-part object (this story's
 * suite membership + coverage, plus PLAN-2's entry/exit criteria and PLAN-3's
 * TestCycle view), so it gets its own addressable URL rather than a
 * plan-selection sub-state inside an already-large page (UI Design Document
 * §1). `ProjectDetail` only gains a thin "Test Plans" list whose rows link
 * here.
 *
 * Five sections — PLAN-1's three, per §2, plus PLAN-2's fourth and PLAN-3's
 * fifth:
 *
 * 1. **Header card** — identifier, `status` as a colour-coded `CBadge`, and
 *    scope/approach/staffing/schedule as labelled read-only text blocks. Its
 *    "Edit" modal reuses the generic admin surface's own `TestPlan` field
 *    config (`entityConfigs/test-plan.ts`) rendered through the same
 *    `EntityForm` the admin pages use — not a second, independently-maintained
 *    form. `project_id` is filtered out of that config here: it's this route's
 *    own fixed scope and the backend's `UpdateTestPlanRequest` doesn't accept
 *    it anyway.
 * 2. **Test Suites** — the live membership list (`GET
 *    /test-plans/{id}/test-suites`), an "Include Suite" modal, and a per-row
 *    "Remove". A flat `<ul>`/`<li>`, never a nested `<CTable>`, per
 *    `frontend/CLAUDE.md`'s nested-table a11y-name gotcha.
 * 3. **Covered Test Cases** — the read-only two-hop coverage query (`GET
 *    /test-plans/{id}/test-cases`), re-fetched on every successful include or
 *    remove above, so the coverage view never silently drifts from the
 *    membership that produces it (§2). No per-row actions: it's a derived view.
 * 4. **Entry/Exit Criteria** (PLAN-2, ADR-0032, UI Design Document
 *    `docs/ui-design/2026-09-06-plan-2-entry-exit-criteria-visibility-ui-design.md`
 *    §1) — full CRUD (list/add/edit/delete) over `GET|POST|PATCH|DELETE
 *    /entry-exit-criteria`, driven entirely through the generic
 *    `entityCrud.ts` helpers against `entityConfigs/entry-exit-criteria.ts`.
 *    No new API-lib file: the generic list route already filters by
 *    `?test_plan_id=`, so no bespoke `/test-plans/{id}/entry-exit-criteria`
 *    route was added either (ADR-0032's own "Alternatives considered").
 *    `test_plan_id` is fixed to this route's own scope and filtered out of the
 *    visible field list, exactly as `editConfig` above does for
 *    `TestPlan.project_id`. Unlike the Test Suites section, this one gets
 *    `PATCH` too — criteria are freestanding rows, not join-table membership.
 * 5. **Test Cycles** (PLAN-3, ADR-0033, UI Design Document
 *    `docs/ui-design/2026-09-06-plan-3-test-cycle-creation-ui-design.md`) —
 *    placed directly below Entry/Exit Criteria, per that document. The plan's
 *    own cycles (`GET /test-cycles?test_plan_id=<id>`, the generic factory
 *    list route) plus a bespoke "Create Cycle" modal submitting
 *    `POST /test-plans/{id}/test-cycles`. Create-and-view only: `TestCycle`'s
 *    edit/delete already exist on the generic admin surface, so each row links
 *    there ("View in Admin") rather than duplicating them here (§1).
 *    **As of EXEC-1 (ADR-0034) each row's *name* is additionally a link to
 *    that cycle's own `TestCycleDetail` screen** (execution history + live
 *    dashboard) — PLAN-3 left these rows as deliberate dead ends only because
 *    that screen did not exist yet. "View in Admin" is unchanged and still
 *    points at the generic edit form; the two links go to different places on
 *    purpose.
 *
 * All membership and criteria writes re-fetch rather than splicing local state
 * — same "always reflects the server's own current state" posture REQ-4
 * established.
 *
 * No permission-based hide/disable on the Edit/Include/Remove buttons (§5), nor
 * on PLAN-2's Add/Edit/Delete criteria buttons (ADR-0032) or PLAN-3's Create
 * Cycle button (ADR-0033): this is a bespoke workflow screen, so it keeps the
 * attempt-then-error convention every other one uses, not the generic admin
 * surface's ADR-0027 hide/disable rule. A `403` simply surfaces as the same
 * inline `CAlert` a `422`/`409` does.
 *
 * Non-goals (§6): no Approve/Supersede buttons (GOV-1's own `/approve` route),
 * no bulk-include, and — per PLAN-2's own UI Design Document §5 — no
 * bulk-add/bulk-edit or type-grouping of criteria rows. PLAN-3's own
 * non-goals hold too: no execution-recording UI and no pass/fail dashboard
 * (EXEC-1).
 *
 * Built with CoreUI (ADR-0012).
 */
import { useCallback, useEffect, useState } from "react";
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
  CContainer,
  CForm,
  CFormFeedback,
  CFormInput,
  CFormLabel,
  CFormSelect,
  CFormText,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CRow,
  CSpinner,
} from "@coreui/react";
import { ApiError } from "../../lib/api/client";
import {
  addTestSuiteToPlan,
  getTestPlan,
  listPlanTestCases,
  listPlanTestSuites,
  removeTestSuiteFromPlan,
  updateTestPlan,
  type TestPlanStatus,
  type TestPlanSummary,
  type UpdateTestPlanPayload,
} from "../../lib/api/testPlans";
import { listTestSuites, type TestSuiteSummary } from "../../lib/api/testSuites";
import type { TestCaseSummary } from "../../lib/api/testCases";
import { createTestCycle, type TestCycleSummary } from "../../lib/api/testCycles";
import type { EntryExitCriteriaSummary } from "../../lib/api/releases";
import { listReleases } from "../../lib/api/releases";
import {
  createEntity,
  deleteEntity,
  listEntities,
  updateEntity,
  type EntityRow,
} from "../../lib/api/entityCrud";
import EntityForm from "../../components/crud/EntityForm";
import FkAutocomplete from "../../components/crud/FkAutocomplete";
import testPlanConfig from "../../entityConfigs/test-plan";
import testCycleConfig from "../../entityConfigs/test-cycle";
import environmentConfig from "../../entityConfigs/environment";
import entryExitCriteriaConfig from "../../entityConfigs/entry-exit-criteria";
import type { EntityConfig } from "../../entityConfigs/types";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * PLAN-3 "Create Cycle" form (UI Design Document §2). Its own schema, *not*
 * `entityConfigs/test-cycle.ts`'s field list — that config describes the
 * generic-admin list/edit surface, which has no `create` at all (ADR-0033
 * keeps `TestCycle` creation bespoke-only).
 *
 * `releaseId`/`environmentId` are `FkAutocomplete`-driven, so "required" here
 * means "a selection was made" — the same posture `ProjectDetail`'s
 * select-driven `testLevelId`/`testTypeId` take.
 *
 * `newEnvironment` is the inline "+ New Environment" toggle. It lives in the
 * form state rather than beside it precisely so the conditional requirement it
 * controls can be expressed here, in one place: with the toggle on,
 * `newEnvironmentName` becomes required and `environmentId` is not needed at
 * all (it doesn't exist yet); with it off, the reverse.
 *
 * No cross-field `endDate >= startDate` rule — §4 explicitly rules it out as
 * validation no acceptance criterion asks for.
 */
const newTestCycleSchema = z
  .object({
    releaseId: z.string().trim().min(1, "Release is required"),
    environmentId: z.string().trim().optional(),
    name: z.string().trim().min(1, "Name is required"),
    startDate: z.string().trim().optional(),
    endDate: z.string().trim().optional(),
    newEnvironment: z.boolean(),
    newEnvironmentName: z.string().trim().optional(),
    newEnvironmentConfigNotes: z.string().trim().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.newEnvironment) {
      if (!values.newEnvironmentName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newEnvironmentName"],
          message: "Environment name is required",
        });
      }
      return;
    }
    if (!values.environmentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["environmentId"],
        message: "Environment is required",
      });
    }
  });

type NewTestCycleFormValues = z.infer<typeof newTestCycleSchema>;

const EMPTY_CYCLE_FORM: NewTestCycleFormValues = {
  releaseId: "",
  environmentId: "",
  name: "",
  startDate: "",
  endDate: "",
  newEnvironment: false,
  newEnvironmentName: "",
  newEnvironmentConfigNotes: "",
};

/** `start_date`–`end_date`, either side possibly null (both columns are nullable). */
function cycleDateRange(cycle: TestCycleSummary): string {
  return `${cycle.start_date ?? "—"} – ${cycle.end_date ?? "—"}`;
}

/**
 * The generic admin `TestPlan` config minus its `project_id` field — the same
 * field list, same labels, same enum values, just without the scope field this
 * route already fixes (and which `UpdateTestPlanRequest` doesn't accept). Built
 * once at module scope: it's a pure derivation of a static config.
 */
const editConfig: EntityConfig = {
  ...testPlanConfig,
  fields: testPlanConfig.fields.filter((field) => field.name !== "project_id"),
};

/**
 * The generic admin `EntryExitCriteria` config minus its `test_plan_id` field
 * — exactly the same derivation `editConfig` above performs for
 * `TestPlan.project_id`, and for the same reason: this route already fixes the
 * plan, so the field is neither shown nor user-editable. `test_plan_id` is
 * merged back into the `create` payload by `onSubmitCriteria` itself (PLAN-2 UI
 * Design Document §1); `update` never sends it, matching the backend's
 * "scope fields aren't reassignable through PATCH" posture.
 */
const criteriaConfig: EntityConfig = {
  ...entryExitCriteriaConfig,
  fields: entryExitCriteriaConfig.fields.filter((field) => field.name !== "test_plan_id"),
};

/**
 * PLAN-2 UI Design Document §1's four-colour criteria-type mapping — a
 * first-pass convention for this section only, not a general-purpose palette.
 */
function criteriaTypeColor(type: string): string {
  switch (type) {
    case "entry":
      return "info";
    case "exit":
      return "success";
    case "suspension":
      return "warning";
    default:
      return "secondary";
  }
}

/** UI Design Document §2's colour mapping — not a general-purpose status palette. */
function statusColor(status: TestPlanStatus): string {
  switch (status) {
    case "approved":
      return "success";
    case "superseded":
      return "dark";
    default:
      return "secondary";
  }
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : GENERIC_ERROR;
}

/**
 * Pulls a `422` field-level message out of an `ApiError`'s body, same
 * convention as `ProjectDetail.tsx`'s own `fieldError` helper — flattened to
 * the `Record<string, string>` shape `EntityForm.serverFieldErrors` expects.
 */
function serverFieldErrors(err: unknown): Record<string, string> | undefined {
  if (!(err instanceof ApiError)) {
    return undefined;
  }
  const body = err.body as { field_errors?: Record<string, unknown> } | undefined;
  const raw = body?.field_errors;
  if (!raw) {
    return undefined;
  }
  const mapped: Record<string, string> = {};
  for (const [field, message] of Object.entries(raw)) {
    mapped[field] = Array.isArray(message) ? String(message[0]) : String(message);
  }
  return mapped;
}

function TextBlock({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="mb-3">
      <div className="text-body-secondary small text-uppercase">{label}</div>
      <div className="mb-0" style={{ whiteSpace: "pre-wrap" }}>
        {value ? value : "—"}
      </div>
    </div>
  );
}

function TestPlanDetail() {
  const { projectId, testPlanId } = useParams<{ projectId: string; testPlanId: string }>();

  const [plan, setPlan] = useState<TestPlanSummary | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [planLoadError, setPlanLoadError] = useState<string | null>(null);

  // Header "Edit" modal. `editApiError` carries the non-field failures —
  // including `409 invalid_status_transition`, which renders as an inline
  // `CAlert` *inside* the modal (§4), never a toast and never a silent revert.
  const [showEditModal, setShowEditModal] = useState(false);
  const [editApiError, setEditApiError] = useState<string | null>(null);
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string> | undefined>(
    undefined,
  );

  // Included suites (live, `GET /test-plans/{id}/test-suites`).
  const [includedSuites, setIncludedSuites] = useState<TestSuiteSummary[]>([]);
  const [suitesLoading, setSuitesLoading] = useState(true);
  const [suitesLoadError, setSuitesLoadError] = useState<string | null>(null);
  // `422` (cross-project) / `409 already_included_in_plan` / `403`, rendered as
  // a dismissible `CAlert` directly under the section header (§2).
  const [membershipError, setMembershipError] = useState<string | null>(null);

  // The project's own suites — the "Include Suite" dropdown's options. Fetched
  // on page load rather than on modal open so the "project has zero suites"
  // disabled/placeholder state (§5) is known before the modal renders.
  const [projectSuites, setProjectSuites] = useState<TestSuiteSummary[]>([]);
  const [showIncludeModal, setShowIncludeModal] = useState(false);
  const [selectedSuiteId, setSelectedSuiteId] = useState("");
  const [includeSubmitting, setIncludeSubmitting] = useState(false);

  // Coverage (read-only, derived — never edited directly).
  const [coverage, setCoverage] = useState<TestCaseSummary[]>([]);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageError, setCoverageError] = useState<string | null>(null);

  // Entry/Exit Criteria (PLAN-2, ADR-0032) — full CRUD via the generic
  // `entityCrud` helpers, list filtered to this route's own plan.
  const [criteria, setCriteria] = useState<EntryExitCriteriaSummary[]>([]);
  const [criteriaLoading, setCriteriaLoading] = useState(true);
  const [criteriaLoadError, setCriteriaLoadError] = useState<string | null>(null);
  // `422`/`403`/`409` from an add/edit/delete — the dismissible `CAlert` under
  // the section header, same convention as `membershipError` above.
  const [criteriaError, setCriteriaError] = useState<string | null>(null);
  // `null` when closed; `{ row: null }` = create, `{ row }` = edit that row.
  const [criteriaModal, setCriteriaModal] = useState<{ row: EntryExitCriteriaSummary | null } | null>(
    null,
  );
  const [criteriaFieldErrors, setCriteriaFieldErrors] = useState<
    Record<string, string> | undefined
  >(undefined);

  // --- PLAN-3 (ADR-0033): Test Cycles section -------------------------------
  const [cycles, setCycles] = useState<TestCycleSummary[]>([]);
  const [cyclesLoading, setCyclesLoading] = useState(true);
  const [cyclesLoadError, setCyclesLoadError] = useState<string | null>(null);
  // `422` (cross-project release/environment) / `403`, rendered as a
  // dismissible `CAlert` directly under the section header (§1), same
  // convention as `membershipError` above.
  const [cycleError, setCycleError] = useState<string | null>(null);
  // Label lookups for the list's FK columns: the project's own releases and
  // environments, fetched once each and indexed by id (§1 — resolved
  // client-side, not by a denormalized server response).
  const [releaseLabels, setReleaseLabels] = useState<Record<string, string>>({});
  const [environmentLabels, setEnvironmentLabels] = useState<Record<string, string>>({});
  const [showCycleModal, setShowCycleModal] = useState(false);

  const {
    register: registerCycle,
    handleSubmit: handleSubmitCycle,
    reset: resetCycle,
    setValue: setCycleValue,
    watch: watchCycle,
    formState: { errors: cycleErrors, isSubmitting: isSubmittingCycle },
  } = useForm<NewTestCycleFormValues>({
    resolver: zodResolver(newTestCycleSchema),
    defaultValues: EMPTY_CYCLE_FORM,
  });

  const newEnvironmentActive = watchCycle("newEnvironment");
  const selectedReleaseId = watchCycle("releaseId");
  const selectedEnvironmentId = watchCycle("environmentId");

  const fetchPlan = useCallback(async () => {
    if (!testPlanId) {
      return;
    }
    setPlanLoading(true);
    setPlanLoadError(null);
    try {
      setPlan(await getTestPlan(testPlanId));
    } catch (err) {
      setPlanLoadError(errorMessage(err));
    } finally {
      setPlanLoading(false);
    }
  }, [testPlanId]);

  const fetchIncludedSuites = useCallback(async () => {
    if (!testPlanId) {
      return;
    }
    setSuitesLoading(true);
    setSuitesLoadError(null);
    try {
      const response = await listPlanTestSuites(testPlanId);
      setIncludedSuites(response.items);
    } catch (err) {
      setSuitesLoadError(errorMessage(err));
    } finally {
      setSuitesLoading(false);
    }
  }, [testPlanId]);

  const fetchCoverage = useCallback(async () => {
    if (!testPlanId) {
      return;
    }
    setCoverageLoading(true);
    setCoverageError(null);
    try {
      const response = await listPlanTestCases(testPlanId);
      setCoverage(response.items);
    } catch (err) {
      setCoverageError(errorMessage(err));
    } finally {
      setCoverageLoading(false);
    }
  }, [testPlanId]);

  /**
   * `GET /entry-exit-criteria?test_plan_id=<id>` through the generic list
   * helper — the same route and config the generic admin surface uses, just
   * pre-filtered to this plan instead of scope-selected by the user.
   */
  const fetchCriteria = useCallback(async () => {
    if (!testPlanId) {
      return;
    }
    setCriteriaLoading(true);
    setCriteriaLoadError(null);
    try {
      const response = await listEntities<EntryExitCriteriaSummary>(
        criteriaConfig,
        {},
        { params: { test_plan_id: testPlanId } },
      );
      setCriteria(response.items);
    } catch (err) {
      setCriteriaLoadError(errorMessage(err));
    } finally {
      setCriteriaLoading(false);
    }
  }, [testPlanId]);

  const fetchProjectSuites = useCallback(async () => {
    if (!projectId) {
      return;
    }
    try {
      const response = await listTestSuites(projectId);
      setProjectSuites(response.items);
    } catch {
      // A failed options fetch leaves the dropdown in its own documented
      // empty/disabled state (§5) — the page's own membership/coverage views
      // are unaffected, so this doesn't get its own page-level alert.
      setProjectSuites([]);
    }
  }, [projectId]);

  /**
   * The plan's own cycles — `GET /test-cycles?test_plan_id=<id>`, the existing
   * generic factory list route via `entityCrud.ts`'s generic helper (§1: no
   * bespoke API-lib call is needed for *reading*, only for creating).
   */
  const fetchCycles = useCallback(async () => {
    if (!testPlanId) {
      return;
    }
    setCyclesLoading(true);
    setCyclesLoadError(null);
    try {
      const response = await listEntities<TestCycleSummary>(
        testCycleConfig,
        {},
        { params: { test_plan_id: testPlanId } },
      );
      setCycles(response.items);
    } catch (err) {
      setCyclesLoadError(errorMessage(err));
    } finally {
      setCyclesLoading(false);
    }
  }, [testPlanId]);

  /**
   * The project's releases, indexed `id -> version_label` for the cycle list's
   * own FK column. A failed fetch degrades to showing the raw id rather than
   * taking the whole section down — the labels are decoration on rows that are
   * already loaded.
   */
  const fetchReleaseLabels = useCallback(async () => {
    if (!projectId) {
      return;
    }
    try {
      const response = await listReleases(projectId);
      setReleaseLabels(
        Object.fromEntries(response.items.map((release) => [release.id, release.version_label])),
      );
    } catch {
      setReleaseLabels({});
    }
  }, [projectId]);

  /** Same, for `id -> name` over the project's `Environment` rows. */
  const fetchEnvironmentLabels = useCallback(async () => {
    if (!projectId) {
      return;
    }
    try {
      const response = await listEntities<EntityRow>(
        environmentConfig,
        {},
        { params: { project_id: projectId } },
      );
      setEnvironmentLabels(
        Object.fromEntries(response.items.map((row) => [String(row.id), String(row.name ?? row.id)])),
      );
    } catch {
      setEnvironmentLabels({});
    }
  }, [projectId]);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  useEffect(() => {
    fetchIncludedSuites();
  }, [fetchIncludedSuites]);

  useEffect(() => {
    fetchCoverage();
  }, [fetchCoverage]);

  useEffect(() => {
    fetchCriteria();
  }, [fetchCriteria]);

  useEffect(() => {
    fetchProjectSuites();
  }, [fetchProjectSuites]);

  useEffect(() => {
    fetchCycles();
  }, [fetchCycles]);

  useEffect(() => {
    fetchReleaseLabels();
  }, [fetchReleaseLabels]);

  useEffect(() => {
    fetchEnvironmentLabels();
  }, [fetchEnvironmentLabels]);

  function openEditModal() {
    setEditApiError(null);
    setEditFieldErrors(undefined);
    setShowEditModal(true);
  }

  function closeEditModal() {
    setShowEditModal(false);
  }

  /**
   * `EntityForm` hands back one key per editable field. Sent as-is: the
   * backend's `PATCH` is a partial update, and re-sending an unchanged value is
   * a no-op for every field *except* `status`, whose unchanged value is itself
   * an illegal (idempotent) transition — so the transition guard only ever
   * fires on a status the user actually left alone after opening the modal,
   * which §4 explicitly wants surfaced rather than hidden.
   */
  async function onSubmitEdit(values: Record<string, unknown>) {
    if (!testPlanId || !plan) {
      return;
    }
    setEditApiError(null);
    setEditFieldErrors(undefined);
    const payload: UpdateTestPlanPayload = {};
    for (const field of editConfig.fields) {
      if (field.readOnly || !(field.name in values)) {
        continue;
      }
      const value = values[field.name];
      if (field.name === "status") {
        // Unchanged status omitted: ADR-0031's guard treats a same-value write
        // as an illegal (idempotent) transition, and "the user edited only the
        // scope text" must not turn into a spurious 409.
        if (typeof value === "string" && value && value !== plan.status) {
          payload.status = value as TestPlanStatus;
        }
        continue;
      }
      (payload as Record<string, unknown>)[field.name] = value;
    }
    try {
      await updateTestPlan(testPlanId, payload);
      setShowEditModal(false);
      await fetchPlan();
    } catch (err) {
      const fields = serverFieldErrors(err);
      if (fields) {
        setEditFieldErrors(fields);
      } else {
        // `409 invalid_status_transition` lands here — the modal stays open and
        // renders this inline (§4).
        setEditApiError(errorMessage(err));
      }
    }
  }

  function openIncludeModal() {
    setSelectedSuiteId("");
    setShowIncludeModal(true);
  }

  function closeIncludeModal() {
    setShowIncludeModal(false);
  }

  /**
   * Include the selected suite. On success both sections are re-fetched — the
   * membership list and the coverage query invalidate together (§2), which is
   * the mechanism behind "the coverage view never silently drifts."
   *
   * On failure the modal closes and the reason renders as the section-header
   * `CAlert` (§2 places the `422`/`409` there, next to the list the action was
   * about, rather than inside a modal the user has finished with).
   */
  async function onSubmitInclude() {
    if (!testPlanId || !selectedSuiteId) {
      return;
    }
    setMembershipError(null);
    setIncludeSubmitting(true);
    try {
      await addTestSuiteToPlan(testPlanId, selectedSuiteId);
      setShowIncludeModal(false);
      await Promise.all([fetchIncludedSuites(), fetchCoverage()]);
    } catch (err) {
      setShowIncludeModal(false);
      setMembershipError(errorMessage(err));
    } finally {
      setIncludeSubmitting(false);
    }
  }

  /**
   * Remove a suite, then re-fetch both sections — not an optimistic local
   * splice, so the view always reflects the server's own current state,
   * including after a failed remove where the suite is still included.
   */
  async function onRemoveSuite(testSuiteId: string) {
    if (!testPlanId) {
      return;
    }
    setMembershipError(null);
    try {
      await removeTestSuiteFromPlan(testPlanId, testSuiteId);
    } catch (err) {
      setMembershipError(errorMessage(err));
    }
    await Promise.all([fetchIncludedSuites(), fetchCoverage()]);
  }

  // --- Entry/Exit Criteria (PLAN-2, ADR-0032) --------------------------------

  function openCriteriaModal(row: EntryExitCriteriaSummary | null) {
    setCriteriaFieldErrors(undefined);
    setCriteriaModal({ row });
  }

  function closeCriteriaModal() {
    setCriteriaModal(null);
  }

  /**
   * One handler for both modes: `create` merges this route's own
   * `test_plan_id` into the payload (the field is filtered out of
   * `criteriaConfig`, so `EntityForm` never emits it), `edit` sends only the
   * editable fields — the backend's `UpdateEntryExitCriteriaRequest` doesn't
   * accept a scope reassignment.
   *
   * On success the modal closes and the list is re-fetched rather than
   * spliced, same posture as every other section on this screen.
   *
   * On failure, a `422` that carries `field_errors` keeps the modal open and
   * puts each message on its own field (the only place a per-field message can
   * meaningfully render); anything else — `403`, `409`, a field-less `422`,
   * a network failure — closes the modal and surfaces as the dismissible
   * section-header `CAlert` (§1), the same handling `onSubmitInclude` gives
   * the Test Suites section's own failures.
   */
  async function onSubmitCriteria(values: Record<string, unknown>) {
    if (!testPlanId || !criteriaModal) {
      return;
    }
    setCriteriaError(null);
    setCriteriaFieldErrors(undefined);
    const editing = criteriaModal.row;
    try {
      if (editing) {
        await updateEntity(criteriaConfig, editing.id, values);
      } else {
        await createEntity(criteriaConfig, {}, { ...values, test_plan_id: testPlanId });
      }
      setCriteriaModal(null);
      await fetchCriteria();
    } catch (err) {
      const fields = serverFieldErrors(err);
      if (fields) {
        setCriteriaFieldErrors(fields);
      } else {
        setCriteriaModal(null);
        setCriteriaError(errorMessage(err));
      }
    }
  }

  /**
   * Delete a criteria row — no confirmation modal, same no-confirm convention
   * the Test Suites section's "Remove" already uses (§1). Re-fetches either
   * way, so a failed delete leaves the row visible next to its own error
   * rather than optimistically vanishing.
   */
  async function onDeleteCriteria(id: string) {
    if (!testPlanId) {
      return;
    }
    setCriteriaError(null);
    try {
      await deleteEntity(criteriaConfig, id);
    } catch (err) {
      setCriteriaError(errorMessage(err));
    }
    await fetchCriteria();
  }

  // --- PLAN-3 "Create Cycle" -------------------------------------------------

  function openCycleModal() {
    resetCycle(EMPTY_CYCLE_FORM);
    setShowCycleModal(true);
  }

  function closeCycleModal() {
    setShowCycleModal(false);
  }

  /**
   * §3: toggling the inline "+ New Environment" affordance either way
   * **discards** whatever was on the side being left — a typed-then-abandoned
   * environment name doesn't survive a round trip back to the autocomplete,
   * and a previously-picked `environment_id` doesn't survive switching to
   * inline create. No draft persistence, in either direction.
   */
  function toggleNewEnvironment() {
    setCycleValue("newEnvironment", !newEnvironmentActive);
    setCycleValue("environmentId", "");
    setCycleValue("newEnvironmentName", "");
    setCycleValue("newEnvironmentConfigNotes", "");
  }

  /**
   * Create the cycle — in **two sequential requests** when the inline
   * environment toggle is active (ADR-0033 Decision #4): `POST /environments`
   * first, then `POST /test-plans/{id}/test-cycles` with the id it returned.
   * Not one atomic call: `environment_id` is a plain FK with no link-table
   * side effect, so there's no atomicity property the two calls lose.
   *
   * The `await` ordering is load-bearing, not incidental — if the first call
   * rejects (e.g. `403`, caller lacks `environment.create`), control leaves
   * this `try` before `createTestCycle` is ever reached, and that first
   * failure is the only one surfaced (§1). §3's converse case — the
   * environment is created and *then* the cycle create fails — deliberately
   * leaves the new `Environment` row in place; it simply becomes selectable
   * through the plain autocomplete on the next attempt, which is why the
   * environment labels are re-fetched on the failure path too.
   */
  async function onSubmitCycle(values: NewTestCycleFormValues) {
    if (!testPlanId || !projectId) {
      return;
    }
    setCycleError(null);
    try {
      let environmentId = values.environmentId ?? "";
      if (values.newEnvironment) {
        const created = await createEntity<EntityRow>(
          environmentConfig,
          {},
          {
            project_id: projectId,
            name: values.newEnvironmentName,
            config_notes: values.newEnvironmentConfigNotes ? values.newEnvironmentConfigNotes : null,
          },
        );
        environmentId = String(created.id);
      }
      await createTestCycle(testPlanId, {
        release_id: values.releaseId,
        environment_id: environmentId,
        name: values.name,
        start_date: values.startDate ? values.startDate : null,
        end_date: values.endDate ? values.endDate : null,
      });
      setShowCycleModal(false);
      // Re-fetch, never a local splice (§1) — and re-fetch the environment
      // labels too, so an inline-created one resolves to its name immediately.
      await Promise.all([fetchCycles(), fetchEnvironmentLabels()]);
    } catch (err) {
      setShowCycleModal(false);
      setCycleError(errorMessage(err));
      await fetchEnvironmentLabels();
    }
  }

  if (!projectId || !testPlanId) {
    return null;
  }

  const hasProjectSuites = projectSuites.length > 0;

  return (
    <div className="min-vh-100 bg-body-secondary py-4">
      <CContainer>
        <CRow className="justify-content-center">
          <CCol md={10} lg={8}>
            {/* --- Header card ------------------------------------------- */}
            <CCard>
              <CCardBody className="p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h1 className="fs-4 mb-0">
                    {plan ? plan.identifier : "Test plan"}{" "}
                    {plan && (
                      <CBadge color={statusColor(plan.status)} data-testid="test-plan-status">
                        {plan.status}
                      </CBadge>
                    )}
                  </h1>
                  <div className="d-flex gap-2">
                    <CButton
                      color="secondary"
                      variant="outline"
                      as={Link}
                      to={`/projects/${projectId}`}
                      data-testid="back-to-project"
                    >
                      Back to project
                    </CButton>
                    <CButton
                      color="primary"
                      data-testid="edit-test-plan-btn"
                      disabled={!plan}
                      onClick={openEditModal}
                    >
                      Edit
                    </CButton>
                  </div>
                </div>

                {planLoadError && (
                  <CAlert color="danger" role="alert" data-testid="test-plan-load-error">
                    {planLoadError}
                  </CAlert>
                )}

                {planLoading ? (
                  <div className="d-flex justify-content-center py-4">
                    <CSpinner color="primary" />
                  </div>
                ) : (
                  plan && (
                    <div data-testid="test-plan-fields">
                      <TextBlock label="Scope" value={plan.scope} />
                      <TextBlock label="Approach" value={plan.approach} />
                      <TextBlock label="Staffing & training" value={plan.staffing_and_training} />
                      <TextBlock label="Schedule" value={plan.schedule} />
                    </div>
                  )
                )}
              </CCardBody>
            </CCard>

            {/* --- Test Suites (membership) ------------------------------- */}
            <CCard className="mt-4">
              <CCardBody className="p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h2 className="fs-5 mb-0">Test Suites</h2>
                  <CButton color="primary" data-testid="include-suite-btn" onClick={openIncludeModal}>
                    Include Suite
                  </CButton>
                </div>

                {/*
                  §2: a `422` (cross-project) or `409 already_included_in_plan`
                  renders here — directly under the section header, dismissible,
                  never a toast.
                */}
                {membershipError && (
                  <CAlert
                    color="danger"
                    role="alert"
                    dismissible
                    data-testid="membership-error"
                    onClose={() => setMembershipError(null)}
                  >
                    {membershipError}
                  </CAlert>
                )}

                {suitesLoadError && (
                  <CAlert color="danger" role="alert" data-testid="included-suites-error">
                    {suitesLoadError}
                  </CAlert>
                )}

                {suitesLoading ? (
                  <div className="d-flex justify-content-center py-3">
                    <CSpinner color="primary" />
                  </div>
                ) : !suitesLoadError && includedSuites.length === 0 ? (
                  <p className="text-body-secondary mb-0">No test suites included yet.</p>
                ) : (
                  !suitesLoadError && (
                    /* Flat <ul>/<li>, not a nested <CTable> — frontend/CLAUDE.md. */
                    <ul className="list-unstyled mb-0" data-testid="included-suite-list">
                      {includedSuites.map((suite) => (
                        <li
                          key={suite.id}
                          className="d-flex justify-content-between align-items-center border-bottom py-2 gap-2"
                          data-testid={`included-suite-${suite.id}`}
                        >
                          <span>
                            {suite.name}{" "}
                            {suite.purpose && <CBadge color="info">{suite.purpose}</CBadge>}
                          </span>
                          <CButton
                            color="danger"
                            variant="outline"
                            size="sm"
                            data-testid={`remove-suite-${suite.id}`}
                            onClick={() => onRemoveSuite(suite.id)}
                          >
                            Remove
                          </CButton>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </CCardBody>
            </CCard>

            {/* --- Covered Test Cases (derived, read-only) ---------------- */}
            <CCard className="mt-4">
              <CCardBody className="p-4">
                <h2 className="fs-5 mb-3">Covered Test Cases</h2>

                {coverageError && (
                  <CAlert color="danger" role="alert" data-testid="coverage-error">
                    {coverageError}
                  </CAlert>
                )}

                {coverageLoading ? (
                  <div className="d-flex justify-content-center py-3">
                    <CSpinner color="primary" />
                  </div>
                ) : !coverageError && coverage.length === 0 ? (
                  /*
                    Distinct wording from the suites section's own empty state
                    above (§5) — but one message for both causes (no suites
                    included, or included suites with no members), which this
                    first pass deliberately doesn't distinguish.
                  */
                  <p className="text-body-secondary mb-0">No test cases covered yet</p>
                ) : (
                  !coverageError && (
                    /* Flat <ul>/<li>, same nesting-avoidance reasoning as above. */
                    <ul className="list-unstyled mb-0" data-testid="coverage-list">
                      {coverage.map((testCase) => (
                        <li
                          key={testCase.id}
                          className="border-bottom py-2"
                          data-testid={`covered-test-case-${testCase.id}`}
                        >
                          {testCase.title} <CBadge color="secondary">{testCase.status}</CBadge>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </CCardBody>
            </CCard>

            {/* --- Entry/Exit Criteria (PLAN-2, ADR-0032, §1) -------------- */}
            <CCard className="mt-4">
              <CCardBody className="p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h2 className="fs-5 mb-0">Entry/Exit Criteria</h2>
                  <CButton
                    color="primary"
                    data-testid="add-criteria-btn"
                    onClick={() => openCriteriaModal(null)}
                  >
                    Add Criteria
                  </CButton>
                </div>

                {/* §1: a `422`/`403`/`409` from add/edit/delete renders here. */}
                {criteriaError && (
                  <CAlert
                    color="danger"
                    role="alert"
                    dismissible
                    data-testid="criteria-error"
                    onClose={() => setCriteriaError(null)}
                  >
                    {criteriaError}
                  </CAlert>
                )}

                {criteriaLoadError && (
                  <CAlert color="danger" role="alert" data-testid="criteria-load-error">
                    {criteriaLoadError}
                  </CAlert>
                )}

                {criteriaLoading ? (
                  <div className="d-flex justify-content-center py-3">
                    <CSpinner color="primary" />
                  </div>
                ) : !criteriaLoadError && criteria.length === 0 ? (
                  <p className="text-body-secondary mb-0">No entry/exit criteria defined yet.</p>
                ) : (
                  !criteriaLoadError && (
                    /* Flat <ul>/<li>, same nesting-avoidance reasoning as above. */
                    <ul className="list-unstyled mb-0" data-testid="criteria-list">
                      {criteria.map((row) => (
                        <li
                          key={row.id}
                          className="d-flex justify-content-between align-items-center border-bottom py-2 gap-2"
                          data-testid={`criteria-${row.id}`}
                        >
                          <span>
                            <CBadge color={criteriaTypeColor(row.type)}>{row.type}</CBadge>{" "}
                            {row.condition_text}
                          </span>
                          <span className="d-flex gap-2">
                            <CButton
                              color="primary"
                              variant="outline"
                              size="sm"
                              data-testid={`edit-criteria-${row.id}`}
                              onClick={() => openCriteriaModal(row)}
                            >
                              Edit
                            </CButton>
                            <CButton
                              color="danger"
                              variant="outline"
                              size="sm"
                              data-testid={`delete-criteria-${row.id}`}
                              onClick={() => onDeleteCriteria(row.id)}
                            >
                              Delete
                            </CButton>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </CCardBody>
            </CCard>

            {/* --- Test Cycles (PLAN-3, ADR-0033) ------------------------- */}
            <CCard className="mt-4">
              <CCardBody className="p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h2 className="fs-5 mb-0">Test Cycles</h2>
                  {/* §1: no permission-based hide/disable — attempt, then error. */}
                  <CButton color="primary" data-testid="create-cycle-btn" onClick={openCycleModal}>
                    Create Cycle
                  </CButton>
                </div>

                {/* §1: a `422` (cross-project release/environment) or `403`
                    renders here, directly under the section header. */}
                {cycleError && (
                  <CAlert
                    color="danger"
                    role="alert"
                    dismissible
                    data-testid="cycle-error"
                    onClose={() => setCycleError(null)}
                  >
                    {cycleError}
                  </CAlert>
                )}

                {cyclesLoadError && (
                  <CAlert color="danger" role="alert" data-testid="test-cycles-load-error">
                    {cyclesLoadError}
                  </CAlert>
                )}

                {cyclesLoading ? (
                  <div className="d-flex justify-content-center py-3">
                    <CSpinner color="primary" />
                  </div>
                ) : !cyclesLoadError && cycles.length === 0 ? (
                  <p className="text-body-secondary mb-0">No test cycles yet.</p>
                ) : (
                  !cyclesLoadError && (
                    /* Flat <ul>/<li>, same nesting-avoidance reasoning as above. */
                    <ul className="list-unstyled mb-0" data-testid="test-cycle-list">
                      {cycles.map((cycle) => (
                        <li
                          key={cycle.id}
                          className="d-flex justify-content-between align-items-center border-bottom py-2 gap-2"
                          data-testid={`test-cycle-${cycle.id}`}
                        >
                          <span>
                            {/*
                              EXEC-1 (ADR-0034): each cycle row's name is now a
                              link to that cycle's own detail screen — its
                              execution history and live dashboard. PLAN-3 left
                              these rows as documented dead ends precisely
                              because this screen didn't exist yet.
                            */}
                            <Link
                              to={`/projects/${projectId}/test-plans/${testPlanId}/test-cycles/${cycle.id}`}
                              data-testid={`open-test-cycle-${cycle.id}`}
                            >
                              {cycle.name}
                            </Link>{" "}
                            <span className="text-body-secondary small">{cycleDateRange(cycle)}</span>{" "}
                            <CBadge color="info">
                              {releaseLabels[cycle.release_id] ?? cycle.release_id}
                            </CBadge>{" "}
                            <CBadge color="secondary">
                              {environmentLabels[cycle.environment_id] ?? cycle.environment_id}
                            </CBadge>
                          </span>
                          {/*
                            §1: no Edit/Delete here — `TestCycle`'s PATCH/DELETE
                            already have a home on the generic admin surface, so
                            this section links there instead of duplicating them.
                          */}
                          <Link
                            to={`/projects/${projectId}/admin/test-cycles/${cycle.id}/edit`}
                            data-testid={`view-in-admin-${cycle.id}`}
                          >
                            View in Admin
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>
      </CContainer>

      {/* --- "Edit" modal: the generic admin field config, reused ---------- */}
      <CModal visible={showEditModal} onClose={closeEditModal} data-testid="edit-test-plan-modal">
        <CModalHeader>
          <CModalTitle>Edit Test Plan</CModalTitle>
        </CModalHeader>
        <CModalBody>
          {plan && (
            <EntityForm
              config={editConfig}
              mode="edit"
              initialValues={plan as unknown as Record<string, unknown>}
              onSubmit={onSubmitEdit}
              onCancel={closeEditModal}
              submitError={editApiError}
              serverFieldErrors={editFieldErrors}
            />
          )}
        </CModalBody>
      </CModal>

      {/* --- "Include Suite" modal ----------------------------------------- */}
      <CModal visible={showIncludeModal} onClose={closeIncludeModal} data-testid="include-suite-modal">
        <CModalHeader>
          <CModalTitle>Include Suite</CModalTitle>
        </CModalHeader>
        <CForm
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitInclude();
          }}
          noValidate
        >
          <CModalBody>
            <CFormLabel htmlFor="includeSuiteId">Test suite</CFormLabel>
            <CFormSelect
              id="includeSuiteId"
              data-testid="include-suite-select"
              value={selectedSuiteId}
              // §5: the project having no suites yet is an ordering dependency
              // made visible, not hidden — a disabled select saying where to go
              // create one, rather than an empty dropdown with no explanation.
              disabled={!hasProjectSuites}
              onChange={(event) => setSelectedSuiteId(event.target.value)}
            >
              {hasProjectSuites ? (
                <>
                  <option value="">Select a test suite…</option>
                  {projectSuites.map((suite) => (
                    <option key={suite.id} value={suite.id}>
                      {suite.name}
                    </option>
                  ))}
                </>
              ) : (
                <option value="">No suites yet — create one on the Test Suites page</option>
              )}
            </CFormSelect>
          </CModalBody>
          <CModalFooter>
            <CButton color="secondary" variant="outline" onClick={closeIncludeModal}>
              Cancel
            </CButton>
            <CButton
              type="submit"
              color="primary"
              data-testid="include-suite-submit"
              disabled={!selectedSuiteId || includeSubmitting}
            >
              {includeSubmitting ? "Including..." : "Include"}
            </CButton>
          </CModalFooter>
        </CForm>
      </CModal>

      {/* --- Criteria add/edit modal: the same generic config, reused ------ */}
      <CModal
        visible={criteriaModal !== null}
        onClose={closeCriteriaModal}
        data-testid="criteria-modal"
      >
        <CModalHeader>
          <CModalTitle>
            {criteriaModal?.row ? "Edit Criteria" : "Add Criteria"}
          </CModalTitle>
        </CModalHeader>
        <CModalBody>
          {criteriaModal && (
            <EntityForm
              // Remount between create and each edit target so RHF picks up
              // that row's own `defaultValues` — `EntityForm` reads
              // `initialValues` once, at mount.
              key={criteriaModal.row ? criteriaModal.row.id : "create"}
              config={criteriaConfig}
              mode={criteriaModal.row ? "edit" : "create"}
              initialValues={
                criteriaModal.row
                  ? (criteriaModal.row as unknown as Record<string, unknown>)
                  : undefined
              }
              onSubmit={onSubmitCriteria}
              onCancel={closeCriteriaModal}
              serverFieldErrors={criteriaFieldErrors}
            />
          )}
        </CModalBody>
      </CModal>

      {/* --- "Create Cycle" modal (PLAN-3, UI Design Document §2) ---------- */}
      <CModal visible={showCycleModal} onClose={closeCycleModal} data-testid="create-cycle-modal">
        <CModalHeader>
          <CModalTitle>Create Cycle</CModalTitle>
        </CModalHeader>
        <CForm onSubmit={handleSubmitCycle(onSubmitCycle)} noValidate>
          <CModalBody>
            {/*
              `FkAutocomplete` takes no `data-testid` of its own (it's the
              generic-admin widget, not this screen's), so each is wrapped in a
              stable testid container for e2e to scope into.

              `routeParams` matters for `release` specifically: its config's
              `listPath` is `/projects/:projectId/releases`, the one placeholder
              path in the registry.
            */}
            <div data-testid="create-cycle-release">
              <FkAutocomplete
                id="cycleReleaseId"
                label="Release"
                refEntity="release"
                labelField="version_label"
                value={selectedReleaseId || undefined}
                routeParams={{ projectId }}
                extraParams={{ project_id: projectId }}
                onChange={(id) => setCycleValue("releaseId", id ?? "", { shouldValidate: true })}
                error={cycleErrors.releaseId?.message}
              />
            </div>

            {newEnvironmentActive ? (
              /*
                §1: the toggle replaces *this one field* with the inline
                Environment create inputs — the rest of the form is untouched.
              */
              <>
                <div className="mb-3">
                  <CFormLabel htmlFor="newEnvironmentName">New environment name</CFormLabel>
                  <CFormInput
                    id="newEnvironmentName"
                    type="text"
                    data-testid="new-environment-name"
                    invalid={!!cycleErrors.newEnvironmentName}
                    {...registerCycle("newEnvironmentName")}
                  />
                  {cycleErrors.newEnvironmentName && (
                    <CFormFeedback invalid>{cycleErrors.newEnvironmentName.message}</CFormFeedback>
                  )}
                </div>
                <div className="mb-3">
                  <CFormLabel htmlFor="newEnvironmentConfigNotes">Config notes</CFormLabel>
                  <CFormInput
                    id="newEnvironmentConfigNotes"
                    type="text"
                    data-testid="new-environment-config-notes"
                    {...registerCycle("newEnvironmentConfigNotes")}
                  />
                  <CFormText>Optional.</CFormText>
                </div>
              </>
            ) : (
              <div data-testid="create-cycle-environment">
                <FkAutocomplete
                  id="cycleEnvironmentId"
                  label="Environment"
                  refEntity="environment"
                  labelField="name"
                  value={selectedEnvironmentId || undefined}
                  extraParams={{ project_id: projectId }}
                  onChange={(id) =>
                    setCycleValue("environmentId", id ?? "", { shouldValidate: true })
                  }
                  error={cycleErrors.environmentId?.message}
                />
              </div>
            )}

            <CButton
              color="link"
              size="sm"
              className="p-0 mb-3"
              type="button"
              data-testid="new-environment-toggle"
              onClick={toggleNewEnvironment}
            >
              {newEnvironmentActive ? "Use an existing environment" : "+ New Environment"}
            </CButton>

            <div className="mb-3">
              <CFormLabel htmlFor="cycleName">Name</CFormLabel>
              <CFormInput
                id="cycleName"
                type="text"
                data-testid="cycle-name"
                invalid={!!cycleErrors.name}
                {...registerCycle("name")}
              />
              {cycleErrors.name && <CFormFeedback invalid>{cycleErrors.name.message}</CFormFeedback>}
            </div>

            <div className="mb-3">
              <CFormLabel htmlFor="cycleStartDate">Start date</CFormLabel>
              <CFormInput
                id="cycleStartDate"
                type="date"
                data-testid="cycle-start-date"
                {...registerCycle("startDate")}
              />
              <CFormText>Optional.</CFormText>
            </div>

            <div className="mb-3">
              <CFormLabel htmlFor="cycleEndDate">End date</CFormLabel>
              <CFormInput
                id="cycleEndDate"
                type="date"
                data-testid="cycle-end-date"
                {...registerCycle("endDate")}
              />
              <CFormText>Optional.</CFormText>
            </div>
          </CModalBody>
          <CModalFooter>
            <CButton
              color="secondary"
              variant="outline"
              data-testid="create-cycle-cancel"
              onClick={closeCycleModal}
            >
              Cancel
            </CButton>
            <CButton
              type="submit"
              color="primary"
              data-testid="create-cycle-submit"
              disabled={isSubmittingCycle}
            >
              {isSubmittingCycle ? "Creating..." : "Create"}
            </CButton>
          </CModalFooter>
        </CForm>
      </CModal>
    </div>
  );
}

export default TestPlanDetail;
