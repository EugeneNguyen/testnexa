/**
 * REQ-3 (ADR-0028) API lib contracts: the exact URL/method/body each of the
 * two bespoke authoring routes is called with, plus the taxonomy catalog
 * reads backing the "New Test Case" modal's selects.
 *
 * `ProjectDetail.TestConditions.test.tsx` mocks these modules away to assert
 * the *form* behaviour, so the paths themselves are only ever exercised
 * here — same `fetch`-stubbing style as `lib/api/members.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestCondition, listTestConditions } from "./testConditions";
import { createTestCaseForTestCondition } from "./testCases";
import { listTestLevels, listTestTypes } from "./taxonomy";
import { ApiError } from "./client";
import { clearAccessToken } from "../auth/tokenStore";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const REQUIREMENT_ID = "22222222-2222-2222-2222-222222222222";
const CONDITION_ID = "33333333-3333-3333-3333-333333333333";
const LEVEL_ID = "44444444-4444-4444-4444-444444444444";
const TYPE_ID = "55555555-5555-5555-5555-555555555555";

const emptyPage = { items: [], total: 0, page: 1, page_size: 25 };

describe("lib/api — REQ-3 authoring routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAccessToken();
  });

  it("createTestCondition POSTs the bespoke per-requirement route with only description/priority", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({
        id: CONDITION_ID,
        requirement_id: REQUIREMENT_ID,
        description: "d",
        priority: "high",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createTestCondition(REQUIREMENT_ID, { description: "d", priority: "high" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`/api/v1/requirements/${REQUIREMENT_ID}/test-conditions`);
    expect(init?.method).toBe("POST");
    // `requirement_id` is stamped from the path server-side, never sent.
    expect(JSON.parse(String(init?.body))).toEqual({ description: "d", priority: "high" });
  });

  it("listTestConditions GETs the generic list route scoped by requirement_id", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse(emptyPage),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listTestConditions(REQUIREMENT_ID);

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `/api/v1/test-conditions?requirement_id=${REQUIREMENT_ID}`,
    );
  });

  it("listTestConditions appends page/page_size when provided", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse(emptyPage),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listTestConditions(REQUIREMENT_ID, { page: 2, page_size: 10 });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `/api/v1/test-conditions?requirement_id=${REQUIREMENT_ID}&page=2&page_size=10`,
    );
  });

  it("createTestCaseForTestCondition POSTs the bespoke per-condition route", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ id: "tc-1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createTestCaseForTestCondition(CONDITION_ID, {
      title: "t",
      preconditions: "p",
      expected_result: "e",
      test_level_id: LEVEL_ID,
      test_type_id: TYPE_ID,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`/api/v1/test-conditions/${CONDITION_ID}/test-cases`);
    expect(init?.method).toBe("POST");
    // Neither `test_condition_id` (path) nor `status`/`created_by_actor_id`
    // (server-stamped) appear in the body.
    expect(JSON.parse(String(init?.body))).toEqual({
      title: "t",
      preconditions: "p",
      expected_result: "e",
      test_level_id: LEVEL_ID,
      test_type_id: TYPE_ID,
    });
  });

  it("rejects with ApiError when the bespoke create route 403s", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({ code: "permission_denied", message: "Denied." }, 403),
      ),
    );

    await expect(
      createTestCaseForTestCondition(CONDITION_ID, {
        title: "t",
        test_level_id: LEVEL_ID,
        test_type_id: TYPE_ID,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("listTestLevels/listTestTypes GET the unscoped global catalog routes", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse(emptyPage),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listTestLevels();
    await listTestTypes();

    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/v1/test-levels");
    expect(String(fetchMock.mock.calls[1][0])).toBe("/api/v1/test-types");
  });
});
