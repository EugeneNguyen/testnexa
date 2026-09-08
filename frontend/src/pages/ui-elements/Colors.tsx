/**
 * SHELL-8 (ADR-0020) "UI Elements" reference page: CoreUI's themed colors.
 * Template-parity scaffolding ONLY — **not backed by any FR/NFR or user
 * story** (ADR-0020, TC-SHELL-014's own note), same status as the base
 * template's own demo content. Smoke-level content only: a swatch per
 * themed color, no content-correctness assertions expected.
 *
 * Built with raw Bootstrap 5 / AdminLTE markup (ADR-0042, superseding the
 * CoreUI build of ADR-0012) — `card`/`col-*`/`row` plus Bootstrap's own
 * `bg-*`/`text-*` utility classes (not Tailwind).
 */

const THEME_COLORS = [
  "primary",
  "secondary",
  "success",
  "danger",
  "warning",
  "info",
  "light",
  "dark",
] as const;

function Colors() {
  return (
    <div className="container-fluid px-4 py-4">
      <h1 className="fs-4 mb-3">Colors</h1>
      <div className="row">
        {THEME_COLORS.map((color) => (
          <div className="col-sm-6 col-md-3 mb-4" key={color}>
            <div className="card">
              <div className={`bg-${color} py-4 text-center`}>
                <span className={color === "light" ? "text-dark" : "text-white"}>{color}</span>
              </div>
              <div className="card-body">
                <p className="card-text text-body-secondary mb-0 text-capitalize">.bg-{color}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Colors;
