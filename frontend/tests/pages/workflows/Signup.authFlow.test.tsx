import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Signup from "../../../src/pages/workflows/Signup";
import { AuthProvider } from "../../../src/auth/AuthContext";
import { clearAccessToken, getAccessToken } from "../../../src/lib/auth/tokenStore";

/**
 * RBAC-1: the signup success path, exercised against the REAL
 * `AuthContext.signup()` -> `lib/api/auth.signup()` -> `apiFetch()` chain
 * with a stubbed `fetch`, mirroring `tests/auth/AuthContext.test.tsx`'s own
 * convention. This proves state actually lands in the token store /
 * `orgContext`/`orgs` and that `Signup.tsx`'s post-success `useEffect`
 * (watching those exact fields) navigates correctly — a mocked `useAuth`
 * (`Signup.test.tsx`, this directory) can't prove that wiring end to end
 * since it never re-renders with updated state after `signup()` resolves.
 *
 * Deliberately its own file, not a second `describe` block in
 * `Signup.test.tsx`: that file's `vi.mock("../../../src/auth/AuthContext",
 * ...)` is hoisted to the top of its module by Vitest (same hoisting
 * Jest applies to `jest.mock`), so every static import of `AuthContext` in
 * that file — including `Signup.tsx`'s own internal `useAuth()` call, which
 * resolves against the same mocked module graph — would still be mocked
 * even after a later `vi.unmock` call in the same file; `vi.unmock` is not
 * hoisted, so it can't undo bindings the hoisted `vi.mock` already
 * rewrote before this file's `import` statements ever ran. A separate file
 * with no `vi.mock` call at all is the reliable way to get the real
 * `AuthProvider`/`useAuth` here.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Signup page — real AuthProvider (success path updates auth state and navigates)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAccessToken();
  });

  it("stores the access token, resolves org_context/orgs, and redirects to the new org's view", async () => {
    const newOrg = { id: "11111111-1111-1111-1111-111111111111", name: "Acme Corp", slug: "acme-corp" };
    // A fresh `Response` per call, not a single shared `mockResolvedValue`
    // instance — a `Response` body can only be read (`.json()`) once, and
    // the boot-time refresh call consumes the first one before this test's
    // own signup submission ever runs.
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          {
            access_token: "signup-issued-access-token",
            org_context: "auto",
            orgs: [newOrg],
          },
          201,
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={["/signup"]}>
        <AuthProvider>
          <Routes>
            <Route path="/signup" element={<Signup />} />
            <Route path={`/orgs/${newOrg.id}`} element={<div>Landed on the new org</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    // Real AuthProvider mounts with a boot-time silent refresh in flight
    // (AuthContext.tsx) — the first fetch call is that refresh attempt, and
    // it must settle (this stub resolves it with a 201 shape too, which is
    // fine — the boot refresh only reads `access_token` off it, and any
    // failure there is swallowed by AuthContext's own boot-refresh
    // try/catch) before this test's own signup submission is the "real"
    // second call.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: "Ada Lovelace" } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "CorrectHorseBatteryStaple!1" },
    });
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: newOrg.name } });
    fireEvent.change(screen.getByLabelText(/organization slug/i), { target: { value: newOrg.slug } });
    fireEvent.click(screen.getByRole("button", { name: /create organization/i }));

    await screen.findByText(/landed on the new org/i);

    expect(getAccessToken()).toBe("signup-issued-access-token");

    const signupCall = fetchMock.mock.calls.find(([url]: [string]) => url.includes("/auth/signup"));
    expect(signupCall).toBeDefined();
    const [, init] = signupCall as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "CorrectHorseBatteryStaple!1",
      org_name: newOrg.name,
      org_slug: newOrg.slug,
    });
  });
});
