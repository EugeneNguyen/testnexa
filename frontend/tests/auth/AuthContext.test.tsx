import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext";
import { clearAccessToken, getAccessToken } from "../../src/lib/auth/tokenStore";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function Consumer() {
  const { isInitializing, accessToken } = useAuth();
  return (
    <div>
      <div data-testid="initializing">{String(isInitializing)}</div>
      <div data-testid="access-token">{accessToken ?? "none"}</div>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>,
  );
}

describe("AuthProvider boot-time silent refresh", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAccessToken();
  });

  it("starts with isInitializing true before the boot refresh settles", async () => {
    // `requestRefresh()` (lib/api/client.ts) is now shared by AuthContext's
    // boot effect too (fix round 1), so its `refreshPromise` module state is
    // shared across every test in this file. A fetch mock left permanently
    // pending would leave that shared promise stuck forever and poison
    // later tests, so this resolves it (deliberately with an
    // uncontroversial value) before the test ends instead of leaving it
    // hanging.
    let resolveFetch: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderProvider();

    expect(screen.getByTestId("initializing")).toHaveTextContent("true");

    resolveFetch(jsonResponse({ access_token: "irrelevant-token" }));
    await waitFor(() => {
      expect(screen.getByTestId("initializing")).toHaveTextContent("false");
    });
  });

  it("populates the token store and settles isInitializing on a successful boot refresh", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/auth/refresh")) {
        return jsonResponse({ access_token: "restored-token" });
      }
      throw new Error(`unexpected fetch to ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("initializing")).toHaveTextContent("false");
    });

    expect(screen.getByTestId("access-token")).toHaveTextContent("restored-token");
    expect(getAccessToken()).toBe("restored-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["401 invalid_refresh_token", 401, "invalid_refresh_token"],
    ["403 no_active_organization", 403, "no_active_organization"],
  ])(
    "settles isInitializing with no session, no crash, and no redirect on a %s boot refresh failure",
    async (_label, status, code) => {
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const href = String(url);
        if (href.includes("/auth/refresh")) {
          return jsonResponse(
            { code, message: "cannot restore session", field_errors: null },
            status,
          );
        }
        throw new Error(`unexpected fetch to ${href}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const assignMock = vi.fn();
      const originalLocation = window.location;
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...originalLocation, assign: assignMock },
      });

      renderProvider();

      await waitFor(() => {
        expect(screen.getByTestId("initializing")).toHaveTextContent("false");
      });

      expect(screen.getByTestId("access-token")).toHaveTextContent("none");
      expect(getAccessToken()).toBeNull();
      // AuthContext itself never redirects on a failed boot refresh — that's
      // ProtectedRoute's job when something tries to render a protected page.
      expect(assignMock).not.toHaveBeenCalled();

      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    },
  );
});

/**
 * AUTH-3 (ADR-0014): `logout()`'s client-side cleanup must run unconditionally,
 * even when the underlying `POST /auth/logout` API call rejects outright
 * (network failure) — that cleanup is the actual security property AUTH-3
 * delivers for a shared/public machine, and must not be held hostage to
 * network reachability.
 */
describe("AuthProvider.logout()", () => {
  function LogoutConsumer() {
    const { accessToken, orgContext, orgs, login, logout } = useAuth();
    return (
      <div>
        <div data-testid="access-token">{accessToken ?? "none"}</div>
        <div data-testid="org-context">{orgContext ?? "none"}</div>
        <div data-testid="orgs-count">{orgs.length}</div>
        <button onClick={() => void login("user@example.com", "password")}>Log in</button>
        <button onClick={() => void logout()}>Log out</button>
      </div>
    );
  }

  beforeEach(() => {
    clearAccessToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAccessToken();
  });

  it("clears the token store and resets org state even when the logout API call rejects", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/auth/refresh")) {
        // Boot-time silent refresh: no session to restore.
        return jsonResponse(
          { code: "invalid_refresh_token", message: "no session", field_errors: null },
          401,
        );
      }
      if (href.includes("/auth/login")) {
        return jsonResponse({
          access_token: "session-token",
          org_context: "auto",
          orgs: [{ id: "org-1", name: "Org One", slug: "org-one" }],
        });
      }
      if (href.includes("/auth/logout")) {
        throw new Error("network failure");
      }
      throw new Error(`unexpected fetch to ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <LogoutConsumer />
      </AuthProvider>,
    );

    // Let the boot-time refresh settle (fails: no session) before driving login.
    await waitFor(() => {
      expect(screen.getByTestId("access-token")).toHaveTextContent("none");
    });

    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => {
      expect(screen.getByTestId("access-token")).toHaveTextContent("session-token");
    });
    expect(screen.getByTestId("org-context")).toHaveTextContent("auto");
    expect(screen.getByTestId("orgs-count")).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => {
      expect(screen.getByTestId("access-token")).toHaveTextContent("none");
    });
    expect(getAccessToken()).toBeNull();
    expect(screen.getByTestId("org-context")).toHaveTextContent("none");
    expect(screen.getByTestId("orgs-count")).toHaveTextContent("0");
  });
});
