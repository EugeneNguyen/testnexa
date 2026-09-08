/**
 * `components/molecules/` (ADR-0043, superseding ADR-0023's `components/crud/`
 * location). UI Design Document §2/§4 shape C: gates
 * the rest of the page — nothing else renders until a selection is made.
 * For a single `scopeSelector` option (`Attachment`, and the several
 * project-scoped entities whose real backend `scope_field` isn't
 * `project_id` — see e.g. `entityConfigs/test-condition.ts`'s own
 * docstring), renders one `FkAutocomplete`. For an array (`RiskItem`'s own
 * "by Requirement" / "by TestPlan" toggle, UI Design Document §4), renders a
 * button-group toggle first, then the `FkAutocomplete` for whichever
 * option is active.
 *
 * **ADR-0042 (CoreUI -> AdminLTE v4):** `CButtonGroup` -> `<div
 * class="btn-group" role="group">` and `CButton` -> `<button type="button"
 * class="btn btn-secondary|btn-outline-secondary">` (`variant="outline"` was
 * the inactive option, no variant the active one — same two classes
 * Bootstrap's own toggle-button-group example uses). The `active` class and
 * `aria-pressed` are written out by hand here, where CoreUI's `active` prop
 * used to supply them.
 *
 * **Bugfix (found writing ADMIN-2 UI E2E coverage):** the picker's own
 * `FkAutocomplete` search previously fired with no scope params at all
 * (`extraParams` unset), but every scope-selector `refEntity` used across
 * this surface (`requirement`, `test-plan`, `test-condition`, `test-case`)
 * is itself a scoped entity whose own `GET .../list` route *requires* its
 * scope query param (e.g. `requirement`/`test-plan` both require
 * `project_id`) — see `backend/app/api/crud_factory.py`'s `list_items`,
 * `extract_scope_value`. With no `project_id` on the request the backend
 * 422s, `FkAutocomplete`'s `.catch` swallows it into an empty result set,
 * and the search box could never find anything: `RiskItem`/`TestCondition`/
 * `EntryExitCriteria`/`TestCycle`/the two `Requirement*Link` entities'
 * scope-selectors were unusable end to end. `extraParams` now threads the
 * current route's `project_id` through (`EntityListPage` passes it in) —
 * fixes every *one-hop* case above, where the ref entity's own scope field
 * is literally `project_id`. Documented, not fixed here: entities whose
 * scope-selector target is itself scoped by something other than
 * `project_id` (`TestExecution` -> `TestCycle` needs `test_plan_id`,
 * `Defect`/`TestLog` -> `TestExecution` needs `test_cycle_id`,
 * `TestConditionTestCaseLink` -> `TestCondition` needs `requirement_id`) —
 * those need a cascading multi-step picker, a larger change; and anything
 * scoped via `TestCase` (`TestStep`, `TestCaseDefectLink`, `Attachment`)
 * stays blocked on `test-case.ts`'s own pre-existing "no list route exists"
 * gap regardless of this fix.
 */
import { useState } from "react";
import { ScopeSelectorOption } from "../../../entityConfigs/types";
import FkAutocomplete from "../fk-autocomplete";

export interface ScopeSelectorProps {
  options: ScopeSelectorOption | ScopeSelectorOption[];
  /** Fires once a concrete id has been picked for the active option. */
  onResolved: (paramName: string, value: string) => void;
  /** Extra fixed query params merged into the ref entity's own list call (e.g. the current route's `project_id`). */
  extraParams?: Record<string, string | undefined>;
}

function ScopeSelector({ options, onResolved, extraParams }: ScopeSelectorProps) {
  const optionList = Array.isArray(options) ? options : [options];
  const [activeIndex, setActiveIndex] = useState(0);
  const [value, setValue] = useState<string | undefined>(undefined);
  const active = optionList[activeIndex];

  function selectOption(index: number) {
    setActiveIndex(index);
    setValue(undefined);
  }

  function handleChange(id: string | undefined) {
    setValue(id);
    if (id) {
      onResolved(active.paramName, id);
    }
  }

  return (
    <div className="mb-4" data-testid="scope-selector">
      {optionList.length > 1 && (
        <div className="btn-group mb-2" role="group">
          {optionList.map((option, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={option.paramName}
                type="button"
                className={`btn btn-${isActive ? "" : "outline-"}secondary${isActive ? " active" : ""}`}
                aria-pressed={isActive}
                onClick={() => selectOption(index)}
              >
                {option.label ?? option.refEntity}
              </button>
            );
          })}
        </div>
      )}
      <FkAutocomplete
        id="scope-selector-fk"
        label={active.label ?? `Filter by ${active.refEntity}`}
        refEntity={active.refEntity}
        value={value}
        onChange={handleChange}
        extraParams={extraParams}
      />
    </div>
  );
}

export default ScopeSelector;
