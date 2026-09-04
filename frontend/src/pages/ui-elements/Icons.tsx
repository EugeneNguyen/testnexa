/**
 * SHELL-8 (ADR-0020) "UI Elements" reference page: `@coreui/icons-react`
 * icon gallery. Template-parity scaffolding ONLY — **not backed by any
 * FR/NFR or user story** (ADR-0020, TC-SHELL-014's own note), same status
 * as the base template's own demo content. Smoke-level content only: a
 * fixed sample of icons already installed in this codebase's `@coreui/icons`
 * dependency — no new icon package, per ADR-0020's explicit no-new-
 * dependency scope.
 *
 * Built with CoreUI (ADR-0012) — `CCard`/`CCol`/`CRow` + `CIcon` only.
 */
import { CCol, CContainer, CRow } from "@coreui/react";
import { CIcon } from "@coreui/icons-react";
import {
  cilBell,
  cilCheckCircle,
  cilColorPalette,
  cilContrast,
  cilFont,
  cilHome,
  cilList,
  cilMenu,
  cilMoon,
  cilSettings,
  cilSun,
  cilUser,
  cilWarning,
} from "@coreui/icons";

const SAMPLE_ICONS: Array<{ name: string; icon: string[] }> = [
  { name: "cilHome", icon: cilHome },
  { name: "cilUser", icon: cilUser },
  { name: "cilSettings", icon: cilSettings },
  { name: "cilBell", icon: cilBell },
  { name: "cilMenu", icon: cilMenu },
  { name: "cilList", icon: cilList },
  { name: "cilCheckCircle", icon: cilCheckCircle },
  { name: "cilWarning", icon: cilWarning },
  { name: "cilColorPalette", icon: cilColorPalette },
  { name: "cilFont", icon: cilFont },
  { name: "cilSun", icon: cilSun },
  { name: "cilMoon", icon: cilMoon },
  { name: "cilContrast", icon: cilContrast },
];

function Icons() {
  return (
    <CContainer className="py-4">
      <h1 className="fs-4 mb-3">Icons</h1>
      <CRow>
        {SAMPLE_ICONS.map(({ name, icon }) => (
          <CCol xs={6} sm={4} md={3} lg={2} className="mb-4 text-center" key={name}>
            <CIcon icon={icon} size="xl" />
            <div className="small text-body-secondary mt-1">{name}</div>
          </CCol>
        ))}
      </CRow>
    </CContainer>
  );
}

export default Icons;
