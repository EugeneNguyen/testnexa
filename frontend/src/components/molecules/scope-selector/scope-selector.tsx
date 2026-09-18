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
 * is literally `project_id`.
 *
 * **ADR-0081 closes the two-hop case this file's own comment used to leave
 * open** (`TestExecution` -> `TestCycle` needs `test_plan_id`, `Defect`/
 * `TestLog` -> `TestExecution` needs `test_case_id`): an option's own `via`
 * (`ScopeSelectorOption.via`, backend-declared) renders as a PRECEDING
 * picker step. Once the via entity is picked, its id feeds into the outer
 * option's own `extraParams` as `{[via.paramName]: viaValue}` — never
 * reported to `onResolved` itself, which still only ever fires for the
 * real scope field this page's list route needs. `TestConditionTestCaseLink`
 * -> `TestCondition` (`requirement_id`) and anything scoped via `TestCase`
 * (`TestStep`, `TestCaseDefectLink`, `Attachment`, still blocked on
 * `test-case.ts`'s own pre-existing "no list route exists" gap) remain
 * undeclared — no live config needs them yet, not a limit of this mechanism.
 *
 * **ADR-0089 closes a much older gap in this exact file: neither picker
 * below ever received a `labelField` prop, at all, since this component was
 * first written** — every scope-selector picker in the app rendered the
 * referenced row's raw `id` instead of a human-readable label.
 * `ScopeSelectorOption.labelField` (backend-declared, mirroring
 * `FieldMeta.label_field`/`CompoundCreateAction.parentLabelField`) is now
 * threaded to both `active`'s and `active.via`'s own control.
 */
import { useState } from "react";
import { ScopeSelectorOption } from "../../../entityConfigs/types";
import FkAutocomplete from "../fk-autocomplete";
import FkSelect from "../fk-select";

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
  // ADR-0081: the intermediate pick for `active.via`, when the active
  // option declares one — cleared whenever the active option itself changes.
  const [viaValue, setViaValue] = useState<string | undefined>(undefined);
  const active = optionList[activeIndex];

  function selectOption(index: number) {
    setActiveIndex(index);
    setValue(undefined);
    setViaValue(undefined);
  }

  function handleChange(id: string | undefined) {
    setValue(id);
    if (id) {
      onResolved(active.paramName, id);
    }
  }

  const needsViaFirst = Boolean(active.via) && !viaValue;

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
      {needsViaFirst ? (
        (() => {
          const ViaControl = active.via!.select ? FkSelect : FkAutocomplete;
          return (
            <ViaControl
              id="scope-selector-via-fk"
              label={active.via!.label ?? `First, pick a ${active.via!.refEntity}`}
              refEntity={active.via!.refEntity}
              labelField={active.via!.labelField}
              value={undefined}
              onChange={(id) => id && setViaValue(id)}
              extraParams={extraParams}
            />
          );
        })()
      ) : (
        <>
          {active.via && (
            <p className="text-body-secondary small mb-1">
              <button
                type="button"
                className="btn btn-link btn-sm p-0 align-baseline"
                onClick={() => {
                  setViaValue(undefined);
                  setValue(undefined);
                }}
              >
                Change {active.via.label ?? active.via.refEntity}
              </button>
            </p>
          )}
          {(() => {
            const ActiveControl = active.select ? FkSelect : FkAutocomplete;
            return (
              <ActiveControl
                id="scope-selector-fk"
                label={active.label ?? `Filter by ${active.refEntity}`}
                refEntity={active.refEntity}
                labelField={active.labelField}
                value={value}
                onChange={handleChange}
                extraParams={active.via ? { ...extraParams, [active.via.paramName]: viaValue } : extraParams}
              />
            );
          })()}
        </>
      )}
    </div>
  );
}

export default ScopeSelector;
