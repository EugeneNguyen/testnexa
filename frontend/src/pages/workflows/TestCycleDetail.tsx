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
 *    A flat `<ul>`/`<li>`, never a `<table>`, per `frontend/CLAUDE.md`.
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
 * surfaces as the same dismissible in-modal alert a `422` does (see
 * `onSubmitRecord`). Flagged rather than silently absorbed — same posture
 * PLAN-3's implementer took with ADR-0032's own prose/sketch contradiction.
 *
 * Non-goals (UI Design Document §6): no `TestLog` timeline (EXEC-2), no "Raise
 * Defect" affordance even on a `fail` (EXEC-3), and no edit/delete of a
 * recorded execution (`test_manager` holds neither `test_execution.update` nor
 * `.delete`, ADR-0033's own deliberate withholding).
 *
 * Built with AdminLTE v4 / raw Bootstrap 5 markup (ADR-0042). This screen was
 * originally built on CoreUI React components (ADR-0012); ADR-0042 replaced the
 * design system wholesale, so every former `C*` component here is now the
 * equivalent hand-written Bootstrap 5 element. Nothing about the page's
 * structure, semantics, or `data-testid` surface changed in that swap.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import FkAutocomplete from "../../components/molecules/fk-autocomplete";
import { InfoBox } from "../../components/molecules/info-box";
import { useEntitySchema } from "../admin/useEntitySchema";
import { pathFor } from "../../entityConfigs/overrides";
import type { EntityConfig } from "../../entityConfigs/types";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * ADR-0053: the 28 per-entity `entityConfigs/*.ts` files are gone — an
 * entity's *field shape* now comes from `GET /entities/{resource}/schema` via
 * `useEntitySchema`, and its *route* comes from `entityConfigs/overrides.ts`'s
 * `pathFor()`.
 *
 * This screen's config uses split cleanly along that seam, and each one was
 * checked against what the consumer actually reads rather than assumed:
 *
 * - `listEntities`/`getEntity` (`lib/api/entityCrud.ts`) read only `path`,
 *   `listPath`, `createPath` and `methods` — so every call here that just
 *   needs "which URL" takes a `routeOnlyConfig()` below. No fetch, no loading
 *   state, no new async failure mode for a string this file already knows.
 * - `FkAutocomplete`, by contrast, is handed a whole config and reads
 *   `methods` off it to decide whether searching is even possible — that is
 *   genuinely backend-owned data, so the "Record Result" picker's config is
 *   derived from a real `useEntitySchema("test-cases")` fetch (see
 *   `planScopedTestCaseConfig` inside the component).
 */
function routeOnlyConfig(resource: string, entityKey: string): EntityConfig {
  return { resource, path: pathFor(entityKey), methods: [], fields: [] };
}

/**
 * `GET /test-executions?...` — the dashboard's four count calls and the
 * history list. Both read `total`/`items` off the response; neither consults a
 * field list, so this deliberately carries none (see `routeOnlyConfig`).
 */
const TEST_EXECUTION_ROUTE = routeOnlyConfig("test_execution", "test-executions");

/** `GET /test-cycles/{id}` — the header card's own row. */
const TEST_CYCLE_ROUTE = routeOnlyConfig("test_cycle", "test-cycles");

/**
 * The three header-decoration label lookups. Each was previously expressed as
 * `{ ...testCycleConfig, path: "/test-plans" }` — a spread whose only surviving
 * field was the overridden `path`, i.e. already a route-only descriptor in all
 * but name.
 */
const TEST_PLAN_ROUTE = routeOnlyConfig("test_plan", "test-plans");
const RELEASE_ROUTE = routeOnlyConfig("release", "releases");
const ENVIRONMENT_ROUTE = routeOnlyConfig("environment", "environments");

/**
 * The history list's page size. The generic factory's own default page size is
 * small; a cycle's execution history is expected to be modest at scaffold
 * scale, so one generous page is fetched rather than building pagination UI no
 * acceptance criterion asks for. The *dashboard* is unaffected either way — it
 * reads `total`, which is the full count regardless of page size.
 */
const HISTORY_PAGE_SIZE = 200;

/**
 * `planScopedTestCaseConfig`'s `listPath` override — PLAN-1's coverage query
 * (`GET /test-plans/{id}/test-cases`, ADR-0031), using the `:testPlanId`
 * placeholder `entityCrud.interpolate` already supports and `FkAutocomplete`
 * fills from `routeParams` (`frontend/CLAUDE.md`'s `:paramName` mechanism,
 * added by PLAN-3 for `release`).
 */
const PLAN_SCOPED_TEST_CASES_PATH = "/test-plans/:testPlanId/test-cases";

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

/** UI Design Document §2 (EXEC-3, ADR-0044): all four `DefectSeverity` values. */
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

/**
 * DS-3 ([ADR-0045](docs/adr/0045-ds-3-infobox-widget-consolidation.md), 2026-09-08)
 * deleted this file's local `StatTile` function, which used to live here and
 * render the 4 dashboard tiles as a hand-rolled `div.card.h-100.text-center`
 * composition. The tiles now call the shared `InfoBox` (AdminLTE's own Info Box
 * widget) directly, at their own call sites below.
 *
 * Two contract differences that moved responsibility *to* the call site, both
 * deliberate (UI Design Document §2/§3):
 *
 *   - **The grid column is caller-owned.** `StatTile` wrapped itself in
 *     `div.col-6.col-md-3.mb-3`; `InfoBox` renders only `.info-box`, matching
 *     `WidgetStatsTile`'s existing no-wrapper contract (and `OrgHome`'s own
 *     `col-sm-6` wrappers) rather than `StatTile`'s self-wrapping one. So each
 *     of the 4 call sites below supplies that same column div itself — same
 *     classes, same `xs`-tier-has-no-infix reasoning as before (ADR-0042 §2).
 *   - **The `null` → `"—"` sentinel is caller-owned.** `InfoBox`'s `number` prop
 *     is a bare `ReactNode` and stays agnostic to sentinel conventions (it also
 *     carries `OrgHome`'s completely different Loading…/Unable-to-load
 *     tri-state — TC-DS-022 asserts the two coexist without either leaking into
 *     the other's screen), so the ternary moves inline to each call site.
 *
 * `data-testid`s are unchanged: `dashboard-tile-{pass,fail,blocked,skipped}` on
 * the `.info-box` root via `testId`, and each tile's `-count` suffix on the
 * `.info-box-number` element via `numberTestId` — the same logical elements the
 * pre-migration testids resolved to, which is TC-DS-020's whole claim. The 4
 * tiles pass no `icon` (no natural glyph exists for a bare pass/fail/blocked/
 * skipped count — ADR-0043 rejected inventing one), so they render no
 * `.info-box-icon` element at all rather than an empty one (TC-DS-021).
 */

/**
 * The former `CSpinner color="primary"`, hand-written (ADR-0042). The explicit
 * `role="status"` and the visually-hidden label are not decoration — CoreUI's
 * own spinner emitted both, and `role="status"` is what sibling screens'
 * `getByRole("status")` lookups resolve against.
 */
function Spinner() {
  return (
    <div className="spinner-border text-primary" role="status">
      <span className="visually-hidden">Loading...</span>
    </div>
  );
}

/**
 * The former `CModal` + `CModalHeader`/`CModalTitle` pair, hand-written
 * (ADR-0042 §2.3). One local helper rather than two copies of the same
 * Bootstrap modal skeleton.
 *
 * **Renders nothing at all when closed**, which is the property that matters
 * for behavior, not just for markup: `CModal` unmounted its content on
 * `visible={false}`, and both of this screen's own suites assert exactly that
 * (`queryByTestId("record-result-modal")).toBeNull()`,
 * `queryByTestId("execution-history-modal")).not.toBeInTheDocument()`). A
 * render-but-hide modal would silently break them.
 *
 * `centered` is the former `alignment="center"` — `modal-dialog-centered`. It is
 * the only alignment override in this codebase, and it belongs to the history
 * modal alone; the record-result modal is deliberately top-aligned, as before.
 *
 * ESC-to-close reproduces CoreUI's own default `keyboard` behavior. Focus
 * trapping is deliberately *not* reimplemented — ADR-0042 records it as an
 * accepted gap for the whole migration, not an oversight here.
 */
function Modal({
  visible,
  onClose,
  title,
  testId,
  centered,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  testId: string;
  centered?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!visible) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [visible, onClose]);

  if (!visible) {
    return null;
  }

  const titleId = `${testId}-title`;
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
        <div className={`modal-dialog${centered ? " modal-dialog-centered" : ""}`}>
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title" id={titleId}>
                {title}
              </h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            {children}
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" />
    </>
  );
}

function TestCycleDetail() {
  const { projectId, testPlanId, testCycleId } = useParams<{
    projectId: string;
    testPlanId: string;
    testCycleId: string;
  }>();

  // --- ADR-0053: the one genuinely backend-owned config on this screen -------
  // Called unconditionally at the top of the component, before any early
  // return, per the Rules of Hooks — `useEntitySchema` wraps `useQuery`.
  const { config: testCaseConfig } = useEntitySchema("test-cases");

  /**
   * The backend's own `TestCase` schema, re-pointed at PLAN-1's coverage query
   * so the "Record Result" picker offers exactly the `TestCase`s the backend's
   * own scope-check would accept (ADR-0034; TC-EXEC-010).
   *
   * Two overrides, both load-bearing:
   * - `listPath` — see `PLAN_SCOPED_TEST_CASES_PATH` above.
   * - `methods` gains `"list"`. `TestCase`'s real schema deliberately omits it
   *   — there is no `GET /test-cases` route at all — so without this
   *   `FkAutocomplete` would render its disabled "search unavailable" state.
   *   That structural gap is real and unchanged; this override does not paper
   *   over it, it points at a *different*, plan-scoped route that does exist.
   *   Spreading the **fetched** `methods` (rather than a hand-written list) is
   *   the point of ADR-0053: if the backend ever does gain a plain
   *   `GET /test-cases`, this keeps agreeing with it for free.
   *
   * `undefined` until the schema resolves — the picker renders a disabled
   * placeholder in that window (see the "Record Result" modal below).
   */
  const planScopedTestCaseConfig = useMemo<EntityConfig | undefined>(
    () =>
      testCaseConfig
        ? {
            ...testCaseConfig,
            listPath: PLAN_SCOPED_TEST_CASES_PATH,
            methods: [...testCaseConfig.methods, "list"],
          }
        : undefined,
    [testCaseConfig],
  );

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
  // a dismissible alert *inside* the still-open modal (UI Design Document
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

  // --- EXEC-3: "Raise Defect" modal (ADR-0044) --------------------------
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
      setCycle(await getEntity<EntityRow>(TEST_CYCLE_ROUTE, testCycleId));
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
            TEST_EXECUTION_ROUTE,
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
        TEST_EXECUTION_ROUTE,
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

    void resolveLabel(TEST_PLAN_ROUTE, planId, "identifier", setPlanIdentifier);
    void resolveLabel(RELEASE_ROUTE, releaseId, "version_label", setReleaseLabel);
    void resolveLabel(ENVIRONMENT_ROUTE, environmentId, "name", setEnvironmentLabel);

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
   * dismissible alert inside it (UI Design Document §5's literal wording for
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
      <div className="container-fluid px-4">
        <div className="row justify-content-center">
          <div className="col-md-10 col-lg-8">
            {/* --- Header card ------------------------------------------- */}
            <div className="card">
              <div className="card-body p-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h1 className="fs-4 mb-0" data-testid="test-cycle-name">
                    {cycleName}
                  </h1>
                  <div className="d-flex gap-2">
                    {/*
                      A real `<Link>` carrying button classes, not a `<button>`
                      — the former `CButton as={Link}` was polymorphic and
                      rendered an `<a>`; ADR-0042 §4.5.9 keeps that shape rather
                      than degrading a navigation into a click handler.
                    */}
                    <Link
                      className="btn btn-outline-secondary"
                      to={`/projects/${projectId}/test-plans/${testPlanId}`}
                      data-testid="back-to-test-plan"
                    >
                      Back to Test Plan
                    </Link>
                    {/*
                      No permission-based hide/disable — see this module's
                      docstring, deviation 2: consistent with `TestPlanDetail`'s
                      own attempt-then-error convention for this screen family.
                    */}
                    <button
                      type="button"
                      className="btn btn-primary"
                      data-testid="record-result-btn"
                      disabled={!cycle}
                      onClick={openRecordModal}
                    >
                      Record Result
                    </button>
                  </div>
                </div>

                {cycleLoadError && (
                  <div
                    className="alert alert-danger"
                    role="alert"
                    data-testid="test-cycle-load-error"
                  >
                    {cycleLoadError}
                  </div>
                )}

                {cycleLoading ? (
                  <div className="d-flex justify-content-center py-4">
                    <Spinner />
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
              </div>
            </div>

            {/* --- Dashboard (UI Design Document §3, above history) -------- */}
            <div className="card mt-4">
              <div className="card-body p-4">
                <h2 className="fs-5 mb-3">Dashboard</h2>

                {countsError && (
                  <div className="alert alert-danger" role="alert" data-testid="dashboard-error">
                    {countsError}
                  </div>
                )}

                {/* The former `CRow` — the testid stays on the `.row` itself. */}
                <div className="row" data-testid="execution-dashboard">
                  {/* Column wrappers are caller-owned since DS-3 — see the note
                      above where `StatTile` used to be defined. */}
                  <div className="col-6 col-md-3 mb-3">
                    <InfoBox
                      color="success"
                      text="Pass"
                      number={counts.pass === null ? "—" : counts.pass}
                      testId="dashboard-tile-pass"
                      numberTestId="dashboard-tile-pass-count"
                    />
                  </div>
                  <div className="col-6 col-md-3 mb-3">
                    <InfoBox
                      color="danger"
                      text="Fail"
                      number={counts.fail === null ? "—" : counts.fail}
                      testId="dashboard-tile-fail"
                      numberTestId="dashboard-tile-fail-count"
                    />
                  </div>
                  <div className="col-6 col-md-3 mb-3">
                    <InfoBox
                      color="warning"
                      text="Blocked"
                      number={counts.blocked === null ? "—" : counts.blocked}
                      testId="dashboard-tile-blocked"
                      numberTestId="dashboard-tile-blocked-count"
                    />
                  </div>
                  <div className="col-6 col-md-3 mb-3">
                    <InfoBox
                      color="secondary"
                      text="Skipped"
                      number={counts.skipped === null ? "—" : counts.skipped}
                      testId="dashboard-tile-skipped"
                      numberTestId="dashboard-tile-skipped-count"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* --- Execution history (UI Design Document §4) --------------- */}
            <div className="card mt-4">
              <div className="card-body p-4">
                <h2 className="fs-5 mb-3">Execution history</h2>

                {historyLoadError && (
                  <div
                    className="alert alert-danger"
                    role="alert"
                    data-testid="execution-history-error"
                  >
                    {historyLoadError}
                  </div>
                )}

                {historyLoading ? (
                  <div className="d-flex justify-content-center py-3">
                    <Spinner />
                  </div>
                ) : !historyLoadError && executions.length === 0 ? (
                  <p className="text-body-secondary mb-0">No executions recorded yet.</p>
                ) : (
                  !historyLoadError && (
                    /* Flat <ul>/<li>, never a <table> — frontend/CLAUDE.md. */
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
                            <span
                              className={`badge bg-${resultColor(execution.result)}`}
                              data-testid={`execution-${execution.id}-result`}
                            >
                              {execution.result}
                            </span>
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
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm ms-auto"
                              data-testid={`execution-${execution.id}-view-history`}
                              onClick={() => openHistoryModal(execution.id)}
                            >
                              History
                            </button>
                            {/*
                              EXEC-3 (ADR-0044): only on `fail` rows — the
                              backend's own `422` (result != fail) stays the
                              real enforcement boundary regardless.
                            */}
                            {execution.result === "fail" && (
                              <button
                                type="button"
                                className="btn btn-outline-danger btn-sm"
                                data-testid={`execution-${execution.id}-raise-defect`}
                                onClick={() => openRaiseDefectModal(execution.id)}
                              >
                                Raise Defect
                              </button>
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
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* --- "Record Result" modal (UI Design Document §5) ----------------- */}
      <Modal
        visible={showRecordModal}
        onClose={closeRecordModal}
        title="Record Result"
        testId="record-result-modal"
      >
        <form onSubmit={handleSubmitRecord(onSubmitRecord)} noValidate>
          <div className="modal-body">
            {/*
              UI Design Document §5: a `422` (out-of-scope TestCase) or `403`
              renders here, inside the modal, dismissible — and the modal stays
              open so the user's typed input survives the failure.
              `alert-dismissible fade show` plus an explicit `.btn-close` is what
              the former `CAlert dismissible` emitted.
            */}
            {recordError && (
              <div
                className="alert alert-danger alert-dismissible fade show"
                role="alert"
                data-testid="record-error"
              >
                {recordError}
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={() => setRecordError(null)}
                />
              </div>
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
              <label className="form-label" htmlFor="recordResult">
                Result
              </label>
              {/* RHF-registered (unlike `TestPlanDetail`'s controlled suite
                  picker) — the `register()` spread is unchanged. */}
              <select
                className={`form-select${recordErrors.result ? " is-invalid" : ""}`}
                id="recordResult"
                data-testid="record-result-select"
                {...registerRecord("result")}
              >
                {TEST_EXECUTION_RESULTS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              {recordErrors.result && (
                <div className="invalid-feedback d-block">{recordErrors.result.message}</div>
              )}
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="recordActualResult">
                Actual result
              </label>
              <textarea
                className="form-control"
                id="recordActualResult"
                rows={3}
                data-testid="record-actual-result"
                {...registerRecord("actualResult")}
              />
              <div className="form-text">Optional.</div>
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="recordExecutedAt">
                Executed at
              </label>
              {/*
                `datetime-local`, not `date`: `executed_at` is a `datetime`
                column and time of day is significant (the same distinction
                `entityConfigs/test-execution.ts`'s own docstring flags).
              */}
              <input
                className={`form-control${recordErrors.executedAt ? " is-invalid" : ""}`}
                id="recordExecutedAt"
                type="datetime-local"
                data-testid="record-executed-at"
                {...registerRecord("executedAt")}
              />
              {recordErrors.executedAt && (
                <div className="invalid-feedback d-block">{recordErrors.executedAt.message}</div>
              )}
            </div>
          </div>
          <div className="modal-footer">
            {/*
              `type="button"` is load-bearing now: `CButton`'s own default was
              `button`, but a bare `<button>` inside a `<form>` defaults to
              `submit` and would turn Cancel into a submit.
            */}
            <button
              type="button"
              className="btn btn-outline-secondary"
              data-testid="record-result-cancel"
              onClick={closeRecordModal}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              data-testid="record-result-submit"
              disabled={isSubmittingRecord}
            >
              {isSubmittingRecord ? "Recording..." : "Record"}
            </button>
          </div>
        </form>
      </Modal>

      {/* --- "Execution history" timeline modal (EXEC-2, FR-EXEC-2) --------
          The one vertically-centred modal in the codebase: CoreUI's
          `alignment="center"` is Bootstrap's `modal-dialog-centered`. */}
      <Modal
        visible={showHistoryModal}
        onClose={closeHistoryModal}
        title="Execution history"
        testId="execution-history-modal"
        centered
      >
        <div className="modal-body">
          {logsLoadError && (
            <div
              className="alert alert-danger"
              role="alert"
              data-testid="execution-log-load-error"
            >
              {logsLoadError}
            </div>
          )}

          {logsLoading ? (
            <div className="d-flex justify-content-center py-3">
              <Spinner />
            </div>
          ) : (
            !logsLoadError && (
              /* Flat <ul>/<li>, never a <table> — frontend/CLAUDE.md. Ordered
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
                      <span
                        className={`badge bg-${logEventColor(log.event_type)}`}
                        data-testid={`execution-log-entry-${log.id}-type`}
                      >
                        {log.event_type}
                      </span>
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

          <form onSubmit={handleSubmitComment(onSubmitComment)} noValidate>
            <h2 className="fs-6 mb-2">Add a comment</h2>

            {commentError && (
              <div className="alert alert-danger" role="alert" data-testid="add-comment-error">
                {commentError}
              </div>
            )}

            <div className="mb-2">
              <label className="form-label" htmlFor="comment-text">
                Comment
              </label>
              <textarea
                className={`form-control${commentErrors.text ? " is-invalid" : ""}`}
                id="comment-text"
                rows={2}
                data-testid="add-comment-text"
                {...registerComment("text")}
              />
              {commentErrors.text && (
                <div className="invalid-feedback d-block">{commentErrors.text.message}</div>
              )}
            </div>

            <div className="mb-2">
              <label className="form-label" htmlFor="comment-attachment-url">
                Attachment URL (optional)
              </label>
              <input
                className="form-control"
                id="comment-attachment-url"
                data-testid="add-comment-attachment-url"
                {...registerComment("attachmentUrl")}
              />
              <div className="form-text">
                A plain link/reference, not a file upload (v1) — supplying one logs this
                entry as an attachment rather than a plain comment.
              </div>
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="comment-file-name">
                File name (optional)
              </label>
              <input
                className="form-control"
                id="comment-file-name"
                data-testid="add-comment-file-name"
                {...registerComment("fileName")}
              />
            </div>

            <div className="d-flex justify-content-end">
              <button
                type="submit"
                className="btn btn-primary"
                data-testid="add-comment-submit"
                disabled={isSubmittingComment}
              >
                {isSubmittingComment ? "Adding..." : "Add comment"}
              </button>
            </div>
          </form>
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-outline-secondary"
            data-testid="execution-history-close"
            onClick={closeHistoryModal}
          >
            Close
          </button>
        </div>
      </Modal>

      {/* --- "Raise Defect" modal (EXEC-3, ADR-0044) ------------------------ */}
      <Modal
        visible={showRaiseDefectModal}
        onClose={closeRaiseDefectModal}
        title="Raise Defect"
        testId="raise-defect-modal"
      >
        <form onSubmit={handleSubmitRaiseDefect(onSubmitRaiseDefect)} noValidate>
          <div className="modal-body">
            {/*
              UI Design Document §3: a `422` (execution no longer `fail`, a
              narrow race) or `403` renders here, inside the modal, dismissible
              — the modal stays open so typed input survives the failure, same
              convention `onSubmitRecord`/EXEC-2's comment form already use.
            */}
            {raiseDefectError && (
              <div
                className="alert alert-danger alert-dismissible fade show"
                role="alert"
                data-testid="raise-defect-error"
              >
                {raiseDefectError}
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={() => setRaiseDefectError(null)}
                />
              </div>
            )}

            <div className="mb-3">
              <label className="form-label" htmlFor="raiseDefectExternalRef">
                External ref (optional)
              </label>
              <input
                className="form-control"
                id="raiseDefectExternalRef"
                data-testid="raise-defect-external-ref"
                {...registerRaiseDefect("externalRef")}
              />
              <div className="form-text">
                e.g. a Jira/GitHub/GitLab issue URL or id — plain text, no live integration
                in this scaffold.
              </div>
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="raiseDefectSeverity">
                Severity
              </label>
              <select
                className={`form-select${raiseDefectErrors.severity ? " is-invalid" : ""}`}
                id="raiseDefectSeverity"
                data-testid="raise-defect-severity"
                {...registerRaiseDefect("severity")}
              >
                {DEFECT_SEVERITIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              {raiseDefectErrors.severity && (
                <div className="invalid-feedback d-block">{raiseDefectErrors.severity.message}</div>
              )}
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="raiseDefectStatus">
                Status (optional, defaults to "open")
              </label>
              <input
                className="form-control"
                id="raiseDefectStatus"
                data-testid="raise-defect-status"
                {...registerRaiseDefect("status")}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-outline-secondary"
              data-testid="raise-defect-cancel"
              onClick={closeRaiseDefectModal}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              data-testid="raise-defect-submit"
              disabled={isSubmittingRaiseDefect}
            >
              {isSubmittingRaiseDefect ? "Raising..." : "Raise Defect"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default TestCycleDetail;
