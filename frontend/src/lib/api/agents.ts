/**
 * AUTH-4/ADR-0015 agent-credential API calls, extended by ADR-0063's
 * `GET /orgs/{org_id}/agents` list route.
 *
 * Same thin-wrapper-over-`apiFetch` shape as `lib/api/members.ts` — no
 * bespoke fetch logic here.
 */
import { apiFetch } from "./client";

export interface CreateAgentPayload {
  agent_name: string;
  model_or_provider?: string;
  acting_on_behalf_of_user_id: string;
}

/**
 * `POST /orgs/{org_id}/agents` (ADR-0015): `ai_agent.create`, human-only.
 * `api_key` is the raw, unhashed credential — shown here once, never
 * retrievable again. Callers must never log/persist this response body
 * beyond the one-time "copy it now" UI moment.
 */
export interface CreateAgentResponse {
  agent_id: string;
  agent_name: string;
  api_key: string;
  key_prefix: string;
}

export async function createAgent(orgId: string, payload: CreateAgentPayload): Promise<CreateAgentResponse> {
  return apiFetch<CreateAgentResponse>(`/api/v1/orgs/${orgId}/agents`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface RevokeAgentResponse {
  agent_id: string;
  revoked_at: string;
}

/**
 * `POST /orgs/{org_id}/agents/{agent_id}/revoke` (ADR-0015): `ai_agent.update`,
 * human-only, idempotent — revoking an already-revoked agent returns 200
 * with the existing `revoked_at`, not an error.
 */
export async function revokeAgent(orgId: string, agentId: string): Promise<RevokeAgentResponse> {
  return apiFetch<RevokeAgentResponse>(`/api/v1/orgs/${orgId}/agents/${agentId}/revoke`, {
    method: "POST",
  });
}

/**
 * A single row from `GET /orgs/{org_id}/agents`'s `items` array (ADR-0063).
 * Never carries `api_key` — the raw credential is issuance-only.
 */
export interface AgentSummary {
  agent_id: string;
  agent_name: string;
  model_or_provider: string | null;
  key_prefix: string;
  acting_on_behalf_of_user_id: string;
  issued_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface AgentsPage {
  items: AgentSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface ListAgentsParams {
  page?: number;
  page_size?: number;
}

/**
 * `GET /orgs/{org_id}/agents` (ADR-0063): `ai_agent.create` (reused, not a
 * new `.read` permission code — see the route's own docstring), human-only,
 * same 404-vs-403 boundary as `createAgent`/`revokeAgent`. Includes revoked
 * agents (not filtered out) — management needs the full history.
 */
export async function listAgents(orgId: string, params: ListAgentsParams = {}): Promise<AgentsPage> {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.page_size !== undefined) query.set("page_size", String(params.page_size));
  const qs = query.toString();
  return apiFetch<AgentsPage>(`/api/v1/orgs/${orgId}/agents${qs ? `?${qs}` : ""}`);
}
