/**
 * `Spinner` atom — Bootstrap 5 `.spinner-border` loading indicator
 * (ADR-0042), centered in a `d-flex justify-content-center` wrapper.
 * `EntityFormPage.tsx` alone hand-rolled this exact 5-line block three times
 * (schema load, item load, defects load — each with a different wrapper
 * `py-*` spacing); 7 other files across the codebase do the same. Per
 * `frontend/CLAUDE.md`'s component-reuse rule, this is the reusable
 * primitive going forward — not retrofitted into every existing call site
 * in this pass.
 *
 * `role="status"` is always applied — `CSpinner` had it implicitly, and 3+
 * existing tests do `getByRole("status")` (root `CLAUDE.md`'s a11y note).
 */
import { ReactNode } from "react";

export interface SpinnerProps {
  /** Appended to the outer centering wrapper (e.g. `"py-4"`, `"py-3"`). */
  wrapperClassName?: string;
  /** Visually-hidden text for the `role="status"` element. */
  label?: ReactNode;
}

export function Spinner({ wrapperClassName, label = "Loading..." }: SpinnerProps) {
  const wrapperClassNames = ["d-flex", "justify-content-center", wrapperClassName].filter(Boolean).join(" ");

  return (
    <div className={wrapperClassNames}>
      <div className="spinner-border text-primary" role="status">
        <span className="visually-hidden">{label}</span>
      </div>
    </div>
  );
}
