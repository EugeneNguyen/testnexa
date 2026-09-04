import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import AcceptInvite from "../../../src/pages/workflows/AcceptInvite";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/lib/api/client";

// Same partial-mock pattern as Signup.test.tsx: keep the real AuthContext
// module intact, replace `useAuth` with a `vi.fn()` so form-validation/
// submit-call tests can drive `acceptInvite()` directly without a real
// network round trip.
vi.mock("../../../src/auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/auth/AuthContext")>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

const mockUseAuth = vi.mocked(useAuth);

function mockAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  mockUseAuth.mockReturnValue({
    accessToken: null,
    orgContext: null,
    orgs: [],
    isInitializing: false,
    login: vi.fn(),
    signup: vi.fn(),
    acceptInvite: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  });
}

function renderAcceptInvite(token = "raw-invite-token") {
  return render(
    <MemoryRouter initialEntries={[`/invites/${token}/accept`]}>
      <Routes>
        <Route path="/invites/:token/accept" element={<AcceptInvite />} />
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/orgs/:orgId" element={<div>Org home</div>} />
        <Route path="/orgs/pick" element={<div>Org picker</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AcceptInvite page — mocked useAuth (form validation / submit call)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the set-password form", () => {
    mockAuth();
    renderAcceptInvite();

    expect(screen.getByRole("heading", { name: /accept your invite/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /set password/i })).toBeInTheDocument();
  });

  it("rejects a too-short password client-side, without calling acceptInvite()", async () => {
    const acceptInvite = vi.fn();
    mockAuth({ acceptInvite });
    renderAcceptInvite();

    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));

    // RHF's `zodResolver` validates asynchronously (even for an
    // all-fields-present submit) — unlike Signup.tsx's own hand-rolled,
    // synchronous slug regex check, so this needs `findByRole`, not a bare
    // `getByRole`, to observe the error after that microtask settles.
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 8 characters/i);
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  it("rejects mismatched password/confirmation client-side, without calling acceptInvite()", async () => {
    const acceptInvite = vi.fn();
    mockAuth({ acceptInvite });
    renderAcceptInvite();

    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "CorrectHorse1!" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "DifferentPassword1!" } });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/passwords (do not|don't) match/i);
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  it("calls acceptInvite() with the URL token and the entered password", async () => {
    const acceptInvite = vi.fn().mockResolvedValue(undefined);
    mockAuth({ acceptInvite });
    renderAcceptInvite("the-raw-token");

    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "CorrectHorse1!" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "CorrectHorse1!" } });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));

    await waitFor(() => expect(acceptInvite).toHaveBeenCalledTimes(1));
    expect(acceptInvite).toHaveBeenCalledWith("the-raw-token", "CorrectHorse1!");
  });

  it("shows the backend's ApiError message inline on failure (e.g. invite_not_found)", async () => {
    const acceptInvite = vi.fn().mockRejectedValue(
      new ApiError("This invite link is invalid or has expired.", 404, {
        code: "invite_not_found",
      }),
    );
    mockAuth({ acceptInvite });
    renderAcceptInvite();

    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "CorrectHorse1!" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "CorrectHorse1!" } });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));

    expect(await screen.findByText(/invite link is invalid or has expired/i)).toBeInTheDocument();
  });

  it("falls back to a generic message for a non-ApiError failure", async () => {
    const acceptInvite = vi.fn().mockRejectedValue(new Error("network exploded"));
    mockAuth({ acceptInvite });
    renderAcceptInvite();

    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "CorrectHorse1!" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "CorrectHorse1!" } });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });

  it("disables the submit button while a request is in flight", async () => {
    let resolveAccept: () => void = () => {};
    const acceptInvite = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAccept = resolve;
        }),
    );
    mockAuth({ acceptInvite });
    renderAcceptInvite();

    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "CorrectHorse1!" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "CorrectHorse1!" } });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));

    expect(await screen.findByRole("button", { name: /setting/i })).toBeDisabled();

    resolveAccept();
    await waitFor(() => expect(acceptInvite).toHaveBeenCalledTimes(1));
  });
});

// The success path — a real `acceptInvite()` call updating `AuthContext`'s
// token store / `orgContext`/`orgs` state and this page's post-success
// navigation — is covered separately in `AcceptInvite.authFlow.test.tsx`,
// which renders the REAL `AuthProvider` (not this file's mocked `useAuth`)
// against a stubbed `fetch`, mirroring `Signup.test.tsx`/
// `Signup.authFlow.test.tsx`'s own split for the exact same hoisting reason
// documented there.
