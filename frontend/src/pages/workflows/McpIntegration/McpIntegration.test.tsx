import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import McpIntegration from "./McpIntegration";
import { AgentSummary, createAgent, listAgents, revokeAgent } from "../../../lib/api/agents";
import { me } from "../../../lib/api/auth";
import { ApiError } from "../../../lib/api/client";
import { OrgMember, listMembers } from "../../../lib/api/members";
import { getProject } from "../../../lib/api/projects";

// Same partial-mock pattern as `OrgMembers.test.tsx`/`app-sidebar.test.tsx`:
// mock only the functions the component under test calls.
vi.mock("../../../lib/api/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/agents")>();
  return { ...actual, listAgents: vi.fn(), createAgent: vi.fn(), revokeAgent: vi.fn() };
});
vi.mock("../../../lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/auth")>();
  return { ...actual, me: vi.fn() };
});
vi.mock("../../../lib/api/members", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/members")>();
  return { ...actual, listMembers: vi.fn() };
});
vi.mock("../../../lib/api/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/projects")>();
  return { ...actual, getProject: vi.fn() };
});

const mockListAgents = vi.mocked(listAgents);
const mockCreateAgent = vi.mocked(createAgent);
const mockRevokeAgent = vi.mocked(revokeAgent);
const mockMe = vi.mocked(me);
const mockListMembers = vi.mocked(listMembers);
const mockGetProject = vi.mocked(getProject);

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";

// The logged-in user, distinct from ACTIVE_MEMBER below — lets the
// "picker defaults to self" behavior be checked against a real "someone
// else" option, not the only member in the list.
const SELF = { actor_id: "u-self", email: "self@example.com", actor_type: "user" };

const ACTIVE_MEMBER: OrgMember = {
  membership_id: "m-active",
  user_id: "u-active",
  email: "active@example.com",
  status: "active",
  joined_at: "2026-01-15T10:00:00Z",
};

const ACTIVE_AGENT: AgentSummary = {
  agent_id: "a-active",
  agent_name: "Active Agent",
  model_or_provider: "anthropic/claude",
  key_prefix: "abcdef12",
  acting_on_behalf_of_user_id: "u-active",
  issued_at: "2026-01-16T10:00:00Z",
  revoked_at: null,
  last_used_at: null,
};

const REVOKED_AGENT: AgentSummary = {
  ...ACTIVE_AGENT,
  agent_id: "a-revoked",
  agent_name: "Revoked Agent",
  revoked_at: "2026-01-17T10:00:00Z",
};

function agentsPage(items: AgentSummary[]) {
  return { items, total: items.length, page: 1, page_size: 25 };
}

function membersPage(items: OrgMember[]) {
  return { items, total: items.length, page: 1, page_size: 100 };
}

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderAtOrgRoute() {
  return render(
    <QueryClientProvider client={newQueryClient()}>
      <MemoryRouter initialEntries={[`/orgs/${ORG_ID}/mcp`]}>
        <Routes>
          <Route path="/orgs/:orgId/mcp" element={<McpIntegration />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderAtProjectRoute() {
  return render(
    <QueryClientProvider client={newQueryClient()}>
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/mcp`]}>
        <Routes>
          <Route path="/projects/:projectId/mcp" element={<McpIntegration />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("McpIntegration page", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("explains MCP and renders connect-a-client snippets for Claude Code, Codex, Cursor, and generic clients", async () => {
    mockListAgents.mockResolvedValue(agentsPage([]));
    mockMe.mockResolvedValue(SELF);
    mockListMembers.mockResolvedValue(membersPage([]));

    renderAtOrgRoute();

    expect(screen.getByRole("heading", { name: "MCP Integration" })).toBeInTheDocument();
    expect(screen.getByText(/Model Context Protocol/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Claude Code" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Codex CLI" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cursor" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Any other MCP client" })).toBeInTheDocument();

    const url = `${window.location.origin}/mcp`;
    expect(screen.getByText(new RegExp(`claude mcp add --transport http testnexa ${url}`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`bearer_token_env_var`))).toBeInTheDocument();

    await waitFor(() => expect(mockListAgents).toHaveBeenCalledWith(ORG_ID));
  });

  it("org mode: shows loading, then the agent-key table with active and revoked rows", async () => {
    mockListAgents.mockResolvedValue(agentsPage([ACTIVE_AGENT, REVOKED_AGENT]));
    mockMe.mockResolvedValue(SELF);
    mockListMembers.mockResolvedValue(membersPage([ACTIVE_MEMBER]));

    renderAtOrgRoute();

    expect(screen.getByText("Loading API keys...")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Active Agent")).toBeInTheDocument());
    expect(screen.getByText("Revoked Agent")).toBeInTheDocument();

    const panel = screen.getByTestId("mcp-agent-key-management");
    const activeRow = within(panel).getByText("Active Agent").closest("tr")!;
    expect(within(activeRow).getByText("Active")).toHaveClass("bg-success");
    expect(within(activeRow).getByRole("button", { name: "Revoke" })).toBeInTheDocument();
    expect(within(activeRow).getByText("active@example.com")).toBeInTheDocument();

    const revokedRow = within(panel).getByText("Revoked Agent").closest("tr")!;
    expect(within(revokedRow).getByText("Revoked")).toHaveClass("bg-secondary");
    expect(within(revokedRow).queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("org mode: issuing a key shows the raw key exactly once and refreshes the list", async () => {
    mockListAgents.mockResolvedValueOnce(agentsPage([])).mockResolvedValueOnce(agentsPage([ACTIVE_AGENT]));
    mockMe.mockResolvedValue(SELF);
    mockListMembers.mockResolvedValue(membersPage([ACTIVE_MEMBER]));
    mockCreateAgent.mockResolvedValue({
      agent_id: "a-active",
      agent_name: "Active Agent",
      api_key: "tnx_agent_abcdef12_secret",
      key_prefix: "abcdef12",
    });

    renderAtOrgRoute();

    await waitFor(() => expect(screen.getByText("No API keys issued yet.")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "Active Agent" } });
    fireEvent.change(screen.getByLabelText("Acting on behalf of"), { target: { value: "u-active" } });
    fireEvent.click(screen.getByRole("button", { name: "Issue key" }));

    await waitFor(() =>
      expect(mockCreateAgent).toHaveBeenCalledWith(ORG_ID, {
        agent_name: "Active Agent",
        model_or_provider: undefined,
        acting_on_behalf_of_user_id: "u-active",
      }),
    );

    expect(await screen.findByDisplayValue("tnx_agent_abcdef12_secret")).toBeInTheDocument();
    await waitFor(() => expect(mockListAgents).toHaveBeenCalledTimes(2));
  });

  it("org mode: revoking an active agent calls the API and refreshes the list", async () => {
    mockListAgents
      .mockResolvedValueOnce(agentsPage([ACTIVE_AGENT]))
      .mockResolvedValueOnce(agentsPage([{ ...ACTIVE_AGENT, revoked_at: "2026-01-18T00:00:00Z" }]));
    mockMe.mockResolvedValue(SELF);
    mockListMembers.mockResolvedValue(membersPage([ACTIVE_MEMBER]));
    mockRevokeAgent.mockResolvedValue({ agent_id: "a-active", revoked_at: "2026-01-18T00:00:00Z" });

    renderAtOrgRoute();

    await waitFor(() => expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(mockRevokeAgent).toHaveBeenCalledWith(ORG_ID, "a-active"));
    await waitFor(() => expect(mockListAgents).toHaveBeenCalledTimes(2));
  });

  it("org mode: the picker defaults to the logged-in user, not blank", async () => {
    mockListAgents.mockResolvedValue(agentsPage([]));
    mockMe.mockResolvedValue(SELF);
    // Real-world shape: the caller is always themselves an active member of
    // the org whose credentials they're managing (NFR-1's own boundary
    // requires it) — the fixture includes SELF alongside another member so
    // "defaults to self" is checked against a real, present alternative,
    // not the only option in the list.
    mockListMembers.mockResolvedValue(
      membersPage([ACTIVE_MEMBER, { ...ACTIVE_MEMBER, membership_id: "m-self", user_id: SELF.actor_id, email: SELF.email }]),
    );

    renderAtOrgRoute();

    await waitFor(() => expect(screen.getByText("No API keys issued yet.")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("Acting on behalf of")).toHaveValue(SELF.actor_id));
  });

  it("non-admin (no org_membership.read): no picker, always self, key issues correctly", async () => {
    mockListAgents.mockResolvedValueOnce(agentsPage([])).mockResolvedValueOnce(agentsPage([ACTIVE_AGENT]));
    mockMe.mockResolvedValue(SELF);
    // 403 permission_denied — this member holds `ai_agent.create` (or the
    // panel wouldn't have loaded at all) but not `org_membership.read`.
    mockListMembers.mockRejectedValue(
      new ApiError("You do not have permission to perform this action.", 403, {
        code: "permission_denied",
        message: "You do not have permission to perform this action.",
        field_errors: null,
      }),
    );
    mockCreateAgent.mockResolvedValue({
      agent_id: "a-active",
      agent_name: "Active Agent",
      api_key: "tnx_agent_abcdef12_secret",
      key_prefix: "abcdef12",
    });

    renderAtOrgRoute();

    await waitFor(() => expect(screen.getByText("No API keys issued yet.")).toBeInTheDocument());

    // No select rendered — a disabled, read-only "You (email)" display
    // instead. `getByLabelText` would ambiguously match a `<select>` too if
    // one existed; asserting `queryByRole("combobox")` absent is the
    // stronger negative check.
    expect(screen.queryByRole("combobox", { name: "Acting on behalf of" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Acting on behalf of")).toHaveValue(`You (${SELF.email})`);
    expect(screen.getByLabelText("Acting on behalf of")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "Active Agent" } });
    fireEvent.click(screen.getByRole("button", { name: "Issue key" }));

    await waitFor(() =>
      expect(mockCreateAgent).toHaveBeenCalledWith(ORG_ID, {
        agent_name: "Active Agent",
        model_or_provider: undefined,
        acting_on_behalf_of_user_id: SELF.actor_id,
      }),
    );
  });

  it("project mode: renders usage docs and a link back to the org page, never the key-management panel", async () => {
    mockGetProject.mockResolvedValue({ id: PROJECT_ID, org_id: ORG_ID, name: "Proj" } as never);

    renderAtProjectRoute();

    expect(await screen.findByText(/manage them from/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "this organization's MCP Integration page" })).toHaveAttribute(
      "href",
      `/orgs/${ORG_ID}/mcp`,
    );
    expect(screen.queryByTestId("mcp-agent-key-management")).not.toBeInTheDocument();
    expect(mockListAgents).not.toHaveBeenCalled();
  });
});
