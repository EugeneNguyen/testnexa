/**
 * `components/crud/` (ADR-0023). UI Design Document §2/§4 shape C: gates
 * the rest of the page — nothing else renders until a selection is made.
 * For a single `scopeSelector` option (`Attachment`, and the several
 * project-scoped entities whose real backend `scope_field` isn't
 * `project_id` — see e.g. `entityConfigs/test-condition.ts`'s own
 * docstring), renders one `FkAutocomplete`. For an array (`RiskItem`'s own
 * "by Requirement" / "by TestPlan" toggle, UI Design Document §4), renders a
 * `CButtonGroup` toggle first, then the `FkAutocomplete` for whichever
 * option is active.
 */
import { useState } from "react";
import { CButton, CButtonGroup } from "@coreui/react";
import { ScopeSelectorOption } from "../../entityConfigs/types";
import FkAutocomplete from "./FkAutocomplete";

export interface ScopeSelectorProps {
  options: ScopeSelectorOption | ScopeSelectorOption[];
  /** Fires once a concrete id has been picked for the active option. */
  onResolved: (paramName: string, value: string) => void;
}

function ScopeSelector({ options, onResolved }: ScopeSelectorProps) {
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
        <CButtonGroup className="mb-2" role="group">
          {optionList.map((option, index) => (
            <CButton
              key={option.paramName}
              color="secondary"
              variant={index === activeIndex ? undefined : "outline"}
              active={index === activeIndex}
              onClick={() => selectOption(index)}
            >
              {option.label ?? option.refEntity}
            </CButton>
          ))}
        </CButtonGroup>
      )}
      <FkAutocomplete
        id="scope-selector-fk"
        label={active.label ?? `Filter by ${active.refEntity}`}
        refEntity={active.refEntity}
        value={value}
        onChange={handleChange}
      />
    </div>
  );
}

export default ScopeSelector;
