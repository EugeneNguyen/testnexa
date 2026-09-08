/**
 * SHELL-6 organization-switcher dropdown unit tests (ADR-0036, UI Design
 * Document §2-§4).
 *
 * Lives in `frontend/tests/` (never co-located in `src/`) and is named for
 * its own story rather than folded into the existing `AppHeader.test.tsx`,
 * matching this repo's per-story test-file convention (see
 * `frontend/CLAUDE.md`).
 *
 * Test-case coverage in this file:
 * - **TC-SHELL-016** — lazy-fetches, one call per open, no caching across opens.
 * - **TC-SHELL-017** — switching from a deeply nested route lands on the org ROOT.
 *   (Also covered end-to-end in a real browser by `e2e/tests/shell6-org-switcher.spec.ts`;
 *   this is the fast, deterministic half of that pair.)
 * - **TC-SHELL-018** (first clause only) — the org matching `:orgId` is marked
 *   current and is non-clickable. The clause about the *target* org's own
 *   permissions governing post-switch rendering is deliberately NOT claimed
 *   here — it needs a real backend with two real roles, so it lives in the
 *   e2e spec. Nothing in this file should be read as covering it.
 * - **TC-SHELL-019** — single-org account still renders the trigger.
 * - **TC-SHELL-020** — empty vs. failed-fetch states are distinct.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppHeader from "../../../src/components/organisms/app-header";
import { useAuth } from "../../../src/auth/AuthContext";
import { getMyOrgs } from "../../../src/lib/api/auth";

// Same partial-mock pattern the sibling `AppHeader.test.tsx` uses.
vi.mock("../../../src/auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/auth/AuthContext")>();
  return { ...actual, useAuth: vi.fn() };
});

// The API module is mocked (not `fetch`) so "how many calls to
// GET /auth/me/orgs" — TC-SHELL-016's actual assertion — is countable
// directly, without asserting on URL strings.
vi.mock("../../../src/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/auth")>();
  return { ...actual, getMyOrgs: vi.fn() };
});

const mockUseAuth = vi.mocked(useAuth);
const mockGetMyOrgs = vi.mocked(getMyOrgs);

const ORG_A = { id: "11111111-1111-4111-8111-111111111111", name: "Acme QA", slug: "acme-qa" };
const ORG_B = { id: "22222222-2222-4222-8222-222222222222", name: "Beta Testing Co", slug: "beta" };

/** Marker page so a navigation's landing route is observable in the DOM. */
function OrgRootMarker() {
  const { orgId } = useParams();
  return <div data-testid="org-root">org-root:{orgId}</div>;
}

function NestedMarker() {
  return <div data-testid="nested-page">nested-page</div>;
}

/**
 * Render `AppHeader` inside a real router with both a deeply nested route and
 * the org-root route registered, so a click-through navigation is exercised
 * for real rather than by asserting on a mocked `useNavigate`.
 */
function renderHeader(initialPath: string) {
  mockUseAuth.mockReturnValue({
    accessToken: "token-abc",
    orgContext: "auto",
    orgs: [],
    isInitializing: false,
    login: vi.fn(),
    signup: vi.fn(),
    acceptInvite: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  });

  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/orgs/:orgId"
          element={
            <>
              <AppHeader onToggleSidebar={vi.fn()} />
              <OrgRootMarker />
            </>
          }
        />
        <Route
          path="/orgs/:orgId/admin/:entity"
          element={
            <>
              <AppHeader onToggleSidebar={vi.fn()} />
              <NestedMarker />
            </>
          }
        />
        {/* A route with no `:orgId` at all — the negative half of the
            current-org-indication class (test-design §31). */}
        <Route path="/dashboard" element={<AppHeader onToggleSidebar={vi.fn()} />} />
      </Routes>
    </MemoryRouter>,
  );
}

function openSwitcher() {
  fireEvent.click(screen.getByTestId("org-switcher-toggle"));
}

function closeSwitcher() {
  // CoreUI's CDropdown closes on an outside click (default `autoClose`).
  fireEvent.click(document.body);
}

describe("AppHeader org switcher (SHELL-6)", () => {
  beforeEach(() => {
    mockGetMyOrgs.mockResolvedValue({ orgs: [ORG_A, ORG_B] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the trigger but issues no request before the first open", () => {
    // TC-SHELL-016, first clause: "Mount AppHeader, assert zero
    // GET /auth/me/orgs calls".
    renderHeader(`/orgs/${ORG_A.id}`);

    expect(screen.getByTestId("org-switcher-toggle")).toBeInTheDocument();
    expect(mockGetMyOrgs).not.toHaveBeenCalled();
  });

  it("fetches exactly once per open and re-fetches on a reopen, never reusing a cache", async () => {
    // TC-SHELL-016, remaining clauses: "open dropdown once, assert exactly
    // one call; close and reopen, assert a second independent call".
    renderHeader(`/orgs/${ORG_A.id}`);

    openSwitcher();
    await waitFor(() => expect(screen.getByText(ORG_B.name)).toBeInTheDocument());
    expect(mockGetMyOrgs).toHaveBeenCalledTimes(1);

    closeSwitcher();

    // The reopen resolves a DIFFERENT list. This is what makes the call a
    // demonstrably *independent* one rather than just a second invocation:
    // if the component reused the first open's cached array, ORG_B's row
    // would still be on screen after the reopen.
    mockGetMyOrgs.mockResolvedValue({ orgs: [ORG_A] });
    openSwitcher();
    await waitFor(() => expect(mockGetMyOrgs).toHaveBeenCalledTimes(2));

    await waitFor(() => expect(screen.queryByText(ORG_B.name)).not.toBeInTheDocument());
    expect(screen.getByText(ORG_A.name)).toBeInTheDocument();
  });

  it("marks the current org active and renders it as non-clickable", async () => {
    // TC-SHELL-018, first clause (current-org indication) + UI Design
    // Document §3's "not itself clickable".
    renderHeader(`/orgs/${ORG_A.id}`);
    openSwitcher();

    const currentItem = await screen.findByTestId(`org-switcher-item-${ORG_A.id}`);
    const otherItem = screen.getByTestId(`org-switcher-item-${ORG_B.id}`);

    expect(currentItem).toHaveClass("active");
    expect(currentItem).toHaveClass("disabled");
    expect(otherItem).not.toHaveClass("active");
    expect(otherItem).not.toHaveClass("disabled");
  });

  it("navigates to the target org's ROOT when switching from a deeply nested route", async () => {
    // TC-SHELL-017 word-for-word: start on `/orgs/:orgId/admin/:entity`
    // (the TC's own `/orgs/:orgId/admin/roles` example), switch, and land on
    // `/orgs/{newOrgId}` — NOT `/orgs/{newOrgId}/admin/roles`.
    renderHeader(`/orgs/${ORG_A.id}/admin/roles`);
    expect(screen.getByTestId("nested-page")).toBeInTheDocument();

    openSwitcher();
    const targetItem = await screen.findByTestId(`org-switcher-item-${ORG_B.id}`);
    fireEvent.click(targetItem);

    // The org-root route rendered, carrying the NEW org's id — which also
    // proves the nested `/admin/roles` segment was not reconstructed, since
    // that path would have matched the nested route instead.
    const landed = await screen.findByTestId("org-root");
    expect(landed).toHaveTextContent(`org-root:${ORG_B.id}`);
    expect(screen.queryByTestId("nested-page")).not.toBeInTheDocument();
  });

  it("still renders the trigger and one current, non-clickable row for a single-org account", async () => {
    // TC-SHELL-019.
    mockGetMyOrgs.mockResolvedValue({ orgs: [ORG_A] });
    renderHeader(`/orgs/${ORG_A.id}`);

    const toggle = screen.getByTestId("org-switcher-toggle");
    expect(toggle).toBeInTheDocument();
    expect(toggle).not.toBeDisabled();

    openSwitcher();
    const onlyItem = await screen.findByTestId(`org-switcher-item-${ORG_A.id}`);
    expect(onlyItem).toHaveClass("active");
    expect(onlyItem).toHaveClass("disabled");
  });

  it("shows a distinct 'No organizations' row when the list is empty", async () => {
    // TC-SHELL-020 case (a).
    mockGetMyOrgs.mockResolvedValue({ orgs: [] });
    renderHeader(`/orgs/${ORG_A.id}`);
    openSwitcher();

    expect(await screen.findByTestId("org-switcher-empty")).toHaveTextContent("No organizations");
    expect(screen.queryByTestId("org-switcher-error")).not.toBeInTheDocument();
  });

  it("shows a distinct \"Couldn't load organizations\" row when the fetch fails", async () => {
    // TC-SHELL-020 case (b) — and specifically that a failure never renders
    // as the empty state, which would be a false "you have no orgs".
    mockGetMyOrgs.mockRejectedValue(new Error("network down"));
    renderHeader(`/orgs/${ORG_A.id}`);
    openSwitcher();

    expect(await screen.findByTestId("org-switcher-error")).toHaveTextContent(
      "Couldn't load organizations",
    );
    expect(screen.queryByTestId("org-switcher-empty")).not.toBeInTheDocument();
  });

  it("marks no org as current on a route that has no :orgId param", async () => {
    // Test-design §31's current-org class, negative half: "on a route with
    // no `:orgId` (e.g. `/dashboard`), no org is marked current."
    renderHeader("/dashboard");
    openSwitcher();

    const itemA = await screen.findByTestId(`org-switcher-item-${ORG_A.id}`);
    const itemB = screen.getByTestId(`org-switcher-item-${ORG_B.id}`);

    // Both orgs still listed and both still switchable — nothing is
    // "current", rather than an arbitrary row being highlighted.
    expect(itemA).not.toHaveClass("active");
    expect(itemB).not.toHaveClass("active");
    expect(itemA).not.toHaveClass("disabled");
    expect(itemB).not.toHaveClass("disabled");
  });
});
