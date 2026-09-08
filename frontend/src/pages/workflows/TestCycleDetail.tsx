/**
 * TestCycle detail page (EXEC-1, ADR-0034, UI Design Document
 * `docs/ui-design/2026-09-07-exec-1-test-execution-recording-ui-design.md`).
 * Route: `/projects/:projectId/test-plans/:testPlanId/test-cycles/:testCycleId`.
 *
 * The sitemap's reserved `TestExecutionRunner` path, partially resolved:
 * FR-EXEC-1 only. Nested under `TestPlanDetail`'s own route for the same
 * reason PLAN-1 gave `TestPlan` its own page rather than a `ProjectDetail`
 * expand-in-place section — a cycle's execution history plus its dashboard is
 * enough surface to need its own addressable URL. `TestPlanDetail`'s "Test
 * Cycles" section (PLAN-3) already anticipated this by treating each cycle row
 * as a link target; those rows now link here (previously dead ends).
 *
 * Three sections, dashboard **above** history per the UI Design Document §2's
 * prose and its own layout sketch (which agree — `docs/CLAUDE.md`'s standing
 * prose-vs-sketch rule):
 *
 * 1. **Dashboard** — four stat tiles (Pass/Fail/Blocked/Skipped). Each tile is
 *    its own independent `GET /test-executions?test_cycle_id=<id>&result=<value>
 *    &page_size=1` through the generic factory list route, reading only the
 *    response's `total` (ADR-0034: no new aggregate endpoint, the same
 *    "reuse existing list totals" posture FR-SHELL-3/ADR-0020 established).
 *    All four always render, `0` included — never a hidden/blank tile.
 * 2. **Execution history** — `GET /test-executions?test_cycle_id=<id>`, sorted
 *    `executed_at` **descending** client-side (the generic list route has no
 *    `sort` param — same client-side ordering `testSteps.ts` already documents).
 *    A flat `<ul>`/`<li>`, never a `<CTable>`, per `frontend/CLAUDE.md`.
 * 3. **Record Result modal** — `test_case_id` picker scoped to the plan's own
 *    coverage query, `result`, `actual_result`, `executed_at`.
 *
 * **The dashboard is refetched, never locally incremented.** After a
 * successful record, `refreshAfterRecord()` re-runs all four count calls *and*
 * the history fetch against the server. This is the literal mechanism behind
 * AC2's "live, not manually maintained" wording — there is no client-side
 * counter that could drift from the rows, and Test Design §30's "frontend
 * structural class" pins it by asserting a post-submit render reflects newly
 * mocked API responses rather than old-response-plus-one.
 *
 * --- Two documented deviations from the source docs -------------------------
 *
 * **1. Actor display falls back to the raw `actor_id`, and resolves only human
 * `User` actors.** ADR-0034 §Decision says `executed_by_actor_id` "resolves to
 * either a `User`'s name or an `AIAgent`'s name via whatever shared
 * actor-display convention `created_by_actor_id` already renders with
 * elsewhere on this screen family (no new mechanism)". **No such shared
 * mechanism exists** — verified across the whole frontend: nothing renders any
 * `*_actor_id` as a name anywhere, and the one place an actor id reaches the
 * screen at all (`RoleAssignmentsPanel.tsx`) renders the bare UUID in a
 * monospace cell. There is also no backend route that would let one exist:
 * there is no `GET /actors/{id}`, no `GET /users/{id}`, and `GET
 * /orgs/{org_id}/members` (the only actor-bearing read route) returns
 * `email` — not `name` — and only for `User` rows, never `AIAgent`s.
 *
 * Since ADR-0034 also says "no new backend route", this screen does the most
 * the existing API allows and no more: it indexes the org's members by
 * `user_id` (org resolved via `GET /projects/{projectId}`'s own `org_id`, the
 * same derivation `entityConfigs/project.ts`'s `scopeResolution` performs) and
 * displays that member's `email`. An `AIAgent` executor — or any actor absent
 * from the members list — renders its raw `actor_id`, matching
 * `RoleAssignmentsPanel`'s existing convention. A proper actor-display
 * mechanism covering both `Actor` subtypes needs a backend route and is
 * therefore its own decision, not something to invent silently inside this
 * story.
 *
 * **2. No permission-based hide/disable on "Record Result".** The UI Design
 * Document §5 says the button is "visible always; disabled/hidden per
 * `usePermissions`'s existing convention if the caller lacks
 * `test_execution.create`, same as every other create action across this app"
 * — which is self-contradictory ("visible always" vs. "hidden"), and its
 * "every other create action" claim does not hold for *this* screen family:
 * `TestPlanDetail`'s own docstring explicitly records the opposite decision
 * for all five of its sections ("No permission-based hide/disable ... this is
 * a bespoke workflow screen, so it keeps the attempt-then-error convention
 * every other one uses, not the generic admin surface's ADR-0027
 * hide/disable rule"). Consistency with the sibling screen wins: a `403`
 * surfaces as the same dismissible in-modal `CAlert` a `422` does (see
 * `onSubmitRecord`). Flagged rather than silently absorbed — same posture
 * PLAN-3's implementer took with ADR-0032's own prose/sketch contradiction.
 *
 * Non-goals (UI Design Document §6): no `TestLog` timeline (EXEC-2), no "Raise
 * Defect" affordance even on a `fail` (EXEC-3), and no edit/delete of a
 * recorded execution (`test_manager` holds neither `test_execution.update` nor
 * `.delete`, ADR-0033's own deliberate withholding).
 *
 * Built with CoreUI (ADR-0012).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
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
  CFormTextarea,
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
  createTestExecution,
  TEST_EXECUTION_RESULTS,
  type TestExecutionResultValue,
  type TestExecutionSummary,
} from "../../lib/api/testExecutions";
import { listPlanTestCases } from "../../lib/api/testPlans";
import {
  addTestExecutionComment,
  listTestExecutionLogs,
  type TestLogSummary,
} from "../../lib/api/testLogs";
import {
  createDefectForExecution,
  type DefectSeverityValue,
} from "../../lib/api/defects";
import { getProject } from "../../lib/api/projects";
import { listMembers } from "../../lib/api/members";
import { listEntities, getEntity, type EntityRow } from "../../lib/api/entityCrud";
import FkAutocomplete from "../../components/crud/FkAutocomplete";
import testExecutionConfig from "../../entityConfigs/test-execution";
import testCycleConfig from "../../entityConfigs/test-cycle";
import testCaseConfig from "../../entityConfigs/test-case";
import type { EntityConfig } from "../../entityConfigs/types";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * The history list's page size. The generic factory's own default page size is
 * small; a cycle's execution history is expected to be modest at scaffold
 * scale, so one generous page is fetched rather than building pagination UI no
 * acceptance criterion asks for. The *dashboard* is unaffected either way — it
 * reads `total`, which is the full count regardless of page size.
 */
const HISTORY_PAGE_SIZE = 200;

/**
 * The `test-case` registry config, re-pointed at PLAN-1's coverage query
 * (`GET /test-plans/{id}/test-cases`, ADR-0031) so the "Record Result" picker
 * offers exactly the `TestCase`s the backend's own scope-check would accept
 * (ADR-0034; TC-EXEC-010).
 *
 * Two overrides, both load-bearing:
 * - `listPath` uses the `:testPlanId` placeholder `entityCrud.interpolate`
 *   already supports, filled from `routeParams` (`frontend/CLAUDE.md`'s
 *   `:paramName` mechanism, added by PLAN-3 for `release`).
 * - `methods` gains `"list"`. The registry's `test-case` config deliberately
 *   omits it — there is no `GET /test-cases` route at all — so without this
 *   `FkAutocomplete` would render its disabled "search unavailable" state.
 *   That structural gap is real and unchanged; this override does not paper
 *   over it, it points at a *different*, plan-scoped route that does exist.
 *
 * Built once at module scope: a pure derivation of a static config, same
 * `{...config, ...}` shape as `TestPlanDetail`'s `editConfig`/`criteriaConfig`.
 */
const planScopedTestCaseConfig: EntityConfig = {
  ...testCaseConfig,
  listPath: "/test-plans/:testPlanId/test-cases",
  methods: [...testCaseConfig.methods, "list"],
};

/**
 * UI Design Document §4's four-colour result mapping (green/red/amber/gray) —
 * a convention for this section only, not a general-purpose palette.
 */
function resultColor(result: string): string {
  switch (result) {
    case "pass":
      return "success";
    case "fail":
      return "danger";
    case "blocked":
      return "warning";
    default:
      return "secondary";
  }
}

const recordResultSchema = z.object({
  testCaseId: z.string().trim().min(1, "Test case is required"),
  result: z.enum(["pass", "fail", "blocked", "skipped"]),
  actualResult: z.string().optional(),
  executedAt: z.string().trim().min(1, "Executed at is required"),
});

type RecordResultFormValues = z.infer<typeof recordResultSchema>;

const commentSchema = z.object({
  text: z.string().trim().min(1, "Comment text is required"),
  attachmentUrl: z.string().trim().optional(),
  fileName: z.string().trim().optional(),
});

type CommentFormValues = z.infer<typeof commentSchema>;

/** UI Design Document §2 (EXEC-3, ADR-0041): all four `DefectSeverity` values. */
const DEFECT_SEVERITIES: DefectSeverityValue[] = ["low", "medium", "high", "critical"];

const raiseDefectSchema = z.object({
  externalRef: z.string().trim().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  status: z.string().trim().optional(),
});

type RaiseDefectFormValues = z.infer<typeof raiseDefectSchema>;

/**
 * `TestLog.payload`'s per-`event_type` shape (`app/api/routes/execution.py`'s
 * `build_status_change_log`/`add_test_execution_comment`) rendered as one
 * short human-readable line — EXEC-2's timeline is read-only, so this is
 * display formatting only, not a typed contract the frontend depends on.
 */
function logSummaryLine(log: TestLogSummary): string {
  const payload = log.payload;
  switch (log.event_type === "agent_action" ? String(payload.kind) : log.event_type) {
    case "status_change": {
      const from = payload.from ? String(payload.from) : "(none)";
      const to = payload.to ? String(payload.to) : "(none)";
      return `Result changed: ${from} → ${to}`;
    }
    case "comment":
      return payload.text ? String(payload.text) : "(comment)";
    case "attachment": {
      const name = payload.file_name ? String(payload.file_name) : "attachment";
      const text = payload.text ? String(payload.text) : "";
      return text ? `${text} (${name})` : `Attachment: ${name}`;
    }
    default:
      return JSON.stringify(payload);
  }
}

/**
 * `agent_action` (an `AIAgent`-originated status change/comment/attachment,
 * `app/api/routes/execution.py`'s `_event_type_for_actor`) shows its own
 * badge color, distinct from the human-triggered event it wraps — the
 * `payload.kind` line above already names which one it was.
 */
function logEventColor(eventType: TestLogSummary["event_type"]): string {
  switch (eventType) {
    case "status_change":
      return "primary";
    case "comment":
      return "secondary";
    case "attachment":
      return "info";
    case "agent_action":
      return "dark";
    default:
      return "secondary";
  }
}

/**
 * `datetime-local` wants `YYYY-MM-DDTHH:mm` in **local** time with no zone
 * suffix, so `toISOString()` (which converts to UTC) is wrong here — it would
 * silently offset the default by the viewer's UTC offset. Built from the local
 * getters instead.
 */
function nowForDatetimeLocalInput(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}`
  );
}

/**
 * The reverse trip: a `datetime-local` value is zone-less local wall-clock
 * time, and the API column is a real `datetime`. `new Date(value)` parses it in
 * the viewer's own zone (correct — that is what they typed), and
 * `toISOString()` then hands the backend an unambiguous UTC instant. A value
 * the browser cannot parse is passed through untouched rather than becoming
 * `"Invalid Date"`, leaving the backend's own `422` as the boundary.
 */
function datetimeLocalToIso(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/** Localized display for a stored ISO datetime; unparseable values show as-is. */
function formatExecutedAt(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : GENERIC_ERROR;
}

/** One dashboard stat tile (UI Design Document §3) — always rendered, `0` included. */
function StatTile({
  label,
  value,
  color,
  testId,
}: {
  label: string;
  value: number | null;
  color: string;
  testId: string;
}) {
  return (
    <CCol xs={6} md={3} className="mb-3">
      <CCard className="h-100 text-center" data-testid={testId}>
        <CCardBody className="py-3">
          <div className="text-body-secondary small text-uppercase">{label}</div>
          <div className={`fs-3 fw-semibold text-${color}`} data-testid={`${testId}-count`}>
            {value === null ? "—" : value}
          </div>
        </CCardBody>
      </CCard>
    </CCol>
  );
}

function TestCycleDetail() {
  const { projectId, testPlanId, testCycleId } = useParams<{
    projectId: string;
    testPlanId: string;
    testCycleId: string;
  }>();

  // --- Header: the cycle itself, plus its plan/release/environment labels ----
  const [cycle, setCycle] = useState<EntityRow | null>(null);
  const [cycleLoading, setCycleLoading] = useState(true);
  const [cycleLoadError, setCycleLoadError] = useState<string | null>(null);
  const [planIdentifier, setPlanIdentifier] = useState<string | null>(null);
  const [releaseLabel, setReleaseLabel] = useState<string | null>(null);
  const [environmentLabel, setEnvironmentLabel] = useState<string | null>(null);

  // --- Dashboard: one independent count per result value ---------------------
  // `null` = not yet loaded (renders "—"); a number is a real server `total`.
  const [counts, setCounts] = useState<Record<TestExecutionResultValue, number | null>>({
    pass: null,
    fail: null,
    blocked: null,
    skipped: null,
  });
  const [countsError, setCountsError] = useState<string | null>(null);

  // --- Execution history -----------------------------------------------------
  const [executions, setExecutions] = useState<TestExecutionSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);

  // Label lookups, both resolved client-side (UI Design Document §4 — "no
  // bespoke join"). Failures degrade to showing the raw id rather than taking
  // the section down: these decorate rows that already loaded.
  const [testCaseTitles, setTestCaseTitles] = useState<Record<string, string>>({});
  const [actorLabels, setActorLabels] = useState<Record<string, string>>({});

  // `422` (out-of-scope test case) / `403` from a record attempt — rendered as
  // a dismissible `CAlert` *inside* the still-open modal (UI Design Document
  // §5), so a failed attempt never discards what the user typed.
  const [recordError, setRecordError] = useState<string | null>(null);
  const [showRecordModal, setShowRecordModal] = useState(false);

  const {
    register: registerRecord,
    handleSubmit: handleSubmitRecord,
    reset: resetRecord,
    setValue: setRecordValue,
    watch: watchRecord,
    formState: { errors: recordErrors, isSubmitting: isSubmittingRecord },
  } = useForm<RecordResultFormValues>({
    resolver: zodResolver(recordResultSchema),
    defaultValues: {
      testCaseId: "",
      result: "pass",
      actualResult: "",
      executedAt: nowForDatetimeLocalInput(),
    },
  });

  const selectedTestCaseId = watchRecord("testCaseId");

  // --- EXEC-2: execution history timeline modal --------------------------
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyExecutionId, setHistoryExecutionId] = useState<string | null>(null);
  const [logs, setLogs] = useState<TestLogSummary[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsLoadError, setLogsLoadError] = useState<string | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);

  const {
    register: registerComment,
    handleSubmit: handleSubmitComment,
    reset: resetComment,
    formState: { errors: commentErrors, isSubmitting: isSubmittingComment },
  } = useForm<CommentFormValues>({
    resolver: zodResolver(commentSchema),
    defaultValues: { text: "", attachmentUrl: "", fileName: "" },
  });

  // --- EXEC-3: "Raise Defect" modal (ADR-0041) --------------------------
  const [showRaiseDefectModal, setShowRaiseDefectModal] = useState(false);
  const [raiseDefectExecutionId, setRaiseDefectExecutionId] = useState<string | null>(null);
  const [raiseDefectError, setRaiseDefectError] = useState<string | null>(null);

  const {
    register: registerRaiseDefect,
    handleSubmit: handleSubmitRaiseDefect,
    reset: resetRaiseDefect,
    formState: { errors: raiseDefectErrors, isSubmitting: isSubmittingRaiseDefect },
  } = useForm<RaiseDefectFormValues>({
    resolver: zodResolver(raiseDefectSchema),
    defaultValues: { externalRef: "", severity: "low", status: "" },
  });

  /** `GET /test-cycles/{id}` — the generic factory item route. */
  const fetchCycle = useCallback(async () => {
    if (!testCycleId) {
      return;
    }
    setCycleLoading(true);
    setCycleLoadError(null);
    try {
      setCycle(await getEntity<EntityRow>(testCycleConfig, testCycleId));
    } catch (err) {
      setCycleLoadError(errorMessage(err));
    } finally {
      setCycleLoading(false);
    }
  }, [testCycleId]);

  /**
   * The dashboard, ADR-0034's own mechanism: four independent calls, one per
   * `result` value, each reading `total` only. Fired in parallel and applied
   * as one state update so the tiles never render a half-updated set.
   *
   * A value with zero executions yields `total: 0` and renders `0` — the
   * `page_size=1` is what makes each call cheap (the `items` array is never
   * read), not a cap on what's being counted.
   */
  const fetchCounts = useCallback(async () => {
    if (!testCycleId) {
      return;
    }
    setCountsError(null);
    try {
      const totals = await Promise.all(
        TEST_EXECUTION_RESULTS.map(async (result) => {
          const response = await listEntities<TestExecutionSummary>(
            testExecutionConfig,
            {},
            { pageSize: 1, params: { test_cycle_id: testCycleId, result } },
          );
          return [result, response.total] as const;
        }),
      );
      setCounts(
        Object.fromEntries(totals) as Record<TestExecutionResultValue, number | null>,
      );
    } catch (err) {
      setCountsError(errorMessage(err));
    }
  }, [testCycleId]);

  /**
   * `GET /test-executions?test_cycle_id=<id>`, sorted `executed_at` descending
   * here rather than server-side — the generic factory's list route has no
   * `sort` param (same constraint `testSteps.ts` documents for its own
   * `sequence` ordering).
   */
  const fetchHistory = useCallback(async () => {
    if (!testCycleId) {
      return;
    }
    setHistoryLoading(true);
    setHistoryLoadError(null);
    try {
      const response = await listEntities<TestExecutionSummary>(
        testExecutionConfig,
        {},
        { pageSize: HISTORY_PAGE_SIZE, params: { test_cycle_id: testCycleId } },
      );
      const sorted = [...response.items].sort((a, b) =>
        String(b.executed_at).localeCompare(String(a.executed_at)),
      );
      setExecutions(sorted);
    } catch (err) {
      setHistoryLoadError(errorMessage(err));
    } finally {
      setHistoryLoading(false);
    }
  }, [testCycleId]);

  /**
   * `TestCase` id -> title, from the plan's own coverage query — the same
   * route the picker lists from, so a title shown in the history is always a
   * case the plan actually covers.
   */
  const fetchTestCaseTitles = useCallback(async () => {
    if (!testPlanId) {
      return;
    }
    try {
      const response = await listPlanTestCases(testPlanId);
      setTestCaseTitles(
        Object.fromEntries(response.items.map((testCase) => [testCase.id, testCase.title])),
      );
    } catch {
      setTestCaseTitles({});
    }
  }, [testPlanId]);

  /**
   * Actor id -> display label. See this module's docstring, deviation 1: the
   * only actor-bearing read route available is `GET /orgs/{org_id}/members`,
   * which yields `email` for `User` rows only. The org is derived from the
   * route's own project (`GET /projects/{projectId}` -> `org_id`).
   * Anything unresolved falls back to the raw `actor_id` at render time.
   */
  const fetchActorLabels = useCallback(async () => {
    if (!projectId) {
      return;
    }
    try {
      const project = await getProject(projectId);
      const members = await listMembers(project.org_id, { page_size: 200 });
      setActorLabels(
        Object.fromEntries(members.items.map((member) => [member.user_id, member.email])),
      );
    } catch {
      setActorLabels({});
    }
  }, [projectId]);

  useEffect(() => {
    fetchCycle();
  }, [fetchCycle]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    fetchTestCaseTitles();
  }, [fetchTestCaseTitles]);

  useEffect(() => {
    fetchActorLabels();
  }, [fetchActorLabels]);

  /**
   * Header decoration only: the plan's identifier and the cycle's release /
   * environment labels. Each failure degrades to the raw id (or nothing) — the
   * dashboard and history are the screen's real content and don't depend on
   * any of these resolving.
   */
  useEffect(() => {
    if (!cycle) {
      return;
    }
    let cancelled = false;
    const planId = cycle.test_plan_id ? String(cycle.test_plan_id) : undefined;
    const releaseId = cycle.release_id ? String(cycle.release_id) : undefined;
    const environmentId = cycle.environment_id ? String(cycle.environment_id) : undefined;

    async function resolveLabel(
      config: EntityConfig,
      id: string | undefined,
      field: string,
      apply: (value: string | null) => void,
    ) {
      if (!id) {
        return;
      }
      try {
        const row = await getEntity<EntityRow>(config, id);
        if (!cancelled) {
          apply(row[field] ? String(row[field]) : id);
        }
      } catch {
        if (!cancelled) {
          apply(id);
        }
      }
    }

    void resolveLabel(
      { ...testCycleConfig, path: "/test-plans" },
      planId,
      "identifier",
      setPlanIdentifier,
    );
    void resolveLabel(
      { ...testCycleConfig, path: "/releases" },
      releaseId,
      "version_label",
      setReleaseLabel,
    );
    void resolveLabel(
      { ...testCycleConfig, path: "/environments" },
      environmentId,
      "name",
      setEnvironmentLabel,
    );

    return () => {
      cancelled = true;
    };
  }, [cycle]);

  function openRecordModal() {
    resetRecord({
      testCaseId: "",
      result: "pass",
      actualResult: "",
      // Re-derived at open time, not at mount — "defaults to now" means now,
      // not whenever the page happened to load (UI Design Document §5).
      executedAt: nowForDatetimeLocalInput(),
    });
    setShowRecordModal(true);
  }

  function closeRecordModal() {
    setShowRecordModal(false);
  }

  /**
   * Re-read the server after a successful record — all four dashboard counts
   * and the history list. Never a local increment or an optimistic splice:
   * this is the mechanism AC2's "live, not manually maintained" claim rests
   * on, and Test Design §30's frontend structural class asserts precisely
   * that a post-submit render shows newly-fetched values.
   */
  const refreshAfterRecord = useCallback(async () => {
    await Promise.all([fetchCounts(), fetchHistory()]);
  }, [fetchCounts, fetchHistory]);

  /**
   * Submit `POST /test-cycles/{id}/executions`. On `201` the modal closes and
   * both views re-fetch.
   *
   * On failure the modal **stays open** and the reason renders as a
   * dismissible `CAlert` inside it (UI Design Document §5's literal wording for
   * both the `422` out-of-scope case and the `403`). Keeping it open is the
   * point, not an incidental detail: closing would discard the user's typed
   * `actual_result` and their chosen `executed_at`, forcing them to retype
   * everything to retry a request that may well have failed for a transient
   * reason.
   *
   * Note ADR-0034 §Decision instead says "same convention as every other
   * section on this family of screens", which reads as the section-header
   * alert `TestPlanDetail`'s Include-Suite/Criteria/Create-Cycle flows use.
   * The two documents disagree. The UI Design Document wins here as the more
   * specific spec for this screen, and it is also the behavior with real
   * precedent in the same family — `TestPlanDetail`'s own Edit modal already
   * keeps non-field errors (e.g. `409 invalid_status_transition`) inline and
   * the modal open, for exactly this reason. Flagged rather than silently
   * absorbed.
   */
  async function onSubmitRecord(values: RecordResultFormValues) {
    if (!testCycleId) {
      return;
    }
    setRecordError(null);
    try {
      await createTestExecution(testCycleId, {
        test_case_id: values.testCaseId,
        result: values.result,
        actual_result: values.actualResult ? values.actualResult : null,
        executed_at: datetimeLocalToIso(values.executedAt),
      });
      setShowRecordModal(false);
      await refreshAfterRecord();
    } catch (err) {
      setRecordError(errorMessage(err));
    }
  }

  /** `GET /executions/{id}/logs` — the ordered timeline (FR-EXEC-2 AC3). */
  const fetchLogs = useCallback(async (executionId: string) => {
    setLogsLoading(true);
    setLogsLoadError(null);
    try {
      const items = await listTestExecutionLogs(executionId);
      setLogs(items);
    } catch (err) {
      setLogsLoadError(errorMessage(err));
    } finally {
      setLogsLoading(false);
    }
  }, []);

  function openHistoryModal(executionId: string) {
    setHistoryExecutionId(executionId);
    setCommentError(null);
    resetComment({ text: "", attachmentUrl: "", fileName: "" });
    setShowHistoryModal(true);
    void fetchLogs(executionId);
  }

  function closeHistoryModal() {
    setShowHistoryModal(false);
    setHistoryExecutionId(null);
    setLogs([]);
  }

  /**
   * `POST /executions/{id}/comments` — appends a `TestLog` row (AC1's
   * comment/attachment triggers). On success the timeline re-fetches (the
   * same "never a local splice, always re-read the server" posture
   * `refreshAfterRecord` already takes for the dashboard/history) and the
   * form clears; on failure the modal stays open with the reason inline,
   * same convention `onSubmitRecord` established.
   */
  async function onSubmitComment(values: CommentFormValues) {
    if (!historyExecutionId) {
      return;
    }
    setCommentError(null);
    try {
      await addTestExecutionComment(historyExecutionId, {
        text: values.text,
        attachment_url: values.attachmentUrl ? values.attachmentUrl : null,
        file_name: values.fileName ? values.fileName : null,
      });
      resetComment({ text: "", attachmentUrl: "", fileName: "" });
      await fetchLogs(historyExecutionId);
    } catch (err) {
      setCommentError(errorMessage(err));
    }
  }

  /**
   * `POST /executions/{id}/defects` — a `fail`-row-only affordance (§2 of the
   * UI Design Document: the button itself renders only on `fail` rows, the
   * backend's own `422` on a non-fail execution is the real enforcement
   * boundary). No list to refresh here — the Defects list this raises a row
   * into lives on `EntityFormPage`'s `test-case` edit page, not this screen.
   */
  function openRaiseDefectModal(executionId: string) {
    setRaiseDefectExecutionId(executionId);
    setRaiseDefectError(null);
    resetRaiseDefect({ externalRef: "", severity: "low", status: "" });
    setShowRaiseDefectModal(true);
  }

  function closeRaiseDefectModal() {
    setShowRaiseDefectModal(false);
    setRaiseDefectExecutionId(null);
  }

  async function onSubmitRaiseDefect(values: RaiseDefectFormValues) {
    if (!raiseDefectExecutionId) {
      return;
    }
    setRaiseDefectError(null);
    try {
      await createDefectForExecution(raiseDefectExecutionId, {
        external_ref: values.externalRef ? values.externalRef : null,
        severity: values.severity,
        status: values.status ? values.status : null,
      });
      setShowRaiseDefectModal(false);
    } catch (err) {
      setRaiseDefectError(errorMessage(err));
    }
  }

  const cycleName = useMemo(
    () => (cycle && cycle.name ? String(cycle.name) : "Test cycle"),
    [cycle],
  );

  if (!projectId || !testPlanId || !testCycleId) {
    return null;
  }

  const dateRange = cycle
    ? `${cycle.start_date ? String(cycle.start_date) : "—"} – ${
        cycle.end_date ? String(cycle.end_date) : "—"
      }`
    : "—";

  return (
    <div className="min-vh-100 bg-body-secondary py-4">
      <CContainer fluid className="px-4">
        <CRow className="justify-content-center">
          <CCol md={10} lg={8}>
            {/* --- Header card ------------------------------------------- */}
            <CCard>
              <CCardBody className="p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h1 className="fs-4 mb-0" data-testid="test-cycle-name">
                    {cycleName}
                  </h1>
                  <div className="d-flex gap-2">
                    <CButton
                      color="secondary"
                      variant="outline"
                      as={Link}
                      to={`/projects/${projectId}/test-plans/${testPlanId}`}
                      data-testid="back-to-test-plan"
                    >
                      Back to Test Plan
                    </CButton>
                    {/*
                      No permission-based hide/disable — see this module's
                      docstring, deviation 2: consistent with `TestPlanDetail`'s
                      own attempt-then-error convention for this screen family.
                    */}
                    <CButton
                      color="primary"
                      data-testid="record-result-btn"
                      disabled={!cycle}
                      onClick={openRecordModal}
                    >
                      Record Result
                    </CButton>
                  </div>
                </div>

                {cycleLoadError && (
                  <CAlert color="danger" role="alert" data-testid="test-cycle-load-error">
                    {cycleLoadError}
                  </CAlert>
                )}

                {cycleLoading ? (
                  <div className="d-flex justify-content-center py-4">
                    <CSpinner color="primary" />
                  </div>
                ) : (
                  cycle && (
                    <div className="text-body-secondary" data-testid="test-cycle-meta">
                      <div>
                        Plan:{" "}
                        <span data-testid="test-cycle-plan">
                          {planIdentifier ?? String(cycle.test_plan_id ?? "—")}
                        </span>{" "}
                        Release:{" "}
                        <span data-testid="test-cycle-release">
                          {releaseLabel ?? String(cycle.release_id ?? "—")}
                        </span>
                      </div>
                      <div>
                        Environment:{" "}
                        <span data-testid="test-cycle-environment">
                          {environmentLabel ?? String(cycle.environment_id ?? "—")}
                        </span>{" "}
                        <span data-testid="test-cycle-dates">{dateRange}</span>
                      </div>
                    </div>
                  )
                )}
              </CCardBody>
            </CCard>

            {/* --- Dashboard (UI Design Document §3, above history) -------- */}
            <CCard className="mt-4">
              <CCardBody className="p-4">
                <h2 className="fs-5 mb-3">Dashboard</h2>

                {countsError && (
                  <CAlert color="danger" role="alert" data-testid="dashboard-error">
                    {countsError}
                  </CAlert>
                )}

                <CRow data-testid="execution-dashboard">
                  <StatTile
                    label="Pass"
                    value={counts.pass}
                    color="success"
                    testId="dashboard-tile-pass"
                  />
                  <StatTile
                    label="Fail"
                    value={counts.fail}
                    color="danger"
                    testId="dashboard-tile-fail"
                  />
                  <StatTile
                    label="Blocked"
                    value={counts.blocked}
                    color="warning"
                    testId="dashboard-tile-blocked"
                  />
                  <StatTile
                    label="Skipped"
                    value={counts.skipped}
                    color="secondary"
                    testId="dashboard-tile-skipped"
                  />
                </CRow>
              </CCardBody>
            </CCard>

            {/* --- Execution history (UI Design Document §4) --------------- */}
            <CCard className="mt-4">
              <CCardBody className="p-4">
                <h2 className="fs-5 mb-3">Execution history</h2>

                {historyLoadError && (
                  <CAlert color="danger" role="alert" data-testid="execution-history-error">
                    {historyLoadError}
                  </CAlert>
                )}

                {historyLoading ? (
                  <div className="d-flex justify-content-center py-3">
                    <CSpinner color="primary" />
                  </div>
                ) : !historyLoadError && executions.length === 0 ? (
                  <p className="text-body-secondary mb-0">No executions recorded yet.</p>
                ) : (
                  !historyLoadError && (
                    /* Flat <ul>/<li>, never a <CTable> — frontend/CLAUDE.md. */
                    <ul className="list-unstyled mb-0" data-testid="execution-history-list">
                      {executions.map((execution) => (
                        <li
                          key={execution.id}
                          className="border-bottom py-2"
                          data-testid={`execution-${execution.id}`}
                        >
                          <div className="d-flex align-items-center gap-2 flex-wrap">
                            <span data-testid={`execution-${execution.id}-test-case`}>
                              {testCaseTitles[execution.test_case_id] ?? execution.test_case_id}
                            </span>
                            <CBadge
                              color={resultColor(execution.result)}
                              data-testid={`execution-${execution.id}-result`}
                            >
                              {execution.result}
                            </CBadge>
                            <span
                              className="text-body-secondary small"
                              data-testid={`execution-${execution.id}-executed-at`}
                            >
                              {formatExecutedAt(execution.executed_at)}
                            </span>
                            <span
                              className="text-body-secondary small"
                              data-testid={`execution-${execution.id}-actor`}
                            >
                              {actorLabels[execution.executed_by_actor_id] ??
                                execution.executed_by_actor_id}
                            </span>
                            <CButton
                              size="sm"
                              color="secondary"
                              variant="outline"
                              className="ms-auto"
                              data-testid={`execution-${execution.id}-view-history`}
                              onClick={() => openHistoryModal(execution.id)}
                            >
                              History
                            </CButton>
                            {/*
                              EXEC-3 (ADR-0041): only on `fail` rows — the
                              backend's own `422` (result != fail) stays the
                              real enforcement boundary regardless.
                            */}
                            {execution.result === "fail" && (
                              <CButton
                                size="sm"
                                color="danger"
                                variant="outline"
                                data-testid={`execution-${execution.id}-raise-defect`}
                                onClick={() => openRaiseDefectModal(execution.id)}
                              >
                                Raise Defect
                              </CButton>
                            )}
                          </div>
                          {execution.actual_result && (
                            <div className="small" data-testid={`execution-${execution.id}-notes`}>
                              {execution.actual_result}
                            </div>
                          )}
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

      {/* --- "Record Result" modal (UI Design Document §5) ----------------- */}
      <CModal
        visible={showRecordModal}
        onClose={closeRecordModal}
        data-testid="record-result-modal"
      >
        <CModalHeader>
          <CModalTitle>Record Result</CModalTitle>
        </CModalHeader>
        <CForm onSubmit={handleSubmitRecord(onSubmitRecord)} noValidate>
          <CModalBody>
            {/*
              UI Design Document §5: a `422` (out-of-scope TestCase) or `403`
              renders here, inside the modal, dismissible — and the modal stays
              open so the user's typed input survives the failure.
            */}
            {recordError && (
              <CAlert
                color="danger"
                role="alert"
                dismissible
                data-testid="record-error"
                onClose={() => setRecordError(null)}
              >
                {recordError}
              </CAlert>
            )}

            {/*
              TC-EXEC-010: the picker lists from `GET
              /test-plans/{testPlanId}/test-cases`, never an unscoped
              project-wide TestCase list — `planScopedTestCaseConfig` plus the
              `routeParams` placeholder fill. `FkAutocomplete` takes no
              `data-testid` of its own, so it's wrapped for e2e to scope into.
            */}
            <div data-testid="record-result-test-case">
              <FkAutocomplete
                id="recordTestCaseId"
                label="Test case"
                refEntity="test-case"
                config={planScopedTestCaseConfig}
                labelField="title"
                value={selectedTestCaseId || undefined}
                routeParams={{ testPlanId }}
                onChange={(id) => setRecordValue("testCaseId", id ?? "", { shouldValidate: true })}
                error={recordErrors.testCaseId?.message}
              />
            </div>

            <div className="mb-3">
              <CFormLabel htmlFor="recordResult">Result</CFormLabel>
              <CFormSelect
                id="recordResult"
                data-testid="record-result-select"
                invalid={!!recordErrors.result}
                {...registerRecord("result")}
              >
                {TEST_EXECUTION_RESULTS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </CFormSelect>
              {recordErrors.result && (
                <CFormFeedback invalid>{recordErrors.result.message}</CFormFeedback>
              )}
            </div>

            <div className="mb-3">
              <CFormLabel htmlFor="recordActualResult">Actual result</CFormLabel>
              <CFormTextarea
                id="recordActualResult"
                rows={3}
                data-testid="record-actual-result"
                {...registerRecord("actualResult")}
              />
              <CFormText>Optional.</CFormText>
            </div>

            <div className="mb-3">
              <CFormLabel htmlFor="recordExecutedAt">Executed at</CFormLabel>
              {/*
                `datetime-local`, not `date`: `executed_at` is a `datetime`
                column and time of day is significant (the same distinction
                `entityConfigs/test-execution.ts`'s own docstring flags).
              */}
              <CFormInput
                id="recordExecutedAt"
                type="datetime-local"
                data-testid="record-executed-at"
                invalid={!!recordErrors.executedAt}
                {...registerRecord("executedAt")}
              />
              {recordErrors.executedAt && (
                <CFormFeedback invalid>{recordErrors.executedAt.message}</CFormFeedback>
              )}
            </div>
          </CModalBody>
          <CModalFooter>
            <CButton
              color="secondary"
              variant="outline"
              data-testid="record-result-cancel"
              onClick={closeRecordModal}
            >
              Cancel
            </CButton>
            <CButton
              type="submit"
              color="primary"
              data-testid="record-result-submit"
              disabled={isSubmittingRecord}
            >
              {isSubmittingRecord ? "Recording..." : "Record"}
            </CButton>
          </CModalFooter>
        </CForm>
      </CModal>

      {/* --- "Execution history" timeline modal (EXEC-2, FR-EXEC-2) -------- */}
      <CModal
        visible={showHistoryModal}
        onClose={closeHistoryModal}
        alignment="center"
        data-testid="execution-history-modal"
      >
        <CModalHeader>
          <CModalTitle>Execution history</CModalTitle>
        </CModalHeader>
        <CModalBody>
          {logsLoadError && (
            <CAlert color="danger" role="alert" data-testid="execution-log-load-error">
              {logsLoadError}
            </CAlert>
          )}

          {logsLoading ? (
            <div className="d-flex justify-content-center py-3">
              <CSpinner color="primary" />
            </div>
          ) : (
            !logsLoadError && (
              /* Flat <ul>/<li>, never a <CTable> — frontend/CLAUDE.md. Ordered
                 oldest-first exactly as `GET /executions/{id}/logs` returns it
                 (AC3's "ordered TestLog timeline"). */
              <ul className="list-unstyled mb-3" data-testid="execution-log-timeline">
                {logs.length === 0 && (
                  <li className="text-body-secondary">No log entries yet.</li>
                )}
                {logs.map((log) => (
                  <li
                    key={log.id}
                    className="border-bottom py-2"
                    data-testid={`execution-log-entry-${log.id}`}
                  >
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <CBadge
                        color={logEventColor(log.event_type)}
                        data-testid={`execution-log-entry-${log.id}-type`}
                      >
                        {log.event_type}
                      </CBadge>
                      <span
                        className="text-body-secondary small"
                        data-testid={`execution-log-entry-${log.id}-logged-at`}
                      >
                        {formatExecutedAt(log.logged_at)}
                      </span>
                    </div>
                    <div
                      className="small"
                      data-testid={`execution-log-entry-${log.id}-summary`}
                    >
                      {logSummaryLine(log)}
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}

          <CForm onSubmit={handleSubmitComment(onSubmitComment)} noValidate>
            <h2 className="fs-6 mb-2">Add a comment</h2>

            {commentError && (
              <CAlert color="danger" role="alert" data-testid="add-comment-error">
                {commentError}
              </CAlert>
            )}

            <div className="mb-2">
              <CFormLabel htmlFor="comment-text">Comment</CFormLabel>
              <CFormTextarea
                id="comment-text"
                rows={2}
                data-testid="add-comment-text"
                invalid={Boolean(commentErrors.text)}
                {...registerComment("text")}
              />
              {commentErrors.text && (
                <CFormFeedback invalid>{commentErrors.text.message}</CFormFeedback>
              )}
            </div>

            <div className="mb-2">
              <CFormLabel htmlFor="comment-attachment-url">
                Attachment URL (optional)
              </CFormLabel>
              <CFormInput
                id="comment-attachment-url"
                data-testid="add-comment-attachment-url"
                {...registerComment("attachmentUrl")}
              />
              <CFormText>
                A plain link/reference, not a file upload (v1) — supplying one logs this
                entry as an attachment rather than a plain comment.
              </CFormText>
            </div>

            <div className="mb-3">
              <CFormLabel htmlFor="comment-file-name">File name (optional)</CFormLabel>
              <CFormInput
                id="comment-file-name"
                data-testid="add-comment-file-name"
                {...registerComment("fileName")}
              />
            </div>

            <div className="d-flex justify-content-end">
              <CButton
                type="submit"
                color="primary"
                data-testid="add-comment-submit"
                disabled={isSubmittingComment}
              >
                {isSubmittingComment ? "Adding..." : "Add comment"}
              </CButton>
            </div>
          </CForm>
        </CModalBody>
        <CModalFooter>
          <CButton
            color="secondary"
            variant="outline"
            data-testid="execution-history-close"
            onClick={closeHistoryModal}
          >
            Close
          </CButton>
        </CModalFooter>
      </CModal>

      {/* --- "Raise Defect" modal (EXEC-3, ADR-0041) ------------------------ */}
      <CModal
        visible={showRaiseDefectModal}
        onClose={closeRaiseDefectModal}
        data-testid="raise-defect-modal"
      >
        <CModalHeader>
          <CModalTitle>Raise Defect</CModalTitle>
        </CModalHeader>
        <CForm onSubmit={handleSubmitRaiseDefect(onSubmitRaiseDefect)} noValidate>
          <CModalBody>
            {/*
              UI Design Document §3: a `422` (execution no longer `fail`, a
              narrow race) or `403` renders here, inside the modal, dismissible
              — the modal stays open so typed input survives the failure, same
              convention `onSubmitRecord`/EXEC-2's comment form already use.
            */}
            {raiseDefectError && (
              <CAlert
                color="danger"
                role="alert"
                dismissible
                data-testid="raise-defect-error"
                onClose={() => setRaiseDefectError(null)}
              >
                {raiseDefectError}
              </CAlert>
            )}

            <div className="mb-3">
              <CFormLabel htmlFor="raiseDefectExternalRef">External ref (optional)</CFormLabel>
              <CFormInput
                id="raiseDefectExternalRef"
                data-testid="raise-defect-external-ref"
                {...registerRaiseDefect("externalRef")}
              />
              <CFormText>
                e.g. a Jira/GitHub/GitLab issue URL or id — plain text, no live integration
                in this scaffold.
              </CFormText>
            </div>

            <div className="mb-3">
              <CFormLabel htmlFor="raiseDefectSeverity">Severity</CFormLabel>
              <CFormSelect
                id="raiseDefectSeverity"
                data-testid="raise-defect-severity"
                invalid={!!raiseDefectErrors.severity}
                {...registerRaiseDefect("severity")}
              >
                {DEFECT_SEVERITIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </CFormSelect>
              {raiseDefectErrors.severity && (
                <CFormFeedback invalid>{raiseDefectErrors.severity.message}</CFormFeedback>
              )}
            </div>

            <div className="mb-3">
              <CFormLabel htmlFor="raiseDefectStatus">Status (optional, defaults to "open")</CFormLabel>
              <CFormInput
                id="raiseDefectStatus"
                data-testid="raise-defect-status"
                {...registerRaiseDefect("status")}
              />
            </div>
          </CModalBody>
          <CModalFooter>
            <CButton
              color="secondary"
              variant="outline"
              data-testid="raise-defect-cancel"
              onClick={closeRaiseDefectModal}
            >
              Cancel
            </CButton>
            <CButton
              type="submit"
              color="primary"
              data-testid="raise-defect-submit"
              disabled={isSubmittingRaiseDefect}
            >
              {isSubmittingRaiseDefect ? "Raising..." : "Raise Defect"}
            </CButton>
          </CModalFooter>
        </CForm>
      </CModal>
    </div>
  );
}

export default TestCycleDetail;
