/**
 * PLAN-1 (ADR-0031) API lib contracts: `TestPlan`'s generic get/list/update
 * calls plus the four bespoke membership/coverage routes' exact URL/method/
 * error-branch shape.
 *
 * The three `TestPlanDetail.*.test.tsx` files mock this module away to assert
 * the *screen's* behaviour, so the paths themselves are only ever exercised
 * here — same `fetch`-stubbing style as `lib/api/testSuites.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addTestSuiteToPlan,
  getTestPlan,
  listPlanTestCases,
  listPlanTestSuites,
  listTestPlans,
  removeTestSuiteFromPlan,
  updateTestPlan,
} from "../../../src/lib/api/testPlans";
import { ApiError } from "../../../src/lib/api/client";
import { clearAccessToken } from "../../../src/lib/auth/tokenStore";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { "Content-Type": "application/json" },
  });
}

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const SUITE_ID = "33333333-3333-3333-3333-333333333333";

const emptyPage = { items: [], total: 0, page: 1, page_size: 25 };

describe("lib/api — PLAN-1 TestPlan routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAccessToken();
  });

  it("getTestPlan GETs the generic item route", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ id: PLAN_ID, identifier: "TP-001" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getTestPlan(PLAN_ID);

    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/v1/test-plans/${PLAN_ID}`);
  });

  it("listTestPlans GETs the generic list route scoped by project_id", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listTestPlans(PROJECT_ID);

    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/v1/test-plans?project_id=${PROJECT_ID}`);
  });

  it("updateTestPlan PATCHes the generic item route with only the given keys", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ id: PLAN_ID, identifier: "TP-001" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateTestPlan(PLAN_ID, { scope: "Auth only" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`/api/v1/test-plans/${PLAN_ID}`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ scope: "Auth only" });
  });

  it("updateTestPlan rejects with ApiError on a 409 invalid_status_transition", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse(
          {
            code: "invalid_status_transition",
            message: "A draft test plan cannot be moved directly to superseded.",
          },
          409,
        ),
      ),
    );

    const error = await updateTestPlan(PLAN_ID, { status: "superseded" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).message).toBe(
      "A draft test plan cannot be moved directly to superseded.",
    );
  });

  it("listPlanTestSuites GETs the live bespoke membership route", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listPlanTestSuites(PLAN_ID);

    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/v1/test-plans/${PLAN_ID}/test-suites`);
  });

  it("listPlanTestCases GETs the bespoke two-hop coverage route", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listPlanTestCases(PLAN_ID);

    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/v1/test-plans/${PLAN_ID}/test-cases`);
  });

  it("a plan covering nothing resolves 200 with an empty list, not a rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(emptyPage)));

    await expect(listPlanTestCases(PLAN_ID)).resolves.toEqual(emptyPage);
  });

  it("addTestSuiteToPlan POSTs the bespoke join route with no body", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ test_plan_id: PLAN_ID, test_suite_id: SUITE_ID }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);

    await addTestSuiteToPlan(PLAN_ID, SUITE_ID);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`/api/v1/test-plans/${PLAN_ID}/test-suites/${SUITE_ID}`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
  });

  it("addTestSuiteToPlan rejects with ApiError on a cross-project 422", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse(
          { code: "validation_error", message: "This test suite belongs to a different project." },
          422,
        ),
      ),
    );

    const error = await addTestSuiteToPlan(PLAN_ID, SUITE_ID).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
  });

  it("addTestSuiteToPlan rejects with ApiError carrying code 'already_included_in_plan' on a duplicate 409", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse(
          {
            code: "already_included_in_plan",
            message: "This test suite is already included in the plan.",
          },
          409,
        ),
      ),
    );

    const error = await addTestSuiteToPlan(PLAN_ID, SUITE_ID).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).body).toMatchObject({ code: "already_included_in_plan" });
  });

  it("removeTestSuiteFromPlan DELETEs the bespoke join route", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    await removeTestSuiteFromPlan(PLAN_ID, SUITE_ID);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`/api/v1/test-plans/${PLAN_ID}/test-suites/${SUITE_ID}`);
    expect(init?.method).toBe("DELETE");
  });

  it("removeTestSuiteFromPlan rejects (not an idempotent success) when the suite isn't currently included", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({ code: "not_found", message: "This test suite is not in this test plan." }, 404),
      ),
    );

    await expect(removeTestSuiteFromPlan(PLAN_ID, SUITE_ID)).rejects.toBeInstanceOf(ApiError);
  });
});
