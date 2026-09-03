import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Signup from "../../../src/pages/workflows/Signup";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/lib/api/client";

// Partial mock, same pattern as AppHeader.test.tsx/ProtectedRoute.test.tsx:
// keep the real AuthContext module intact, replace `useAuth` with a
// `vi.fn()` so form-validation/submit-call tests can drive `signup()`
// directly without a real network round trip.
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
    logout: vi.fn(),
    ...overrides,
  });
}

function renderSignup() {
  return render(
    <MemoryRouter initialEntries={["/signup"]}>
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/orgs/:orgId" element={<div>Org home</div>} />
        <Route path="/orgs/pick" element={<div>Org picker</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillForm(overrides: Partial<{ name: string; email: string; password: string; orgName: string; orgSlug: string }> = {}) {
  const values = {
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "CorrectHorseBatteryStaple!1",
    orgName: "Acme Corp",
    orgSlug: "acme-corp",
    ...overrides,
  };
  fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: values.name } });
  fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: values.email } });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: values.password } });
  fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: values.orgName } });
  fireEvent.change(screen.getByLabelText(/organization slug/i), { target: { value: values.orgSlug } });
  return values;
}

describe("Signup page — mocked useAuth (form validation / submit call)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the bootstrap signup form", () => {
    mockAuth();
    renderSignup();

    expect(screen.getByRole("heading", { name: /create your organization/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/organization name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/organization slug/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create organization/i })).toBeInTheDocument();
  });

  it("rejects a slug with uppercase/space/symbol characters client-side, without calling signup()", () => {
    const signup = vi.fn();
    mockAuth({ signup });
    renderSignup();

    fillForm({ orgSlug: "Not A Valid Slug!" });
    fireEvent.click(screen.getByRole("button", { name: /create organization/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/lowercase letters, numbers, and hyphens/i);
    expect(signup).not.toHaveBeenCalled();
  });

  it("accepts a valid lowercase-alphanumeric-hyphen slug and calls signup() with the exact payload", async () => {
    const signup = vi.fn().mockResolvedValue(undefined);
    mockAuth({ signup });
    renderSignup();

    const values = fillForm({ orgSlug: "acme-corp-123" });
    fireEvent.click(screen.getByRole("button", { name: /create organization/i }));

    await waitFor(() => expect(signup).toHaveBeenCalledTimes(1));
    expect(signup).toHaveBeenCalledWith({
      name: values.name,
      email: values.email,
      password: values.password,
      org_name: values.orgName,
      org_slug: values.orgSlug,
    });
  });

  it("shows the backend's ApiError message inline on a failed signup (e.g. signup_closed)", async () => {
    const signup = vi.fn().mockRejectedValue(
      new ApiError("Self-registration is closed. Contact your administrator for an invite.", 409, {
        code: "signup_closed",
      }),
    );
    mockAuth({ signup });
    renderSignup();

    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create organization/i }));

    expect(await screen.findByText(/self-registration is closed/i)).toBeInTheDocument();
  });

  it("falls back to a generic message for a non-ApiError failure", async () => {
    const signup = vi.fn().mockRejectedValue(new Error("network exploded"));
    mockAuth({ signup });
    renderSignup();

    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create organization/i }));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });

  it("disables the submit button while a request is in flight", async () => {
    let resolveSignup: () => void = () => {};
    const signup = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSignup = resolve;
        }),
    );
    mockAuth({ signup });
    renderSignup();

    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create organization/i }));

    expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();

    resolveSignup();
    await waitFor(() => expect(signup).toHaveBeenCalledTimes(1));
  });

  it("has a link back to /login for an existing account", () => {
    mockAuth();
    renderSignup();

    const loginLink = screen.getByRole("link", { name: /log in/i });
    expect(loginLink).toHaveAttribute("href", "/login");
  });
});

// The success path — a real `signup()` call updating `AuthContext`'s token
// store / `orgContext`/`orgs` state and `Signup.tsx`'s post-success
// `useEffect` navigating off the page — is covered separately in
// `Signup.authFlow.test.tsx`, which renders the REAL `AuthProvider` (not
// this file's mocked `useAuth`) against a stubbed `fetch`. Vitest hoists
// `vi.mock` calls to the very top of a file (same mechanism as Jest), so a
// single file can't cleanly mix a statically-mocked `useAuth` for some
// tests with the real `AuthProvider` for others — the two need separate
// module graphs, hence the separate file rather than a second `describe`
// block here.
