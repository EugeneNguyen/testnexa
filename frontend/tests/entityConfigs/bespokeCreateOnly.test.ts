/**
 * PLAN-3 (ADR-0033): the two entity configs whose `create` is bespoke-only, and
 * which therefore must NOT advertise `"create"` on the generic admin surface.
 *
 * This is the frontend half of a two-sided contract. The backend half lives in
 * `backend/tests/unit/test_plan3_route_boundaries.py`
 * (`test_test_execution_config_registers_no_create` /
 * `test_test_cycle_config_still_registers_no_create`) and asserts the same
 * property against `_TEST_EXECUTION_CONFIG`/`_TEST_CYCLE_CONFIG`. Both halves
 * are needed: the backend one proves the route is gone, this one proves the UI
 * doesn't still offer a button that submits to it.
 *
 * The failure this catches is silent and user-visible rather than a crash — a
 * config listing `"create"` renders a "New …" button on `EntityListPage` whose
 * submit now answers `405`, with nothing in the type system or the backend
 * suite to notice. `TestExecution` had exactly that shape between ADR-0025 and
 * ADR-0033.
 *
 * Located under `tests/entityConfigs/` to mirror `src/entityConfigs/`, per
 * `frontend/CLAUDE.md`'s "tests mirror src's directory shape" convention.
 */
import { describe, expect, it } from "vitest";
import testCycleConfig from "../../src/entityConfigs/test-cycle";
import testExecutionConfig from "../../src/entityConfigs/test-execution";

describe("entityConfigs — bespoke-create-only entities (PLAN-3, ADR-0033)", () => {
  it("test_cycle offers no generic create: its only create path is TestPlanDetail's bespoke modal", () => {
    expect(testCycleConfig.methods).not.toContain("create");
  });

  it("test_execution offers no generic create: ADR-0033 replaced it with POST /test-cycles/{id}/executions", () => {
    expect(testExecutionConfig.methods).not.toContain("create");
  });

  it.each([
    ["test_cycle", testCycleConfig],
    ["test_execution", testExecutionConfig],
  ])(
    "%s keeps list/get/update/delete — the restriction is create-only, not a blanket removal",
    (_name, config) => {
      for (const method of ["list", "get", "update", "delete"] as const) {
        expect(config.methods).toContain(method);
      }
    },
  );
});
