/**
 * MCP Integration screen (ADR-0063): explains TestNexa's first-party MCP
 * server (`backend/app/mcp/`, ADR-0033) and how to connect Claude Code,
 * Codex, Cursor, or any other MCP-HTTP client to it — plus, on the org
 * route only, live agent-credential management (issue/list/revoke).
 *
 * One shared component behind two routes (`/orgs/:orgId/mcp`,
 * `/projects/:projectId/mcp`), not a `scope` prop — `useResolvedOrgId()`
 * (SHELL-9/ADR-0050) already tells a component which kind of route it's
 * mounted on and resolves `orgId` either way, so a manual prop would just
 * be a second, driftable source of the same fact `AppSidebar` already
 * derives this way. `mode === "org"` renders the key-management panel;
 * `mode === "project"` renders usage docs only, plus a link back to the
 * org page for key management (agents are org-scoped, ADR-0015 — there is
 * no per-project credential).
 *
 * Key-management panel (org mode) reuses `POST /orgs/{org_id}/agents`
 * (create) and `POST /orgs/{org_id}/agents/{agent_id}/revoke` (ADR-0015),
 * plus the new `GET /orgs/{org_id}/agents` list route this same story adds
 * (ADR-0063) — same plain `useState`/`useCallback`/fetch-on-mount shape as
 * `OrgMembers.tsx` (a bespoke, non-generic-admin screen), not react-query
 * (this codebase's generic-admin surface's own convention, not every
 * bespoke screen's).
 *
 * **`acting_on_behalf_of_user_id` picker is admin-gated, not just
 * admin-labeled.** `GET /orgs/{org_id}/members` needs `org_membership.read`
 * (RBAC-2) — a real, separate permission from `ai_agent.create`/`.update`,
 * which is all this screen's own panel otherwise requires. The member list
 * is fetched as a **best-effort** call, independent of `listAgents`/`me()`
 * (both of which are hard requirements — their failure still shows the
 * panel-wide error): if it succeeds, the caller can pick any active
 * member (defaults to themselves); if it 403s, that's read as "not an
 * org-membership admin," not a panel-wide error — the picker is replaced by
 * a plain, non-editable "you" display and every key is issued on behalf of
 * the logged-in user, via `GET /auth/me`. This also fixes a real bug the
 * first version of this screen shipped with: requiring `org_membership.read`
 * via a single `Promise.all` meant a member holding only `ai_agent.create`
 * (this screen's own stated minimum) couldn't issue a key for themselves at
 * all.
 *
 * The raw `api_key` is shown exactly once, in a copy-once alert, mirroring
 * `OrgMembers.tsx`'s invite-link pattern (same one-time-secret UX, same
 * `navigator.clipboard`-with-`execCommand`-fallback helper, copied rather
 * than re-abstracted — a shared `useCopyToClipboard` hook would be a
 * reasonable follow-up once a third screen needs the same behavior, per
 * `frontend/CLAUDE.md`'s "not-once by the time a second call site wants it"
 * reuse-check, but two occurrences alone doesn't cross that story's own
 * documented 2+-use threshold *decisively* enough to justify extracting one
 * mid-task here). Never persisted, logged, or re-fetchable — matches
 * ADR-0015's GitHub-PAT-style one-time-issuance contract.
 */
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useResolvedOrgId } from "../../../hooks/useResolvedOrgId";
import { ApiError } from "../../../lib/api/client";
import { AgentSummary, CreateAgentResponse, createAgent, listAgents, revokeAgent } from "../../../lib/api/agents";
import { MeResponse, me } from "../../../lib/api/auth";
import { OrgMember, listMembers } from "../../../lib/api/members";
import { Alert, Button, Card, FormField, Select } from "../../../components";

const createAgentSchema = z.object({
  agent_name: z.string().min(1, "Enter a name for this agent."),
  model_or_provider: z.string().optional(),
  // Optional at the schema level — required only when the picker is shown
  // (the caller can list org members, i.e. holds `org_membership.read`);
  // validated manually in `onCreateSubmit` for that case, defaulted to the
  // logged-in user's own id otherwise. See this file's own docstring.
  acting_on_behalf_of_user_id: z.string().optional(),
});

type CreateAgentFormValues = z.infer<typeof createAgentSchema>;

function mcpServerUrl(): string {
  return `${window.location.origin}/mcp`;
}

function claudeCodeSnippet(url: string, apiKey: string): string {
  return `claude mcp add --transport http testnexa ${url} \\\n  --header "Authorization: Bearer ${apiKey}"`;
}

function claudeCodeJsonSnippet(url: string, apiKey: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        testnexa: { type: "http", url, headers: { Authorization: `Bearer ${apiKey}` } },
      },
    },
    null,
    2,
  );
}

function codexSnippet(url: string): string {
  return `[mcp_servers.testnexa]\nurl = "${url}"\nbearer_token_env_var = "TESTNEXA_MCP_TOKEN"\n\n# then, before launching codex:\n# export TESTNEXA_MCP_TOKEN=<your api key>`;
}

function cursorSnippet(url: string, apiKey: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        testnexa: { url, headers: { Authorization: `Bearer ${apiKey}` } },
      },
    },
    null,
    2,
  );
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

interface CodeBlockProps {
  children: string;
}

function CodeBlock({ children }: CodeBlockProps) {
  // `text-body` is required, not decorative: Tabler's own `pre{color:var(--tblr-light)}`
  // (a fixed, non-theme-aware near-white) wins the cascade project-wide since
  // ADR-0054 (frontend/CLAUDE.md's "cascade flip" note) — invisible against
  // this light `bg-body-tertiary` background in light mode, fine in dark
  // mode by coincidence only. `.text-body` (`--bs-body-color`, theme-aware)
  // is a class selector, so it outranks Tabler's bare-element rule
  // regardless of stylesheet import order.
  return (
    <pre className="bg-body-tertiary text-body border rounded p-3 mb-0 small" style={{ whiteSpace: "pre-wrap" }}>
      <code>{children}</code>
    </pre>
  );
}

function McpIntegration() {
  const { mode, orgId } = useResolvedOrgId();
  const url = mcpServerUrl();
  const placeholderKey = "tnx_agent_xxxxxxxx_your-api-key";

  return (
    <div className="min-vh-100 py-4">
      <div className="container-fluid px-4">
        <div className="row justify-content-center">
          <div className="col-12 col-lg-9">
            <h1 className="fs-4 mb-4">MCP Integration</h1>

            <Card className="mb-4">
              <Card.Header>
                <Card.Title>What is MCP?</Card.Title>
              </Card.Header>
              <Card.Body>
                <p>
                  TestNexa ships a first-party{" "}
                  <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer">
                    Model Context Protocol
                  </a>{" "}
                  server — a thin transport adapter over the same REST API and permission checks every human
                  user goes through, exposed as callable tools an AI coding agent can invoke directly (create
                  test cases, list requirements, and more) without a human copy-pasting between chat and the
                  app.
                </p>
                <p className="mb-0">
                  Server URL: <code>{url}</code> · Transport: streamable HTTP · Auth: a bearer API key issued
                  to an <strong>AI agent</strong> credential (below), never a human login token.
                </p>
              </Card.Body>
            </Card>

            <Card className="mb-4">
              <Card.Header>
                <Card.Title>Connect a client</Card.Title>
              </Card.Header>
              <Card.Body>
                <p>Replace the placeholder key below with a real one issued from the panel further down this page.</p>

                <h2 className="fs-6">Claude Code</h2>
                <p className="text-body-secondary small">CLI, one command:</p>
                <CodeBlock>{claudeCodeSnippet(url, placeholderKey)}</CodeBlock>
                <p className="text-body-secondary small mt-3">
                  Or add directly to <code>.mcp.json</code>:
                </p>
                <CodeBlock>{claudeCodeJsonSnippet(url, placeholderKey)}</CodeBlock>

                <h2 className="fs-6 mt-4">Codex CLI</h2>
                <p className="text-body-secondary small">
                  Add to <code>~/.codex/config.toml</code>:
                </p>
                <CodeBlock>{codexSnippet(url)}</CodeBlock>

                <h2 className="fs-6 mt-4">Cursor</h2>
                <p className="text-body-secondary small">
                  Add to <code>.cursor/mcp.json</code>:
                </p>
                <CodeBlock>{cursorSnippet(url, placeholderKey)}</CodeBlock>

                <h2 className="fs-6 mt-4">Any other MCP client</h2>
                <p className="text-body-secondary small mb-0">
                  Any client supporting the MCP streamable-HTTP transport works — point it at the server URL
                  above and send <code>Authorization: Bearer &lt;your api key&gt;</code> on every request. No
                  session cookies, no SSE — a stateless, single request-response transport.
                </p>
              </Card.Body>
            </Card>

            {mode === "org" && orgId && <AgentKeyManagement orgId={orgId} />}

            {mode === "project" && orgId && (
              <Card>
                <Card.Body>
                  <p className="mb-0">
                    API keys are issued per organization, not per project — manage them from{" "}
                    <a href={`/orgs/${orgId}/mcp`}>this organization's MCP Integration page</a>.
                  </p>
                </Card.Body>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface AgentKeyManagementProps {
  orgId: string;
}

function AgentKeyManagement({ orgId }: AgentKeyManagementProps) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  // Whether the last `listMembers` attempt succeeded — the actual signal
  // this screen uses in place of a generic "is org_admin" flag, which
  // nothing in this codebase's RBAC model exposes (no role name, no
  // boolean, only per-code permission checks). `null` = not yet resolved.
  const [canPickMember, setCanPickMember] = useState<boolean | null>(null);
  const [self, setSelf] = useState<MeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [createResult, setCreateResult] = useState<CreateAgentResponse | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<CreateAgentFormValues>({ resolver: zodResolver(createAgentSchema) });

  const fetchAll = useCallback(async () => {
    // Hard requirements — `ai_agent.create` (via `listAgents`) is this
    // whole panel's own stated minimum (ADR-0063); `me()` is needed either
    // way, to default/lock `acting_on_behalf_of_user_id` to the caller.
    // Either failing shows the panel-wide error state.
    try {
      const [agentsPage, identity] = await Promise.all([listAgents(orgId), me()]);
      setAgents(agentsPage.items);
      setSelf(identity);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setIsLoading(false);
      return;
    }

    // Best-effort — `org_membership.read` is a separate permission
    // (RBAC-2). A 403 here means "not an org-membership admin," not a
    // panel-wide error: fall back to acting-on-behalf-of-self only.
    try {
      const membersPage = await listMembers(orgId, { page_size: 100 });
      setMembers(membersPage.items);
      setCanPickMember(true);
    } catch {
      setMembers([]);
      setCanPickMember(false);
    }
    setIsLoading(false);
  }, [orgId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Once the picker becomes available and a value hasn't been chosen yet,
  // default it to the logged-in user — the common case (issuing a key for
  // yourself) needs zero clicks; picking someone else is still one away.
  useEffect(() => {
    if (canPickMember && self) {
      setValue("acting_on_behalf_of_user_id", self.actor_id);
    }
  }, [canPickMember, self, setValue]);

  const memberEmailByUserId = new Map(members.map((member) => [member.user_id, member.email]));
  const activeMembers = members.filter((member) => member.status === "active");

  function emailFor(userId: string): string {
    return memberEmailByUserId.get(userId) ?? (self && userId === self.actor_id ? self.email : "—");
  }

  async function onCreateSubmit(values: CreateAgentFormValues) {
    setCreateError(null);
    setCreateResult(null);
    setCopied(false);

    // Non-admin (no picker rendered): always self, regardless of whatever
    // stale value the untouched, unregistered field might carry. Admin: the
    // picker's own chosen value, required.
    const actingOnBehalfOfUserId = canPickMember ? values.acting_on_behalf_of_user_id : self?.actor_id;
    if (!actingOnBehalfOfUserId) {
      setCreateError("Choose who this agent acts on behalf of.");
      return;
    }

    setIsCreating(true);
    try {
      const result = await createAgent(orgId, {
        agent_name: values.agent_name,
        model_or_provider: values.model_or_provider || undefined,
        acting_on_behalf_of_user_id: actingOnBehalfOfUserId,
      });
      setCreateResult(result);
      reset();
      // `reset()` clears the picker back to blank — re-default it to self,
      // same as the mount-time effect above (which won't re-fire here,
      // since `canPickMember`/`self` themselves haven't changed).
      if (canPickMember && self) {
        setValue("acting_on_behalf_of_user_id", self.actor_id);
      }
      await fetchAll();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevoke(agent: AgentSummary) {
    setActionError(null);
    setPendingAgentId(agent.agent_id);
    try {
      await revokeAgent(orgId, agent.agent_id);
      await fetchAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPendingAgentId(null);
    }
  }

  // Same secure-context-with-execCommand-fallback shape as
  // `OrgMembers.tsx::copyToClipboard` — see this file's own docstring for
  // why it's copied rather than shared this pass.
  async function copyToClipboard(value: string): Promise<boolean> {
    if (window.isSecureContext && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        // Fall through to the legacy fallback below.
      }
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let succeeded = false;
    try {
      succeeded = document.execCommand("copy");
    } catch {
      succeeded = false;
    }
    document.body.removeChild(textarea);
    return succeeded;
  }

  return (
    <div data-testid="mcp-agent-key-management">
    <Card>
      <Card.Header>
        <Card.Title>API keys</Card.Title>
      </Card.Header>
      <Card.Body>
        {isLoading && (
          <div className="d-flex align-items-center gap-2">
            <div className="spinner-border spinner-border-sm text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <span>Loading API keys...</span>
          </div>
        )}

        {!isLoading && loadError && <Alert color="danger">{loadError}</Alert>}

        {!isLoading && !loadError && (
          <>
            <form
              noValidate
              onSubmit={(event) => {
                void handleSubmit(onCreateSubmit)(event);
              }}
              className="mb-4"
            >
              {/* `align-items-end` on the ROW, not `align-items-start` + a
                  per-column `d-flex align-items-end` hack — with
                  `align-items-start` on the row, flex items aren't
                  stretched, so the button's own column collapses to the
                  button's height alone and "end"-aligns within a column
                  already exactly that tall, i.e. it does nothing: the
                  button ends up level with the row's top (the *labels*),
                  not the *inputs* below them. `align-items-end` on the row
                  itself aligns every column's bottom edge to the tallest
                  sibling's bottom edge instead — the standard Bootstrap
                  "button flush with the inputs, ignore the label height"
                  pattern — so the button's own column needs no special
                  className at all. */}
              <div className="row g-2 align-items-end">
                <div className="col-12 col-md-4">
                  <FormField
                    id="agent-name"
                    label="Agent name"
                    error={errors.agent_name?.message}
                    {...register("agent_name")}
                  />
                </div>
                <div className="col-12 col-md-3">
                  <FormField
                    id="agent-model"
                    label="Model / provider (optional)"
                    error={errors.model_or_provider?.message}
                    {...register("model_or_provider")}
                  />
                </div>
                <div className="col-12 col-md-3">
                  {/* `mb-3` wrapper matches `FormField`'s own — its sibling
                      columns get this margin from `FormField` internally,
                      this hand-rolled column needs it explicitly or
                      `align-items-end` flushes this column's *select*
                      bottom 16px lower than the other columns' *input*
                      bottom (each column's own div-bottom is what actually
                      aligns, not its content's bottom). */}
                  <div className="mb-3">
                    <label className="form-label" htmlFor="agent-acting-on-behalf-of">
                      Acting on behalf of
                    </label>
                    {canPickMember ? (
                      <>
                        <Select
                          id="agent-acting-on-behalf-of"
                          invalid={Boolean(errors.acting_on_behalf_of_user_id)}
                          {...register("acting_on_behalf_of_user_id")}
                        >
                          <option value="">Select a member...</option>
                          {activeMembers.map((member) => (
                            <option key={member.user_id} value={member.user_id}>
                              {member.email}
                            </option>
                          ))}
                        </Select>
                        {errors.acting_on_behalf_of_user_id && (
                          <div className="invalid-feedback d-block">{errors.acting_on_behalf_of_user_id.message}</div>
                        )}
                      </>
                    ) : (
                      // Not an org-membership admin (`org_membership.read`
                      // 403'd) — no picker, always self. This screen's own
                      // docstring explains why: `acting_on_behalf_of_user_id`
                      // is an accountability link, not an approver, and
                      // most keys are issued by/for the person setting up
                      // their own client anyway.
                      <input
                        id="agent-acting-on-behalf-of"
                        className="form-control form-control-sm"
                        value={self ? `You (${self.email})` : ""}
                        disabled
                        readOnly
                      />
                    )}
                  </div>
                </div>
                <div className="col-12 col-md-2">
                  {/* Same `mb-3` reasoning as the column above — without it
                      the button (no trailing margin of its own) sits flush
                      with its column's bottom while the `FormField`
                      columns' inputs sit 16px above theirs, so the button
                      visually floats 16px lower than the inputs beside it. */}
                  <div className="mb-3">
                    <Button type="submit" color="primary" className="w-100" disabled={isCreating}>
                      {isCreating ? "Issuing..." : "Issue key"}
                    </Button>
                  </div>
                </div>
              </div>
            </form>

            {createError && <Alert color="danger" className="mb-3">{createError}</Alert>}

            {createResult && (
              <div className="alert alert-success mb-3">
                <p className="mb-2">
                  Key issued for <strong>{createResult.agent_name}</strong> — copy it now, it will never be shown
                  again.
                </p>
                <div className="d-flex gap-2">
                  <input className="form-control" readOnly value={createResult.api_key} />
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => {
                      void (async () => {
                        const succeeded = await copyToClipboard(createResult.api_key);
                        setCopied(succeeded);
                      })();
                    }}
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            )}

            {actionError && <Alert color="danger">{actionError}</Alert>}

            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Model / provider</th>
                    <th scope="col">Key prefix</th>
                    <th scope="col">Acting on behalf of</th>
                    <th scope="col">Issued</th>
                    <th scope="col">Last used</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => {
                    const isRevoked = agent.revoked_at !== null;
                    return (
                      <tr key={agent.agent_id} className={isRevoked ? "text-body-secondary" : undefined}>
                        <td>{agent.agent_name}</td>
                        <td>{agent.model_or_provider ?? "—"}</td>
                        <td>
                          <code>{agent.key_prefix}</code>
                        </td>
                        <td>{emailFor(agent.acting_on_behalf_of_user_id)}</td>
                        <td>{formatTimestamp(agent.issued_at)}</td>
                        <td>{formatTimestamp(agent.last_used_at)}</td>
                        <td>
                          <span className={`badge bg-${isRevoked ? "secondary" : "success"}`}>
                            {isRevoked ? "Revoked" : "Active"}
                          </span>
                        </td>
                        <td>
                          {!isRevoked && (
                            <Button
                              color="danger"
                              outline
                              size="sm"
                              disabled={pendingAgentId === agent.agent_id}
                              onClick={() => void handleRevoke(agent)}
                            >
                              Revoke
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {agents.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-body-secondary">
                        No API keys issued yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card.Body>
    </Card>
    </div>
  );
}

export default McpIntegration;
