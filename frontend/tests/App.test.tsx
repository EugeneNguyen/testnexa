import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

/**
 * LANDING-1 (ADR-0024): `/` now mounts the real public `LandingPage`
 * (previously `ScaffoldVerificationPage`, a `GET /api/health` wiring-proof
 * widget, deleted outright — see `LandingPage.tsx`'s own docstring). `App`
 * wraps everything in the real `AuthProvider`, which fires a boot-time
 * silent-refresh call on mount (`AuthContext.tsx`) — this test stubs global
 * `fetch` to reject it (no session), same as an unauthenticated page load,
 * so `orgContext`/`orgs` stay `null`/`[]` and the landing content renders
 * instead of redirecting off `/`.
 */
function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the public LandingPage at / for a logged-out visitor", async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /testnexa/i })).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: /log in/i })).toHaveAttribute("href", "/login");
    expect(screen.queryByTestId("health-status")).not.toBeInTheDocument();
  });
});
