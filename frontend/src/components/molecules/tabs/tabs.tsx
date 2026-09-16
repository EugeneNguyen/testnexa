/**
 * `Tabs` molecule — a horizontal tab strip.
 *
 * Built for [ADR-0074](../../../../../docs/adr/0074-entity-detail-relationship-tabs.md)
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
 * ## Mounting it in a card header (ADR-0074's Amendment)
 *
 * Tabler's documented "tabs in the card header" pattern is this same `<ul>`
 * with `card-header-tabs` added, as the *only* child of a `.card-header`, with
 * the panels in `.card-body > .tab-content > .tab-pane.active.show`. That
 * class is deliberately **not** baked in here — a strip mounted anywhere else
 * must not carry it. Callers pass it through `className`; `EntityDetailPage`
 * is the one that does.
 *
 * Read out of the shipped CSS rather than assumed (ADR-0042's own rule):
 * Tabler sets `.card-header{display:flex}` and `.card-header-tabs{flex:1;
 * margin:calc(-1*cap-padding-y) calc(-1*cap-padding-x); background:
 * var(--tblr-bg-surface-tertiary)}` — i.e. the nav is sized and positioned to
 * *become* the whole header. A title or button sibling in that header would be
 * overlapped by the nav's own negative margins, which is why the caller keeps
 * its page heading and actions above the card rather than beside the strip.
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
 * the list, `role="tab"` + `aria-selected` + `aria-controls` + its own `id` on
 * each control, and the caller is expected to put the matching `id`,
 * `role="tabpanel"` and `aria-labelledby` on its panel — `panelId` and
 * `tabTriggerId` return the two ids to use, so the pair can't drift.
 * A real `<button>` is keyboard-reachable and Enter/Space-activated for free,
 * which a `<a href="#">` or a `<div>` would not be. Tabler's reference markup
 * uses `<a href="#...">`; that is Bootstrap's stock anchor-driven variant, not
 * a requirement, and it would cost exactly those free keyboard semantics.
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
 *    table and ADR-0073's own Consequences). Shipping a new call site of a
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

/**
 * The `id` this component puts on `tabId`'s own trigger — the caller points
 * its panel's `aria-labelledby` at it, completing the pair `aria-controls`
 * starts. Exported so the caller never hand-types the string.
 */
export function tabTriggerId(testIdPrefix: string, tabId: string): string {
  return `${testIdPrefix}-tab-${tabId}`;
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
              id={tabTriggerId(testIdPrefix, item.id)}
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
