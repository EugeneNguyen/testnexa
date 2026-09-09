import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

/**
 * DASH-1 (ADR-0035) router-level coverage: TC-DASH-001 and TC-DASH-002.
 *
 * `/` no longer mounts a screen at all — LANDING-1's public `LandingPage`
 * (which itself replaced the scaffold-phase `ScaffoldVerificationPage`) is
 * deleted, and `/` is now the `RootRedirect` auth guard. `RootRedirect.test.tsx`
 * drives that guard's branches directly with a mocked `useAuth`; this file
 * deliberately does not mock `AuthContext` at all, so it exercises the real
 * `AuthProvider` + real router wiring — including the boot-time silent-refresh
 * cycle that makes `isInitializing` genuinely transition, which a mocked
 * `useAuth` cannot prove.
 *
 * Global `fetch` is stubbed to a 401 so the boot refresh fails, i.e. exactly
 * an unauthenticated page load: no session to restore, `accessToken` stays
 * `null`.
 */
function renderAppAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App routing", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // TC-DASH-001
  it("redirects a logged-out visitor from / to /login, rendering no landing content", async () => {
    renderAppAt("/");

    await waitFor(() => {
      // TNX-0056 (AdminLTE re-skin): the page's own "Log in" heading is gone,
      // so `BrandLogo` is the unique marker that the real `Login` screen
      // rendered. BRAND-1 (ADR-0048) replaced that atom's hardcoded "AdminLTE"
      // wordmark with the real brand lockup, so the marker is now the brand
      // link's own accessible name.
      expect(screen.getByRole("link", { name: /TestNexa home/i })).toBeInTheDocument();
    });

    // The deleted LandingPage's product-name heading and pitch CTAs must not
    // paint at any point — `/` has no content of its own anymore.
    // Anchored on purpose (BRAND-1, ADR-0048): the deleted LandingPage's own
    // heading was exactly "TestNexa". `BrandLogo`'s full lockup now renders
    // inside an `h1` whose accessible name is "TestNexa home", so an unanchored
    // /testnexa/i would match the *brand* and fail for the wrong reason. The
    // assertion's intent — "the LandingPage did not render" — is unchanged.
    expect(screen.queryByRole("heading", { name: /^testnexa$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^log in$/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("health-status")).not.toBeInTheDocument();
  });

  // TC-DASH-002: direct navigation to /dashboard while logged out, not via /.
  // Handled by the same ProtectedRoute mechanism every other protected route
  // uses, not a second bespoke guard.
  it("redirects a logged-out visitor from /dashboard directly to /login", async () => {
    renderAppAt("/dashboard");

    await waitFor(() => {
      // TNX-0056 (AdminLTE re-skin): the page's own "Log in" heading is gone,
      // so `BrandLogo` is the unique marker that the real `Login` screen
      // rendered. BRAND-1 (ADR-0048) replaced that atom's hardcoded "AdminLTE"
      // wordmark with the real brand lockup, so the marker is now the brand
      // link's own accessible name.
      expect(screen.getByRole("link", { name: /TestNexa home/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole("heading", { name: /^dashboard$/i })).not.toBeInTheDocument();
  });
});
