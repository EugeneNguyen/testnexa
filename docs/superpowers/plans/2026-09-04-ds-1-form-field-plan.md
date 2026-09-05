# DS-1: Reusable FormField Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single reusable `FormField` component (CoreUI `CFormLabel` + `CFormInput` + `CFormFeedback`, RHF-bound) and migrate `Login.tsx`'s 2 and `Signup.tsx`'s 5 hand-authored label+input blocks onto it, with no regression in existing Vitest/Playwright assertions.

**Architecture:** `FormField` is a small presentational wrapper that owns the `<div class="mb-3">` + `CFormLabel`/`CFormInput`/`CFormFeedback` markup and accepts RHF's `register()` return object spread as rest props, plus a plain `error?: string` message. Login/Signup, which today are `useState`-driven with zero RHF/Zod wiring, are migrated onto React Hook Form + Zod (the codebase's established pattern in `OrgHome.tsx`/`AcceptInvite.tsx`/`OrgMembers.tsx`) as part of this same change, since that's the only way to have a `register`/`errors` object for `FormField` to bind to.

**Tech Stack:** React + TypeScript, CoreUI for React (`@coreui/react` ^5.13.0), React Hook Form ^7.53.0 + `@hookform/resolvers/zod` ^3.9.0 + Zod ^3.23.8 — all already installed, no new dependency.

**Spec:** `docs/user-stories/2026-09-04-design-system-component-stories.md` (Story DS-1)

## Global Constraints

- CoreUI is the design system (ADR-0012) — no Tailwind classes.
- React Hook Form + Zod own form state/validation (ADR-0009, unchanged by ADR-0012).
- No path aliases exist in this codebase (`frontend/tsconfig.json` has no `paths`) — use relative imports.
- No `Controller` usage anywhere in this codebase — RHF binding is always `register()` spread. `FormField` follows this; it does not support a `control`+`name` Controller-style API.
- `htmlFor`/`id` pairing and existing visible label/button text must not change — Vitest (`Signup.test.tsx`, `Signup.authFlow.test.tsx`) and Playwright (`auth-login.spec.ts`, `auth-signup.spec.ts`) both select fields via `getByLabelText`/`getByLabel`, not `data-testid`.

---

## Open questions (assumptions below — confirm or adjust)

1. **Component location:** `frontend/src/components/shared/FormField.tsx`. The story (line 9) flags a `components/shared/` vs `components/crud/` vs page-local naming ADR as a "prerequisite... should be written before or alongside implementation," but AC4 accepts a file-level doc comment as the alternative to an ADR. This plan uses the doc-comment route (no new ADR) to keep scope to what DS-1 actually asks for. *Assumption — confirm the location and the no-ADR call.*
2. **Login/Signup migrate onto RHF+Zod as part of this story**, not just a markup swap — they currently have zero RHF wiring (plain `useState`). AC3 requires migrating them to use `FormField`, and `FormField`'s error prop only means anything bound to RHF `formState.errors`. *Assumption — confirm this larger surface is in scope, not deferred.*
3. **Error-display convention:** the codebase currently has two inconsistent patterns — `CFormFeedback`+`invalid` per-field (`OrgHome.tsx:279-280`) vs. a single page-level `CAlert` (`AcceptInvite.tsx`, `Signup.tsx`, `Login.tsx`, `OrgMembers.tsx`). `FormField` standardizes on `CFormFeedback`+`invalid` per AC2's explicit wording. Non-field errors (API/network failures on submit) stay as the existing page-level `CAlert`, unchanged. *Assumption — confirm.*
4. **`FormField` API:**
   ```ts
   interface FormFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> {
     id: string;
     label: string;
     type?: string;      // default "text"
     error?: string;     // plain message, per AC1's "optional error message passthrough"
   }
   ```
   Callers spread `register("field")` onto it directly: `<FormField id="email" label="Email" type="email" error={errors.email?.message} {...register("email")} />`. *Confirm this shape vs. any alternative (e.g. a `register` prop wrapping object) — rest-prop spread matches existing `OrgHome.tsx`/`AcceptInvite.tsx` convention exactly.*
5. **Helper text (non-error) stays outside `FormField`:** `Signup.tsx`'s `orgSlug` field has a `CFormText` hint ("Lowercase letters, numbers, and hyphens only.") that isn't an error. `FormField`'s scope is label+input+error only (per AC5's narrow-scope framing), so the caller renders `CFormText` as a sibling after `<FormField>`, not as a `FormField` prop. *Confirm.*
6. **No `Login.test.tsx` exists today** (only `Signup.test.tsx`/`Signup.authFlow.test.tsx`). AC3 says "existing Vitest coverage... still passes" — for Login that set is empty, so nothing there can regress; Playwright's `auth-login.spec.ts` is the only regression guard for that screen. This plan does **not** add a new `Login.test.tsx` (out of the story's literal scope), relying on the pre-existing Playwright coverage. *Flag only — recommend adding one anyway for parity/safety net; your call whether to fold into this story or leave as a follow-up.*

---

## File Structure

- Create: `frontend/src/components/shared/FormField.tsx` — the component.
- Create: `frontend/tests/components/shared/FormField.test.tsx` — unit tests.
- Modify: `frontend/src/pages/workflows/Login.tsx` — RHF+Zod migration, 2 fields onto `FormField`.
- Modify: `frontend/src/pages/workflows/Signup.tsx` — RHF+Zod migration, 5 fields onto `FormField`.
- No changes to: `frontend/tests/pages/workflows/Signup.test.tsx`, `Signup.authFlow.test.tsx`, `e2e/tests/auth-login.spec.ts`, `e2e/tests/auth-signup.spec.ts` — AC3 requires their assertions pass **unmodified**.

---

## Task 1: `FormField` component

**Files:**
- Create: `frontend/src/components/shared/FormField.tsx`
- Test: `frontend/tests/components/shared/FormField.test.tsx`

**Interfaces:**
- Produces: `FormField` (default export), a `forwardRef<HTMLInputElement, FormFieldProps>` component. `FormFieldProps` per open question 4 above.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/components/shared/FormField.test.tsx
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FormField from "../../../src/components/shared/FormField";

describe("FormField", () => {
  it("pairs the label to the input via htmlFor/id", () => {
    render(<FormField id="email" label="Email" type="email" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("id", "email");
    expect(input).toHaveAttribute("type", "email");
  });

  it("defaults to type=text", () => {
    render(<FormField id="name" label="Name" />);
    expect(screen.getByLabelText("Name")).toHaveAttribute("type", "text");
  });

  it("renders no CFormFeedback and invalid=false when no error is passed", () => {
    render(<FormField id="email" label="Email" />);
    expect(screen.getByLabelText("Email")).not.toHaveClass("is-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces an error via CFormFeedback and marks the input invalid", () => {
    render(<FormField id="email" label="Email" error="Email is required." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveClass("is-invalid");
    expect(screen.getByText("Email is required.")).toBeInTheDocument();
  });

  it("forwards a ref to the underlying input (RHF register() compatibility)", () => {
    const ref = createRef<HTMLInputElement>();
    render(<FormField id="email" label="Email" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current?.id).toBe("email");
  });

  it("spreads rest props (RHF register() onChange/onBlur/name) onto the input", () => {
    render(<FormField id="email" label="Email" name="email" data-testid="email-input" />);
    expect(screen.getByTestId("email-input")).toHaveAttribute("name", "email");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/components/shared/FormField.test.tsx`
Expected: FAIL — `Failed to resolve import "../../../src/components/shared/FormField"`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/components/shared/FormField.tsx
/**
 * Shared form-field primitive (DS-1): a labeled CoreUI text/email/password
 * input bound to a React Hook Form field, with Zod-driven error feedback.
 *
 * Location/reuse scope: `frontend/src/components/shared/` holds cross-screen
 * UI building blocks with duplication evidence behind them (per the DS-1
 * story) — as opposed to `components/crud/` (generic entity CRUD widgets)
 * or page-local components under `pages/*/`. `FormField` is the only
 * component here today; don't add checkbox/select/radio variants or an
 * atoms/molecules/organisms tier without new duplication evidence (see
 * docs/user-stories/2026-09-04-design-system-component-stories.md).
 *
 * Composes CFormLabel + CFormInput + CFormFeedback (ADR-0012) and expects
 * to be bound via React Hook Form's `register()` return value spread as
 * rest props — this codebase never uses RHF's `Controller`, only
 * `register()` spread (see OrgHome.tsx/AcceptInvite.tsx), so this
 * component doesn't support a Controller-style API. `error` is a plain
 * message string (typically `errors.<field>?.message` from a Zod
 * resolver), not a FieldError object.
 */
import { forwardRef, InputHTMLAttributes } from "react";
import { CFormFeedback, CFormInput, CFormLabel } from "@coreui/react";

export interface FormFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> {
  id: string;
  label: string;
  type?: string;
  error?: string;
}

const FormField = forwardRef<HTMLInputElement, FormFieldProps>(function FormField(
  { id, label, type = "text", error, ...rest },
  ref,
) {
  return (
    <div className="mb-3">
      <CFormLabel htmlFor={id}>{label}</CFormLabel>
      <CFormInput id={id} type={type} invalid={Boolean(error)} ref={ref} {...rest} />
      {error && <CFormFeedback invalid>{error}</CFormFeedback>}
    </div>
  );
});

export default FormField;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/components/shared/FormField.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shared/FormField.tsx frontend/tests/components/shared/FormField.test.tsx
git commit -m "feat(ds-1): add reusable FormField component"
```

---

## Task 2: Migrate `Login.tsx` onto RHF + Zod + `FormField`

**Files:**
- Modify: `frontend/src/pages/workflows/Login.tsx` (full rewrite of the two field blocks, lines 69–90, plus the `useState`/`handleSubmit` wiring, lines 34–58)

**Interfaces:**
- Consumes: `FormField` from Task 1 (`../../components/shared/FormField`), props `{ id, label, type?, error?, ...register() }`.

- [ ] **Step 1: Write/extend the failing test**

No `Login.test.tsx` exists (open question 6). Skip a new Vitest file per that assumption; rely on the existing `e2e/tests/auth-login.spec.ts` as the regression check (run in Task 4). If you'd rather have a unit safety net, mirror `Signup.test.tsx`'s structure — flag this choice back before adding it, since it's extra scope beyond AC3's literal wording.

- [ ] **Step 2: Write the implementation**

```tsx
// frontend/src/pages/workflows/Login.tsx
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CAlert, CButton, CCard, CCardBody, CCol, CContainer, CForm, CRow } from "@coreui/react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/api/client";
import FormField from "../../components/shared/FormField";

const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required."),
  password: z.string().min(1, "Password is required."),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function Login() {
  const { login, orgContext, orgs } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  useEffect(() => {
    if (orgContext === "auto" && orgs.length > 0) {
      navigate(`/orgs/${orgs[0].id}`, { replace: true });
    } else if (orgContext === "picker") {
      navigate("/orgs/pick", { replace: true });
    }
  }, [orgContext, orgs, navigate]);

  async function onSubmit(values: LoginFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await login(values.email, values.password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-vh-100 d-flex align-items-center bg-body-secondary">
      <CContainer>
        <CRow className="justify-content-center">
          <CCol md={6} lg={4}>
            <CCard>
              <CCardBody className="p-4">
                <h1 className="mb-4 fs-4">Log in</h1>
                <CForm noValidate onSubmit={(event) => { void handleSubmit(onSubmit)(event); }}>
                  <FormField
                    id="email"
                    label="Email"
                    type="email"
                    autoComplete="email"
                    error={errors.email?.message}
                    {...register("email")}
                  />
                  <FormField
                    id="password"
                    label="Password"
                    type="password"
                    autoComplete="current-password"
                    error={errors.password?.message}
                    {...register("password")}
                  />
                  {error && (
                    <CAlert color="danger" role="alert">
                      {error}
                    </CAlert>
                  )}
                  <CButton type="submit" color="primary" disabled={submitting} className="w-100">
                    {submitting ? "Logging in..." : "Log in"}
                  </CButton>
                </CForm>
                <p className="mt-3 mb-0 text-body-secondary small">
                  New to TestNexa? <Link to="/signup">Sign up</Link>
                </p>
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>
      </CContainer>
    </div>
  );
}

export default Login;
```

Update the file's top doc comment (lines 1–13) to note the RHF+Zod migration, matching how `OrgHome.tsx`'s doc comment documents its own form wiring.

- [ ] **Step 3: Run affected tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: PASS, no Login-specific regressions (none existed to regress); Signup suite untouched at this point still passes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/workflows/Login.tsx
git commit -m "refactor(ds-1): migrate Login.tsx onto RHF+Zod and FormField"
```

---

## Task 3: Migrate `Signup.tsx` onto RHF + Zod + `FormField`

**Files:**
- Modify: `frontend/src/pages/workflows/Signup.tsx` (field blocks lines 87–139, `useState`/`handleSubmit` wiring lines 43–76)

**Interfaces:**
- Consumes: `FormField` from Task 1, same as Task 2.

- [ ] **Step 1: Confirm existing tests still describe the target behavior**

Re-read `frontend/tests/pages/workflows/Signup.test.tsx` and `Signup.authFlow.test.tsx` (already read during planning — no changes needed there). Key constraint: the slug-format check currently happens in `handleSubmit` and blocks `signup()` from being called (test at `Signup.test.tsx:84-94`) — this must be reproduced as a Zod `.refine()` on `orgSlug` so `signup` still isn't called for a bad slug, and the alert text must still match `/lowercase letters, numbers, and hyphens/i`.

- [ ] **Step 2: Write the implementation**

```tsx
// frontend/src/pages/workflows/Signup.tsx
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CAlert, CButton, CCard, CCardBody, CCol, CContainer, CForm, CFormText, CRow } from "@coreui/react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/api/client";
import FormField from "../../components/shared/FormField";

const SLUG_PATTERN = /^[a-z0-9-]+$/;

const signupSchema = z.object({
  name: z.string().trim().min(1, "Your name is required."),
  email: z.string().trim().min(1, "Email is required."),
  password: z.string().min(1, "Password is required."),
  orgName: z.string().trim().min(1, "Organization name is required."),
  orgSlug: z
    .string()
    .trim()
    .min(1, "Organization slug is required.")
    .regex(SLUG_PATTERN, "Organization slug may only contain lowercase letters, numbers, and hyphens."),
});

type SignupFormValues = z.infer<typeof signupSchema>;

function Signup() {
  const { signup, orgContext, orgs } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupFormValues>({ resolver: zodResolver(signupSchema) });

  useEffect(() => {
    if (orgContext === "auto" && orgs.length > 0) {
      navigate(`/orgs/${orgs[0].id}`, { replace: true });
    } else if (orgContext === "picker") {
      navigate("/orgs/pick", { replace: true });
    }
  }, [orgContext, orgs, navigate]);

  async function onSubmit(values: SignupFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await signup({
        name: values.name,
        email: values.email,
        password: values.password,
        org_name: values.orgName,
        org_slug: values.orgSlug,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-vh-100 d-flex align-items-center bg-body-secondary">
      <CContainer>
        <CRow className="justify-content-center">
          <CCol md={7} lg={5}>
            <CCard>
              <CCardBody className="p-4">
                <h1 className="mb-4 fs-4">Create your organization</h1>
                <CForm noValidate onSubmit={(event) => { void handleSubmit(onSubmit)(event); }}>
                  <FormField
                    id="name"
                    label="Your name"
                    autoComplete="name"
                    error={errors.name?.message}
                    {...register("name")}
                  />
                  <FormField
                    id="email"
                    label="Email"
                    type="email"
                    autoComplete="email"
                    error={errors.email?.message}
                    {...register("email")}
                  />
                  <FormField
                    id="password"
                    label="Password"
                    type="password"
                    autoComplete="new-password"
                    error={errors.password?.message}
                    {...register("password")}
                  />
                  <FormField
                    id="orgName"
                    label="Organization name"
                    error={errors.orgName?.message}
                    {...register("orgName")}
                  />
                  <div>
                    <FormField
                      id="orgSlug"
                      label="Organization slug"
                      error={errors.orgSlug?.message}
                      {...register("orgSlug")}
                    />
                    <CFormText>Lowercase letters, numbers, and hyphens only.</CFormText>
                  </div>
                  {error && (
                    <CAlert color="danger" role="alert">
                      {error}
                    </CAlert>
                  )}
                  <CButton type="submit" color="primary" disabled={submitting} className="w-100">
                    {submitting ? "Creating..." : "Create organization"}
                  </CButton>
                </CForm>
                <p className="mt-3 mb-0 text-body-secondary small">
                  Already have an account? <Link to="/login">Log in</Link>
                </p>
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>
      </CContainer>
    </div>
  );
}

export default Signup;
```

Note: `FormField` already renders its own `<div className="mb-3">` wrapper, so the `orgSlug` field's outer `<div>` (to keep `CFormText` grouped under it) does not repeat `className="mb-3"` — the spacing after that block comes from `FormField`'s own wrapper margin already being applied to the field above it inside the same outer div. Verify visually (Task 4) that this doesn't introduce a double- or missing-margin gap versus the original.

Update the file's top doc comment (lines 1–19) to note the RHF+Zod migration and that `orgSlug`'s regex validation moved from `handleSubmit` into the Zod schema.

- [ ] **Step 3: Run the existing Signup test suites — they must pass unmodified**

Run: `cd frontend && npx tsc --noEmit && npx vitest run tests/pages/workflows/Signup.test.tsx tests/pages/workflows/Signup.authFlow.test.tsx`
Expected: PASS, all existing assertions (label text, alert text, `signup()` payload shape, disabled/loading button, `/login` link) unchanged.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/workflows/Signup.tsx
git commit -m "refactor(ds-1): migrate Signup.tsx onto RHF+Zod and FormField"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full Vitest run**

Run: `cd frontend && npx vitest run`
Expected: PASS, including `FormField.test.tsx` (new) and `Signup.test.tsx`/`Signup.authFlow.test.tsx` (unmodified assertions, per AC3).

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Playwright e2e — login and signup specs**

Bring up an isolated test stack per CLAUDE.md's Docker guidance (new `-p` project name, random port — do not touch the main `testnexa` compose project), then:

Run: `cd e2e && E2E_BASE_URL=<isolated-stack-url> npx playwright test tests/auth-login.spec.ts tests/auth-signup.spec.ts`
Expected: PASS, assertions unmodified (redirect to `/orgs/{uuid}`, `/invalid email or password/i`, `/self-registration is closed/i` or `/^Org: /i`).

- [ ] **Step 4: Visual spot-check**

Run the dev stack, open `/login` and `/signup`, compare spacing/label/error rendering against the pre-migration screenshots (or just eyeball against `git show HEAD~3:frontend/src/pages/workflows/Signup.tsx` rendered) — confirms AC1's "no visual... regression" beyond what automated tests cover.

- [ ] **Step 5: Commit (if step 4 required fixes) or tag done**

```bash
git add -A
git commit -m "chore(ds-1): verification pass" --allow-empty
```

---

## Self-review notes

- **Spec coverage:** AC1 (markup/a11y parity) → Task 1 tests + Tasks 2/3 migration. AC2 (`CFormFeedback`/invalid styling) → Task 1 `FormField` implementation. AC3 (existing tests/e2e pass unmodified) → Tasks 2/3/4. AC4 (location/reuse-scope note) → `FormField.tsx`'s file-level doc comment (Task 1). AC5 (no checkbox/select/radio, no molecules/organisms tier, no second component) → not present anywhere in this plan by construction.
- **Placeholder scan:** none — every step has real code/commands.
- **Type consistency:** `FormFieldProps` (Task 1) matches every call site's usage in Tasks 2/3 (`id`, `label`, `type?`, `error?`, plus RHF's `register()` rest props: `name`, `onChange`, `onBlur`, `ref`).
