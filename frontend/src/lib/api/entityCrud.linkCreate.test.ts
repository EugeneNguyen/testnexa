/**
 * ADR-0076 — `interpolateLinkPath` / `createLinkRow` (TC-ADMIN-089).
 *
 * The URL these two build is the entire contract between a relationship tab
 * and a bespoke route it knows nothing else about: the tab has two ids and a
 * `pathTemplate`, and nothing validates the result before it goes on the wire.
 * So the cases worth pinning are the ones that would otherwise `404` in
 * production with no clue why — a placeholder left unfilled, the substitution
 * happening in the wrong order, or the `/api/v1` prefix going missing.
 *
 * Same `fetch`-stubbing style as `testSuites.test.ts`, since
 * `EntityRelationTab`'s own tests mock this module away to assert the
 * component's behaviour instead.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLinkRow, interpolateLinkPath } from "./entityCrud";
import { clearAccessToken } from "../auth/tokenStore";

const REQUIREMENT_ID = "11111111-1111-1111-1111-111111111111";
const CASE_ID = "22222222-2222-2222-2222-222222222222";

const ACTION = {
  pathTemplate: "/requirements/{requirement_id}/test-case-links/{test_case_id}",
  permission: "requirement_test_case_link.create",
};

function jsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("interpolateLinkPath (ADR-0076)", () => {
  it("TC-ADMIN-089: fills every {field} placeholder from the matching key", () => {
    expect(
      interpolateLinkPath(ACTION.pathTemplate, {
        requirement_id: REQUIREMENT_ID,
        test_case_id: CASE_ID,
      }),
    ).toBe(`/requirements/${REQUIREMENT_ID}/test-case-links/${CASE_ID}`);
  });

  it("TC-ADMIN-089: substitutes by NAME, not by position", () => {
    /**
     * The whole reason `LinkCreateAction` names its placeholders after the
     * link row's own FK columns: a tab mounted at either end of the junction
     * hands the same object in, and only a by-name substitution puts each id
     * in the right segment. A positional implementation would pass the test
     * above and silently swap the two ids here.
     */
    const swappedKeyOrder = { test_case_id: CASE_ID, requirement_id: REQUIREMENT_ID };
    expect(interpolateLinkPath(ACTION.pathTemplate, swappedKeyOrder)).toBe(
      `/requirements/${REQUIREMENT_ID}/test-case-links/${CASE_ID}`,
    );
  });

  it("TC-ADMIN-089: throws rather than POSTing a URL with a literal brace in it", () => {
    /**
     * A missing value is a programming error (the tab always holds both ids),
     * and the alternative — leaving `{test_case_id}` in the path — produces a
     * `404` from a route that looks like it should have worked, which is
     * strictly harder to diagnose than an exception naming the field.
     */
    expect(() => interpolateLinkPath(ACTION.pathTemplate, { requirement_id: REQUIREMENT_ID })).toThrow(
      /test_case_id/,
    );
    expect(() =>
      interpolateLinkPath(ACTION.pathTemplate, { requirement_id: REQUIREMENT_ID, test_case_id: "" }),
    ).toThrow(/test_case_id/);
  });

  it("TC-ADMIN-089: leaves a template with no placeholders untouched", () => {
    expect(interpolateLinkPath("/health", {})).toBe("/health");
  });
});

describe("createLinkRow (ADR-0076)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAccessToken();
  });

  it("TC-ADMIN-089: POSTs the interpolated path under /api/v1 with no request body", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ requirement_id: REQUIREMENT_ID, test_case_id: CASE_ID }));
    vi.stubGlobal("fetch", fetchMock);

    await createLinkRow(ACTION, { requirement_id: REQUIREMENT_ID, test_case_id: CASE_ID });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // The prefix is added here, never in the template — a template carrying
    // its own would produce `/api/v1/api/v1/...`.
    expect(url).toBe(`/api/v1/requirements/${REQUIREMENT_ID}/test-case-links/${CASE_ID}`);
    expect(init.method).toBe("POST");
    // Both ids travel in the path; the route parses no body at all.
    expect(init.body).toBeUndefined();
  });

  it("TC-ADMIN-089: surfaces the route's own error envelope as an ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { code: "link_already_exists", message: "This test case is already linked to this requirement.", field_errors: null },
          409,
        ),
      ),
    );

    await expect(
      createLinkRow(ACTION, { requirement_id: REQUIREMENT_ID, test_case_id: CASE_ID }),
    ).rejects.toMatchObject({ message: "This test case is already linked to this requirement." });
  });
});
