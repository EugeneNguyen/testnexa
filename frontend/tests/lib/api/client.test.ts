import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, requestRefresh } from "../../../src/lib/api/client";
import { login, refresh } from "../../../src/lib/api/auth";
import { clearAccessToken, getAccessToken, setAccessToken } from "../../../src/lib/auth/tokenStore";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

describe("apiFetch", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAccessToken();
  });

  it("attaches an Authorization header when a token is set", async () => {
    setAccessToken("token-abc");
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/v1/widgets");

    const [, init] = fetchMock.mock.calls[0];
    expect(headersOf(init).Authorization).toBe("Bearer token-abc");
  });

  it("omits the Authorization header when no token is set", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/v1/widgets");

    const [, init] = fetchMock.mock.calls[0];
    expect(headersOf(init).Authorization).toBeUndefined();
  });

  it("on 401 retries the original request once after a successful refresh", async () => {
    setAccessToken("expired-token");
    let widgetCallCount = 0;
    let refreshCallCount = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/refresh")) {
        refreshCallCount += 1;
        return jsonResponse({ access_token: "new-token" }, 200);
      }
      if (href.includes("/api/v1/widgets")) {
        widgetCallCount += 1;
        if (widgetCallCount === 1) {
          return jsonResponse(
            { code: "invalid_token", message: "expired", field_errors: null },
            401,
          );
        }
        expect(headersOf(init).Authorization).toBe("Bearer new-token");
        return jsonResponse({ items: [] }, 200);
      }
      throw new Error(`unexpected fetch to ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch("/api/v1/widgets");

    expect(result).toEqual({ items: [] });
    expect(getAccessToken()).toBe("new-token");
    expect(refreshCallCount).toBe(1);
    expect(widgetCallCount).toBe(2);
  });

  it("on 401 with a failing refresh, clears the token store and redirects to /login", async () => {
    setAccessToken("expired-token");
    const assignMock = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign: assignMock },
    });

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/auth/refresh")) {
        return jsonResponse(
          { code: "invalid_refresh_token", message: "refresh failed", field_errors: null },
          401,
        );
      }
      if (href.includes("/api/v1/widgets")) {
        return jsonResponse(
          { code: "widget_error", message: "widget failed", field_errors: null },
          401,
        );
      }
      throw new Error(`unexpected fetch to ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // Asserting the ORIGINAL widget call's error (code/message) is what
    // propagates — not the distinct refresh-call error — is the point of
    // this test: it proves apiFetch rethrows the original 401, discarding
    // refresh's own error, rather than merely checking `status: 401` (which
    // both mocked responses share and can't distinguish).
    await expect(apiFetch("/api/v1/widgets")).rejects.toMatchObject({
      status: 401,
      message: "widget failed",
      body: { code: "widget_error", message: "widget failed", field_errors: null },
    });

    expect(getAccessToken()).toBeNull();
    expect(assignMock).toHaveBeenCalledWith("/login");

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("dedups concurrent 401s to a single in-flight refresh call", async () => {
    setAccessToken("expired-token");
    let refreshCallCount = 0;
    let widgetCallCount = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/auth/refresh")) {
        refreshCallCount += 1;
        return jsonResponse({ access_token: "new-token" }, 200);
      }
      if (href.includes("/api/v1/widgets")) {
        widgetCallCount += 1;
        if (widgetCallCount <= 2) {
          return jsonResponse(
            { code: "invalid_token", message: "expired", field_errors: null },
            401,
          );
        }
        return jsonResponse({ items: [] }, 200);
      }
      throw new Error(`unexpected fetch to ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const [r1, r2] = await Promise.all([
      apiFetch("/api/v1/widgets"),
      apiFetch("/api/v1/widgets"),
    ]);

    expect(r1).toEqual({ items: [] });
    expect(r2).toEqual({ items: [] });
    expect(refreshCallCount).toBe(1);
  });

  it("does not trigger the refresh interceptor when /auth/login itself returns 401", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/auth/login")) {
        return jsonResponse(
          { code: "invalid_credentials", message: "bad creds", field_errors: null },
          401,
        );
      }
      throw new Error(`unexpected fetch to ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(login("a@b.com", "wrong-password")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dedups a boot-triggered requestRefresh() call with a concurrent interceptor-triggered 401 refresh", async () => {
    // Regression test for fix round 1: AuthContext's boot-time refresh used
    // to call the raw refresh() (lib/api/auth.ts), bypassing this module's
    // shared refreshPromise dedup entirely. Two concurrent callers -- one
    // "boot-triggered" (calling requestRefresh() directly, exactly like
    // AuthContext's boot effect now does), one "interceptor-triggered" (an
    // authenticated apiFetch call hitting a 401 and recovering via the same
    // requestRefresh()) -- must collapse into exactly one real
    // POST /auth/refresh call, never two presentations of the same
    // single-use refresh cookie (ADR-0013).
    setAccessToken("expired-token");
    let refreshCallCount = 0;
    let widgetCallCount = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/auth/refresh")) {
        refreshCallCount += 1;
        return jsonResponse({ access_token: "new-token" }, 200);
      }
      if (href.includes("/api/v1/widgets")) {
        widgetCallCount += 1;
        if (widgetCallCount === 1) {
          return jsonResponse(
            { code: "invalid_token", message: "expired", field_errors: null },
            401,
          );
        }
        return jsonResponse({ items: [] }, 200);
      }
      throw new Error(`unexpected fetch to ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const [bootResult, interceptorResult] = await Promise.all([
      requestRefresh(), // simulated boot-triggered caller
      apiFetch("/api/v1/widgets"), // triggers apiFetch's own 401 -> requestRefresh() internally
    ]);

    expect(bootResult).toEqual({ access_token: "new-token" });
    expect(interceptorResult).toEqual({ items: [] });
    expect(refreshCallCount).toBe(1);
  });

  it("does not trigger a recursive refresh when /auth/refresh itself returns 401", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/auth/refresh")) {
        return jsonResponse(
          { code: "invalid_refresh_token", message: "expired", field_errors: null },
          401,
        );
      }
      throw new Error(`unexpected fetch to ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(refresh()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
