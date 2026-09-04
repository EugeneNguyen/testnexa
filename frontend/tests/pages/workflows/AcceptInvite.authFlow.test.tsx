import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import AcceptInvite from "../../../src/pages/workflows/AcceptInvite";
import { AuthProvider } from "../../../src/auth/AuthContext";
import { clearAccessToken, getAccessToken } from "../../../src/lib/auth/tokenStore";

/**
 * RBAC-2: the accept-invite success path, exercised against the REAL
 * `AuthContext.acceptInvite()` -> `lib/api/members.acceptInvite()` ->
 * `apiFetch()` chain with a stubbed `fetch`, mirroring
 * `Signup.authFlow.test.tsx`'s own convention exactly (see that file's
 * docstring for why this needs to be its own file, not a second `describe`
 * block in `AcceptInvite.test.tsx` — Vitest's `vi.mock` hoisting).
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AcceptInvite page — real AuthProvider (success path updates auth state and navigates)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAccessToken();
  });

  it("stores the access token, resolves org_context/orgs, and redirects into the app authenticated", async () => {
    const org = { id: "22222222-2222-2222-2222-222222222222", name: "Acme Corp", slug: "acme-corp" };
    const fetchMock = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        jsonResponse({
          access_token: "invite-issued-access-token",
          org_context: "auto",
          orgs: [org],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={["/invites/the-raw-token/accept"]}>
        <AuthProvider>
          <Routes>
            <Route path="/invites/:token/accept" element={<AcceptInvite />} />
            <Route path={`/orgs/${org.id}`} element={<div>Landed on the org, authenticated</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    // Real AuthProvider mounts with a boot-time silent refresh in flight —
    // the first fetch call is that refresh attempt, must settle first.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "CorrectHorse1!" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "CorrectHorse1!" } });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));

    await screen.findByText(/landed on the org, authenticated/i);

    expect(getAccessToken()).toBe("invite-issued-access-token");

    const acceptCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/invites/"));
    expect(acceptCall).toBeDefined();
    const [url, init] = acceptCall as [string | URL | Request, RequestInit];
    expect(String(url)).toBe("/api/v1/invites/the-raw-token/accept");
    expect(JSON.parse(init.body as string)).toEqual({ password: "CorrectHorse1!" });
    expect(init.credentials).toBe("include");
  });
});
