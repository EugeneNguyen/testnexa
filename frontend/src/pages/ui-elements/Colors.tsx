/**
 * SHELL-8 (ADR-0019) "UI Elements" reference page: CoreUI's themed colors.
 * Template-parity scaffolding ONLY — **not backed by any FR/NFR or user
 * story** (ADR-0019, TC-SHELL-014's own note), same status as the base
 * template's own demo content. Smoke-level content only: a swatch per
 * CoreUI themed color, no content-correctness assertions expected.
 *
 * Built with CoreUI (ADR-0012) — `CCard`/`CCol`/`CRow` plus CoreUI's own
 * `bg-*`/`text-*` utility classes (Bootstrap-family, not Tailwind).
 */
import { CCard, CCardBody, CCardText, CCol, CContainer, CRow } from "@coreui/react";

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
    <CContainer className="py-4">
      <h1 className="fs-4 mb-3">Colors</h1>
      <CRow>
        {THEME_COLORS.map((color) => (
          <CCol sm={6} md={3} className="mb-4" key={color}>
            <CCard>
              <div className={`bg-${color} py-4 text-center`}>
                <span className={color === "light" ? "text-dark" : "text-white"}>{color}</span>
              </div>
              <CCardBody>
                <CCardText className="text-body-secondary mb-0 text-capitalize">.bg-{color}</CCardText>
              </CCardBody>
            </CCard>
          </CCol>
        ))}
      </CRow>
    </CContainer>
  );
}

export default Colors;
