import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePermissions } from "../../src/auth/usePermissions";
import { apiFetch } from "../../src/lib/api/client";

/**
 * ADR-0025 / UI Design Document §5: `usePermissions(orgId).has(code, projectId)`
 * — an org-wide grant row (`project_id: null`) satisfies every project; a
 * project-scoped row only satisfies its own project.
 */
vi.mock("../../src/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockApiFetch = vi.mocked(apiFetch);

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("usePermissions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls GET /orgs/{org_id}/permissions/mine for the given orgId", async () => {
    mockApiFetch.mockResolvedValue({ codes: [] });
    const { result } = renderHook(() => usePermissions("org-1"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockApiFetch).toHaveBeenCalledWith("/api/v1/orgs/org-1/permissions/mine");
  });

  it("has() returns true for an org-wide grant (project_id: null), regardless of which project is asked about", async () => {
    mockApiFetch.mockResolvedValue({ codes: [{ code: "test_case.update", project_id: null }] });
    const { result } = renderHook(() => usePermissions("org-1"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.has("test_case.update")).toBe(true);
    expect(result.current.has("test_case.update", "project-a")).toBe(true);
    expect(result.current.has("test_case.update", "project-b")).toBe(true);
  });

  it("has() returns true only for its own project for a project-scoped grant", async () => {
    mockApiFetch.mockResolvedValue({ codes: [{ code: "defect.update", project_id: "project-a" }] });
    const { result } = renderHook(() => usePermissions("org-1"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.has("defect.update", "project-a")).toBe(true);
    expect(result.current.has("defect.update", "project-b")).toBe(false);
    expect(result.current.has("defect.update")).toBe(false);
  });

  it("has() returns false for a code the actor doesn't hold at all", async () => {
    mockApiFetch.mockResolvedValue({ codes: [{ code: "defect.update", project_id: "project-a" }] });
    const { result } = renderHook(() => usePermissions("org-1"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.has("defect.delete", "project-a")).toBe(false);
  });

  it("has() fails closed (false) while the query is still loading", () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePermissions("org-1"), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.has("test_case.update")).toBe(false);
  });
});
