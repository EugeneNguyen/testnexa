/**
 * `Tabs` molecule — a horizontal tab strip.
 *
 * Built for [ADR-0071](../../../../../docs/adr/0071-entity-detail-relationship-tabs.md)
 * (`EntityDetailPage`'s Info + one-per-relationship tabs) after the mandatory
 * reuse check (`frontend/CLAUDE.md`): `grep`ping `components/{atoms,molecules,
 * organisms,templates}` plus the raw class strings (`nav-tabs`, `role=
 * "tablist"`) found **no** tab primitive and no hand-rolled near-duplicate
 * anywhere in `frontend/src` — unlike the `Card`/`Modal` cases, this one had
 * no existing copy to promote. Molecule tier per ADR-0043: it composes plain
 * elements and owns no data fetching or business rule.
 *
 * ## Markup
 *
 * Stock Bootstrap 5 tab markup — `ul.nav.nav-tabs > li.nav-item >
 * button.nav-link[.active]` — which is what both design systems in this repo
 * style (Tabler wins the cascade project-wide since ADR-0054, AdminLTE
 * elsewhere; neither invents its own class here). Per ADR-0042 the class
 * names are the library's own, verbatim, not invented.
 *
 * ## No `data-bs-toggle`
 *
 * Deliberately absent, and this is load-bearing rather than an omission:
 * Tabler's own JS bundle **is** loaded (ADR-0053 Phase 1) and would act on a
 * `data-bs-toggle="tab"` attribute, fighting React for ownership of which
 * panel is visible. `frontend/CLAUDE.md`'s Tabler section states the rule for
 * exactly this situation — React owns the state, the component only renders
 * the resulting class string. So each tab is a real `<button type="button">`
 * with an `onClick`, and the caller renders the active panel itself.
 *
 * ## Accessibility
 *
 * Hand-written markup owns its own semantics (ADR-0042): `role="tablist"` on
 * the list, `role="tab"` + `aria-selected` + `aria-controls` on each control,
 * and the caller is expected to put the matching `id` and `role="tabpanel"`
 * on its panel — `panelId` returns the id to use, so the two can't drift.
 * A real `<button>` is keyboard-reachable and Enter/Space-activated for free,
 * which a `<a href="#">` or a `<div>` would not be.
 */

export interface TabItem {
  /** Stable, URL-safe identity — also what the caller stores as its active-tab state. */
  id: string;
  label: string;
}

/**
 * No per-tab count badge, deliberately, on two independent grounds:
 *
 * 1. A count would mean firing every relationship's list request on mount
 *    just to render the strip — N requests for a number, when the user opens
 *    at most one tab.
 * 2. `badge bg-secondary` is currently **invisible** repo-wide (its text
 *    colour equals its background — see `frontend/CLAUDE.md`'s measurement
 *    table and ADR-0070's own Consequences). Shipping a new call site of a
 *    known-broken class, in a story that isn't fixing it, would just widen
 *    the blast radius of a defect that already needs its own ADR.
 */


export interface TabsProps {
  items: TabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  /**
   * Prefix for every `data-testid` and for the generated panel ids, so two
   * tab strips on one page can't collide.
   */
  testIdPrefix: string;
  className?: string;
}

/** The `id` the caller must put on the panel it renders for `tabId`. */
export function panelId(testIdPrefix: string, tabId: string): string {
  return `${testIdPrefix}-panel-${tabId}`;
}

export function Tabs({ items, activeId, onSelect, testIdPrefix, className }: TabsProps) {
  return (
    <ul
      className={`nav nav-tabs${className ? ` ${className}` : ""}`}
      role="tablist"
      data-testid={`${testIdPrefix}-tablist`}
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <li className="nav-item" key={item.id}>
            <button
              type="button"
              role="tab"
              className={`nav-link${isActive ? " active" : ""}`}
              aria-selected={isActive}
              aria-controls={panelId(testIdPrefix, item.id)}
              onClick={() => onSelect(item.id)}
              data-testid={`${testIdPrefix}-tab-${item.id}`}
            >
              {item.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default Tabs;
