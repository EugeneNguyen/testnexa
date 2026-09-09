/**
 * REQ-4 (ADR-0030) API lib contracts: `TestSuite`'s generic create/list calls
 * plus the three bespoke membership routes' exact URL/method/error-branch
 * shape.
 *
 * `ProjectDetail.TestSuites.test.tsx` mocks this module away to assert the
 * *screen's* behaviour, so the paths themselves are only ever exercised here
 * — same `fetch`-stubbing style as `lib/api/req3Authoring.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addTestCaseToSuite,
  createTestSuite,
  listSuiteTestCases,
  listTestSuites,
  removeTestCaseFromSuite,
} from "./testSuites";
import { ApiError } from "./client";
import { clearAccessToken } from "../auth/tokenStore";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { "Content-Type": "application/json" },
  });
}

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const SUITE_ID = "22222222-2222-2222-2222-222222222222";
const CASE_ID = "33333333-3333-3333-3333-333333333333";

const emptyPage = { items: [], total: 0, page: 1, page_size: 25 };

describe("lib/api — REQ-4 TestSuite routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAccessToken();
  });

  it("createTestSuite POSTs the generic factory route with project_id in the body", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ id: SUITE_ID, project_id: PROJECT_ID, name: "Regression", purpose: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createTestSuite(PROJECT_ID, { name: "Regression" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/v1/test-suites");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ project_id: PROJECT_ID, name: "Regression" });
  });

  it("createTestSuite includes purpose only when given", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse({ id: SUITE_ID }));
    vi.stubGlobal("fetch", fetchMock);

    await createTestSuite(PROJECT_ID, { name: "Smoke", purpose: "smoke" });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      project_id: PROJECT_ID,
      name: "Smoke",
      purpose: "smoke",
    });
  });

  it("listTestSuites GETs the generic list route scoped by project_id", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listTestSuites(PROJECT_ID);

    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/v1/test-suites?project_id=${PROJECT_ID}`);
  });

  it("listSuiteTestCases GETs the live bespoke membership route", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listSuiteTestCases(SUITE_ID);

    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/v1/test-suites/${SUITE_ID}/test-cases`);
  });

  it("a suite with no members resolves 200 with an empty list, not a rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(emptyPage)));

    await expect(listSuiteTestCases(SUITE_ID)).resolves.toEqual(emptyPage);
  });

  it("addTestCaseToSuite POSTs the bespoke join route with no body", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ test_suite_id: SUITE_ID, test_case_id: CASE_ID }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);

    await addTestCaseToSuite(SUITE_ID, CASE_ID);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`/api/v1/test-suites/${SUITE_ID}/test-cases/${CASE_ID}`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
  });

  it("addTestCaseToSuite rejects with ApiError carrying code 'validation_error' on a cross-project 422", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse(
          { code: "validation_error", message: "This test case belongs to a different project." },
          422,
        ),
      ),
    );

    const error = await addTestCaseToSuite(SUITE_ID, CASE_ID).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("This test case belongs to a different project.");
  });

  it("addTestCaseToSuite rejects with ApiError carrying code 'already_in_suite' on a duplicate 409", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({ code: "already_in_suite", message: "This test case is already in the suite." }, 409),
      ),
    );

    const error = await addTestCaseToSuite(SUITE_ID, CASE_ID).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("This test case is already in the suite.");
  });

  it("removeTestCaseFromSuite DELETEs the bespoke join route", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    await removeTestCaseFromSuite(SUITE_ID, CASE_ID);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`/api/v1/test-suites/${SUITE_ID}/test-cases/${CASE_ID}`);
    expect(init?.method).toBe("DELETE");
  });

  it("removeTestCaseFromSuite rejects (not an idempotent success) when the pair isn't a current member", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({ code: "not_found", message: "This test case is not in this test suite." }, 404),
      ),
    );

    await expect(removeTestCaseFromSuite(SUITE_ID, CASE_ID)).rejects.toBeInstanceOf(ApiError);
  });
});
