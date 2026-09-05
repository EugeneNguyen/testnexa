import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptInvite,
  acceptOwnMembership,
  inviteMember,
  listMembers,
  revokeInvite,
  updateMembershipStatus,
} from "../../../src/lib/api/members";
import { ApiError } from "../../../src/lib/api/client";
import { clearAccessToken, setAccessToken } from "../../../src/lib/auth/tokenStore";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

const ORG_ID = "org-1";
const MEMBERSHIP_ID = "membership-1";

describe("lib/api/members", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAccessToken();
  });

  describe("listMembers", () => {
    it("GETs the paginated members list with the org's Authorization header", async () => {
      setAccessToken("token-abc");
      const page = { items: [], total: 0, page: 1, page_size: 25 };
      const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(page));
      vi.stubGlobal("fetch", fetchMock);

      const result = await listMembers(ORG_ID);

      expect(result).toEqual(page);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe(`/api/v1/orgs/${ORG_ID}/members`);
      expect(headersOf(init).Authorization).toBe("Bearer token-abc");
    });

    it("appends page/page_size query params when provided", async () => {
      const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({ items: [], total: 0, page: 2, page_size: 10 }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await listMembers(ORG_ID, { page: 2, page_size: 10 });

      const [url] = fetchMock.mock.calls[0];
      expect(String(url)).toBe(`/api/v1/orgs/${ORG_ID}/members?page=2&page_size=10`);
    });

    it("rejects with ApiError on a 404 (no membership in org_id, NFR-19)", async () => {
      const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({ code: "not_found", message: "Organization not found.", field_errors: null }, 404),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(listMembers(ORG_ID)).rejects.toMatchObject({ status: 404 });
    });

    it("rejects with ApiError on a 403 (membership present but missing org_membership.read)", async () => {
      const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse(
          { code: "permission_denied", message: "You do not have permission.", field_errors: null },
          403,
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(listMembers(ORG_ID)).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe("inviteMember", () => {
    it("POSTs {email} and resolves the invite_link response for a new-email invite", async () => {
      const response = {
        membership_id: MEMBERSHIP_ID,
        status: "invited" as const,
        invite_link: "https://app.example.com/invites/raw-token/accept",
      };
      const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(response, 201));
      vi.stubGlobal("fetch", fetchMock);

      const result = await inviteMember(ORG_ID, { email: "new@example.com" });

      expect(result).toEqual(response);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe(`/api/v1/orgs/${ORG_ID}/members/invite`);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({ email: "new@example.com" });
    });

    it("resolves invite_link: null for an existing-user invite", async () => {
      const response = { membership_id: MEMBERSHIP_ID, status: "invited" as const, invite_link: null };
      const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(response, 201));
      vi.stubGlobal("fetch", fetchMock);

      const result = await inviteMember(ORG_ID, { email: "existing@example.com" });

      expect(result.invite_link).toBeNull();
    });

    it("rejects with ApiError 409 when the email already has a membership in this org", async () => {
      const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({ code: "already_member", message: "Already a member.", field_errors: null }, 409),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(inviteMember(ORG_ID, { email: "dup@example.com" })).rejects.toMatchObject({
        status: 409,
      });
    });
  });

  describe("acceptInvite", () => {
    it("POSTs {password} to /invites/{token}/accept without an Authorization header and with credentials included", async () => {
      const response = {
        access_token: "invite-issued-access-token",
        org_context: "auto" as const,
        orgs: [{ id: ORG_ID, name: "Acme", slug: "acme" }],
      };
      const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(response, 200));
      vi.stubGlobal("fetch", fetchMock);

      const result = await acceptInvite("raw-token", { password: "CorrectHorseBatteryStaple!1" });

      expect(result).toEqual(response);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe("/api/v1/invites/raw-token/accept");
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("include");
      expect(headersOf(init).Authorization).toBeUndefined();
      expect(JSON.parse(init?.body as string)).toEqual({ password: "CorrectHorseBatteryStaple!1" });
    });

    it("rejects with ApiError 404 invite_not_found for a missing/expired token", async () => {
      const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse(
          { code: "invite_not_found", message: "This invite link is invalid or has expired.", field_errors: null },
          404,
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(acceptInvite("bad-token", { password: "whatever123" })).rejects.toMatchObject({
        status: 404,
        message: "This invite link is invalid or has expired.",
      });
    });

    it("does not trigger apiFetch's refresh-and-retry interceptor on its own 401/404", async () => {
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const href = String(url);
        if (href.includes("/invites/")) {
          return jsonResponse({ code: "invite_not_found", message: "invalid", field_errors: null }, 404);
        }
        throw new Error(`unexpected fetch to ${href}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(acceptInvite("bad-token", { password: "whatever123" })).rejects.toBeInstanceOf(
        ApiError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("acceptOwnMembership", () => {
    it("POSTs to the self-accept route with the bearer token, no body", async () => {
      setAccessToken("token-abc");
      const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(null, 200));
      vi.stubGlobal("fetch", fetchMock);

      await acceptOwnMembership(ORG_ID, MEMBERSHIP_ID);

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe(`/api/v1/orgs/${ORG_ID}/members/${MEMBERSHIP_ID}/accept`);
      expect(init?.method).toBe("POST");
      expect(headersOf(init).Authorization).toBe("Bearer token-abc");
    });

    it("rejects with ApiError 403 actor_forbidden when caller isn't the targeted user", async () => {
      const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse(
          { code: "actor_forbidden", message: "This action is restricted.", field_errors: null },
          403,
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(acceptOwnMembership(ORG_ID, MEMBERSHIP_ID)).rejects.toMatchObject({ status: 403 });
    });
  });

  describe("updateMembershipStatus", () => {
    it("PATCHes {status: 'suspended'} to suspend a member", async () => {
      const updated = {
        membership_id: MEMBERSHIP_ID,
        user_id: "user-1",
        email: "a@b.com",
        status: "suspended" as const,
        joined_at: "2026-01-01T00:00:00Z",
      };
      const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(updated));
      vi.stubGlobal("fetch", fetchMock);

      const result = await updateMembershipStatus(ORG_ID, MEMBERSHIP_ID, "suspended");

      expect(result).toEqual(updated);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe(`/api/v1/orgs/${ORG_ID}/members/${MEMBERSHIP_ID}`);
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(init?.body as string)).toEqual({ status: "suspended" });
    });

    it("PATCHes {status: 'active'} to reactivate a member", async () => {
      const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({
          membership_id: MEMBERSHIP_ID,
          user_id: "user-1",
          email: "a@b.com",
          status: "active",
          joined_at: "2026-01-01T00:00:00Z",
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await updateMembershipStatus(ORG_ID, MEMBERSHIP_ID, "active");

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init?.body as string)).toEqual({ status: "active" });
    });

    it("rejects with ApiError 422 on an illegal transition", async () => {
      const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse(
          {
            code: "validation_error",
            message: "Request failed validation.",
            field_errors: { status: ["invited -> active is not a legal transition here"] },
          },
          422,
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(updateMembershipStatus(ORG_ID, MEMBERSHIP_ID, "active")).rejects.toMatchObject({
        status: 422,
      });
    });
  });

  describe("revokeInvite", () => {
    it("DELETEs the membership and resolves undefined on 204", async () => {
      const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await revokeInvite(ORG_ID, MEMBERSHIP_ID);

      expect(result).toBeUndefined();
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe(`/api/v1/orgs/${ORG_ID}/members/${MEMBERSHIP_ID}`);
      expect(init?.method).toBe("DELETE");
    });

    it("rejects with ApiError 422 against an active/suspended membership", async () => {
      const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse(
          { code: "validation_error", message: "Not a pending invite.", field_errors: null },
          422,
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(revokeInvite(ORG_ID, MEMBERSHIP_ID)).rejects.toMatchObject({ status: 422 });
    });
  });
});
