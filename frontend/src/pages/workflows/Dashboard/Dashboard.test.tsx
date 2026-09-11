import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";
import * as apiClient from "../../../lib/api/client";

/**
 * DASH-1 (ADR-0035) empty dashboard placeholder: TC-DASH-005.
 *
 * The load-bearing assertion here is the *negative* one — NFR-47 says this
 * screen makes no data-fetching call of any kind, and ADR-0035/the UI Design
 * Document call that a hard requirement rather than an incidental property of
 * a stub. So `apiFetch` is spied on and asserted to have recorded zero calls,
 * the same assertion shape the deleted `LandingPage.test.tsx` used to prove
 * its own (differently motivated) no-call posture.
 *
 * `Dashboard` is rendered directly rather than through `ProtectedRoute`: the
 * shell wrapper is `ProtectedRoute.test.tsx`'s subject, and mounting the real
 * `AppShell` here would drag in `OrgHome`-adjacent widgets' own fetches,
 * which would make a "zero apiFetch calls" assertion measure the wrong thing.
 */
describe("Dashboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TC-DASH-005
  it("makes zero apiFetch calls when rendered", () => {
    const apiFetchSpy = vi.spyOn(apiClient, "apiFetch");

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(apiFetchSpy).not.toHaveBeenCalled();
  });

  // TC-DASH-005's other half: "page renders as an empty placeholder from
  // static content only."
  it("renders an empty placeholder — a Dashboard heading and no widgets or data", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /^dashboard$/i })).toBeInTheDocument();
    // No stat widgets / tables / lists borrowed from OrgHome's pattern.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    // None of the deleted LandingPage's marketing CTAs were ported here.
    expect(screen.queryByRole("link", { name: /log in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign up/i })).not.toBeInTheDocument();
  });
});
