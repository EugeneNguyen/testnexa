/**
 * REQ-3 TestCondition create/list calls (ADR-0028 bespoke atomic-create
 * route + the pre-existing generic list route).
 *
 * Source: `app/api/routes/test_condition_authoring.py` /
 * `app/api/routes/assets.py` / `app/schemas/assets.py` (exact request/response
 * contracts) — mirrors `requirements.ts`'s pattern.
 *
 * Asymmetry worth flagging: unlike `createRequirement` (which posts to the
 * flat generic `/requirements` route with `project_id` in the body), the
 * create call here posts to a **path-scoped bespoke route**,
 * `POST /requirements/{id}/test-conditions`, because it must atomically write
 * both the `TestCondition` row and its `RequirementTestConditionLink` row
 * (ADR-0028) — the generic factory's `POST /test-conditions` never wrote the
 * link row and has been removed. The list call, by contrast, is still the
 * plain generic route (`GET /test-conditions?requirement_id=`), unchanged.
 */
import { apiFetch } from "./client";

export type TestConditionPriority = "low" | "medium" | "high";

export interface TestConditionSummary {
  id: string;
  requirement_id: string;
  description: string;
  priority: TestConditionPriority;
}

export interface CreateTestConditionPayload {
  description: string;
  priority: TestConditionPriority;
}

export interface TestConditionListResponse {
  items: TestConditionSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface ListTestConditionsParams {
  page?: number;
  page_size?: number;
}

/**
 * Create a TestCondition under `requirementId`, atomically linked to it
 * (`RequirementTestConditionLink`) server-side. Resolves with the new
 * condition's `TestConditionSummary`.
 *
 * `requirement_id` is deliberately absent from the body — the route stamps it
 * from the path segment (`CreateTestConditionForRequirementRequest`).
 *
 * Rejects with an `ApiError` on failure: `404` if the caller has no
 * membership in the requirement's org (NFR-1) or the requirement doesn't
 * exist, `403 permission_denied` if they're a member but lack
 * `test_condition.create`, `422` on a missing/invalid field.
 */
export async function createTestCondition(
  requirementId: string,
  payload: CreateTestConditionPayload,
): Promise<TestConditionSummary> {
  return apiFetch<TestConditionSummary>(`/api/v1/requirements/${requirementId}/test-conditions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * List TestConditions scoped to `requirementId`. `requirement_id` is required
 * by the generic factory's `scope_field` enforcement (422 if omitted) —
 * always sent here.
 *
 * Rejects with an `ApiError` on failure: `404`/`403` same boundary as
 * `createTestCondition`, gated on `test_condition.read`.
 */
export async function listTestConditions(
  requirementId: string,
  params: ListTestConditionsParams = {},
): Promise<TestConditionListResponse> {
  const query = new URLSearchParams({ requirement_id: requirementId });
  if (params.page !== undefined) {
    query.set("page", String(params.page));
  }
  if (params.page_size !== undefined) {
    query.set("page_size", String(params.page_size));
  }
  return apiFetch<TestConditionListResponse>(`/api/v1/test-conditions?${query.toString()}`);
}
