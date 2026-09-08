/**
 * SHELL-8 (ADR-0020) "UI Elements" reference page: Font Awesome icon
 * gallery. Template-parity scaffolding ONLY — **not backed by any FR/NFR or
 * user story** (ADR-0020, TC-SHELL-014's own note), same status as the base
 * template's own demo content. Smoke-level content only: a fixed sample of
 * icons from the `@fortawesome/fontawesome-free` dependency already
 * installed for the whole app — no new icon package, per ADR-0020's
 * explicit no-new-dependency scope (and ADR-0042's "still exactly one icon
 * library" rule).
 *
 * Built with raw Bootstrap 5 / AdminLTE markup (ADR-0042, superseding the
 * CoreUI build of ADR-0012) — `col-*`/`row` plus a plain `<i>` carrying
 * Font Awesome's own classes. There is no icon component and no icon path
 * array: Font Awesome renders from CSS classes, so the previous CoreUI
 * icons + `CIcon` pairing (a `string[]` SVG path array passed to a React
 * component) has no equivalent here and is gone entirely. The 13
 * samples are the same 13 concepts the CoreUI gallery showed, mapped
 * one-for-one via ADR-0042's own `cil*` → Font Awesome name table; the
 * caption is now the Font Awesome class, since that is what a reader would
 * actually copy into their own markup.
 */
const SAMPLE_ICONS: string[] = [
  "fa-solid fa-house",
  "fa-solid fa-user",
  "fa-solid fa-gear",
  "fa-solid fa-bell",
  "fa-solid fa-bars",
  "fa-solid fa-list",
  "fa-solid fa-circle-check",
  "fa-solid fa-triangle-exclamation",
  "fa-solid fa-palette",
  "fa-solid fa-font",
  "fa-solid fa-sun",
  "fa-solid fa-moon",
  "fa-solid fa-circle-half-stroke",
];

function Icons() {
  return (
    <div className="container-fluid px-4 py-4">
      <h1 className="fs-4 mb-3">Icons</h1>
      <div className="row">
        {SAMPLE_ICONS.map((icon) => (
          <div className="col-6 col-sm-4 col-md-3 col-lg-2 mb-4 text-center" key={icon}>
            <i className={`${icon} fa-2x`} aria-hidden="true" />
            <div className="small text-body-secondary mt-1">{icon}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Icons;
