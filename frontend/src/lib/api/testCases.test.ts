/**
 * REQ-5 (ADR-0069) API lib contracts: `linkTestCaseToRequirement`/
 * `getTestCaseRequirementLink`, the two new lib functions backing
 * `EntityFormPage`'s "Link to Requirement" section. Standalone create
 * itself goes through the existing generic `lib/api/entityCrud.ts`
 * `createEntity`/`listEntities` (schema-driven, ADR-0055) — no new lib
 * function needed for that half, same `fetch`-stubbing style as
 * `testConditions.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTestCaseRequirementLink, linkTestCaseToRequirement } from "./testCases";
import { ApiError } from "./client";
import { clearAccessToken } from "../auth/tokenStore";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const TEST_CASE_ID = "66666666-6666-6666-6666-666666666666";
const REQUIREMENT_ID = "22222222-2222-2222-2222-222222222222";

describe("lib/api — REQ-5 standalone TestCase / link-requirement routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAccessToken();
  });

  it("linkTestCaseToRequirement POSTs the retrofit route with only requirement_id", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ id: TEST_CASE_ID, test_condition_id: null, project_id: null }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);

    await linkTestCaseToRequirement(TEST_CASE_ID, { requirement_id: REQUIREMENT_ID });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`/api/v1/test-cases/${TEST_CASE_ID}/link-requirement`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ requirement_id: REQUIREMENT_ID });
  });

  it("linkTestCaseToRequirement rejects with ApiError on 409 already_linked_to_requirement", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ code: "already_linked_to_requirement", message: "Already linked." }, 409),
      ),
    );

    await expect(
      linkTestCaseToRequirement(TEST_CASE_ID, { requirement_id: REQUIREMENT_ID }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("linkTestCaseToRequirement rejects with ApiError on 422 cross-project", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "validation_error", message: "Cross-project." }, 422)),
    );

    await expect(
      linkTestCaseToRequirement(TEST_CASE_ID, { requirement_id: REQUIREMENT_ID }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("getTestCaseRequirementLink GETs the read route and returns requirement_id verbatim", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ requirement_id: REQUIREMENT_ID }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTestCaseRequirementLink(TEST_CASE_ID);

    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/v1/test-cases/${TEST_CASE_ID}/requirement-link`);
    expect(result).toEqual({ requirement_id: REQUIREMENT_ID });
  });

  it("getTestCaseRequirementLink returns null for a standalone (unlinked) case", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ requirement_id: null })));

    const result = await getTestCaseRequirementLink(TEST_CASE_ID);

    expect(result.requirement_id).toBeNull();
  });
});
