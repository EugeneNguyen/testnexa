/**
 * ADR-0077 — `deleteLinkRow` (TC-ADMIN-107).
 *
 * `entityCrud.linkCreate.test.ts`'s sibling, and deliberately a separate file
 * for the same reason that one is separate from `entityCrud`'s other calls:
 * the URL these build is the entire contract between a relationship tab and a
 * bespoke route it knows nothing else about, and nothing validates the result
 * before it goes on the wire.
 *
 * `interpolateLinkPath` itself is already pinned by the create-side file and
 * is shared verbatim, so it is not re-tested here — what is new, and what this
 * file exists for, is the three things that differ: the **verb**, the **204
 * with no body**, and the fact that it reads a **different declaration**
 * (`linkDelete`, whose permission is a different code for four of the six
 * junctions) so a component cannot quietly unlink using the create action.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteLinkRow } from "./entityCrud";
import { clearAccessToken } from "../auth/tokenStore";

const REQUIREMENT_ID = "11111111-1111-1111-1111-111111111111";
const CASE_ID = "22222222-2222-2222-2222-222222222222";

const ACTION = {
  pathTemplate: "/requirements/{requirement_id}/test-case-links/{test_case_id}",
  // The `.delete` code, not `.create` — see this module's docstring.
  permission: "requirement_test_case_link.delete",
};

function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("deleteLinkRow (ADR-0077)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAccessToken();
  });

  it("TC-ADMIN-107: DELETEs the interpolated path under /api/v1 with no request body", async () => {
    const fetchMock = vi.fn(async () => noContentResponse());
    vi.stubGlobal("fetch", fetchMock);

    await deleteLinkRow(ACTION, { requirement_id: REQUIREMENT_ID, test_case_id: CASE_ID });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // Same path the matching POST builds — same URL, different verb.
    expect(url).toBe(`/api/v1/requirements/${REQUIREMENT_ID}/test-case-links/${CASE_ID}`);
    expect(init.method).toBe("DELETE");
    // Both ids travel in the path; the route parses no body at all.
    expect(init.body).toBeUndefined();
  });

  it("TC-ADMIN-107: resolves undefined on 204 rather than trying to parse an empty body", async () => {
    /**
     * `204 No Content` genuinely has no body, and a caller that `await`ed a
     * JSON parse of one would reject with a `SyntaxError` that reads like the
     * unlink failed when it in fact succeeded. Pinned because the success path
     * of every *other* write in this module returns a parsed object.
     */
    vi.stubGlobal("fetch", vi.fn(async () => noContentResponse()));

    await expect(
      deleteLinkRow(ACTION, { requirement_id: REQUIREMENT_ID, test_case_id: CASE_ID }),
    ).resolves.toBeUndefined();
  });

  it("TC-ADMIN-107: substitutes by NAME, so either end of the junction builds the same URL", () => {
    /**
     * The by-name contract restated on the delete side, because this is the
     * call a tab mounted at the *reverse* end of a bidirectional junction
     * makes (ADR-0075 Amendment 1) — the key order it hands in follows that
     * tab's own `scopeField`/`targetField`, not the path's segment order.
     */
    const fetchMock = vi.fn(async () => noContentResponse());
    vi.stubGlobal("fetch", fetchMock);

    return deleteLinkRow(ACTION, { test_case_id: CASE_ID, requirement_id: REQUIREMENT_ID }).then(() => {
      const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`/api/v1/requirements/${REQUIREMENT_ID}/test-case-links/${CASE_ID}`);
    });
  });

  it("TC-ADMIN-107: surfaces a 404 for an already-removed pair as an ApiError with the route's own message", async () => {
    /**
     * The `DELETE`-of-a-non-member `404` is deliberate, not idempotent `204`
     * (ADR-0030's asymmetry, inherited by ADR-0077's four routes) — so this is
     * a real, reachable outcome whenever two people unlink the same pair, and
     * `EntityRelationTab` renders this message verbatim in its confirm modal.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            code: "not_found",
            message: "This test case is not linked to this requirement.",
            field_errors: null,
          },
          404,
        ),
      ),
    );

    await expect(
      deleteLinkRow(ACTION, { requirement_id: REQUIREMENT_ID, test_case_id: CASE_ID }),
    ).rejects.toMatchObject({ message: "This test case is not linked to this requirement." });
  });

  it("TC-ADMIN-107: surfaces a 403 distinctly from the 404 above", async () => {
    /**
     * The two failures mean opposite things to the user — "someone already
     * removed it" versus "you may not" — which is why the component renders
     * the API's own message rather than one generic string.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            code: "permission_denied",
            message: "You do not have permission to perform this action.",
            field_errors: null,
          },
          403,
        ),
      ),
    );

    await expect(
      deleteLinkRow(ACTION, { requirement_id: REQUIREMENT_ID, test_case_id: CASE_ID }),
    ).rejects.toMatchObject({
      status: 403,
      message: "You do not have permission to perform this action.",
    });
  });
});
