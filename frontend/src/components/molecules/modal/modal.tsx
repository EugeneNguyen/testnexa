/**
 * `Modal` molecule — hand-rolled Bootstrap 5 modal + backdrop (ADR-0042),
 * replacing `CModal`/`CModalHeader`/`CModalTitle`. Promoted from two
 * near-identical private copies that had drifted slightly apart:
 * `EntityListPage`'s own `AdminModal` (auto-wrapped `children` in
 * `.modal-body` + a separate `footer` prop) and `RoleAssignmentsPanel`'s
 * local `Modal` (no wrap — its own `<form>` needed to span both
 * `.modal-body` and `.modal-footer` so its submit button stays inside the
 * `<form>` element, which a split body/footer prop API can't express without
 * an external `form="id"` association). This molecule takes the second,
 * more general shape: it renders only the `.modal-header` chrome itself and
 * hands `children` the entire rest of `.modal-content` — the caller adds its
 * own `.modal-body`/`.modal-footer` divs (see `EntityListPage`'s usage for
 * the header+body and body+footer shapes; `RoleAssignmentsPanel`'s for a
 * `<form>` spanning both).
 *
 * Deliberate parity choices, unchanged from both prior copies:
 * - **Renders nothing at all when closed** — `queryByText(...)`-is-null
 *   assertions and e2e `.modal-content` locators depend on the closed modal
 *   contributing no DOM, matching `CModal`'s unmount behavior.
 * - **ESC closes**, matching `CModal`'s own default `keyboard` behavior. The
 *   listener is bound only while open and removed on close/unmount.
 * - The header's close `<button class="btn-close" aria-label="Close">` is
 *   kept — `CModalHeader` rendered one by default.
 *
 * Deliberate gaps, accepted in ADR-0042 rather than reimplemented: no focus
 * trap, no focus restore on close, no backdrop-click-to-close.
 *
 * `Modal.Body`/`Modal.Footer` are the reusable `.modal-body`/`.modal-footer`
 * div wrappers themselves — plain, so a caller needing both inside one
 * `<form>` (`RoleAssignmentsPanel`) can nest them directly under it, and a
 * caller needing no `<form>` at all (`EntityListPage`'s two modals) can use
 * them as direct children of `Modal`:
 *
 * ```tsx
 * <Modal visible title="..." onClose={...}>
 *   <Modal.Body>...</Modal.Body>
 *   <Modal.Footer>...</Modal.Footer>
 * </Modal>
 * ```
 */
import { useEffect, useId, type ReactNode } from "react";

export interface ModalProps {
  visible: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export interface ModalSectionProps {
  children: ReactNode;
  /** Appended to the section's own element. */
  className?: string;
}

export function ModalBody({ children, className }: ModalSectionProps) {
  return <div className={["modal-body", className].filter(Boolean).join(" ")}>{children}</div>;
}

export function ModalFooter({ children, className }: ModalSectionProps) {
  return <div className={["modal-footer", className].filter(Boolean).join(" ")}>{children}</div>;
}

function ModalBase({ visible, title, onClose, children }: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    if (!visible) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, onClose]);

  if (!visible) {
    return null;
  }

  return (
    <>
      <div className="modal fade show d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title" id={titleId}>
                {title}
              </h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            {children}
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" />
    </>
  );
}

type ModalComponent = ((props: ModalProps) => ReactNode) & {
  Body: typeof ModalBody;
  Footer: typeof ModalFooter;
};

const ModalWithSections = ModalBase as ModalComponent;
ModalWithSections.Body = ModalBody;
ModalWithSections.Footer = ModalFooter;

export const Modal = ModalWithSections;
