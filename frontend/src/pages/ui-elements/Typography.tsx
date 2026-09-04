/**
 * SHELL-8 (ADR-0019) "UI Elements" reference page: typography scale.
 * Template-parity scaffolding ONLY — **not backed by any FR/NFR or user
 * story** (ADR-0019, TC-SHELL-014's own note), same status as the base
 * template's own demo content. Smoke-level content only: headings, body
 * text, and a couple of common inline/list elements, no content-correctness
 * assertions expected.
 *
 * Built with CoreUI (ADR-0012) — `CCard`/`CContainer` plus plain semantic
 * HTML (headings/paragraph/list/code), styled by CoreUI's own Bootstrap-
 * family base CSS (not Tailwind).
 */
import { CCard, CCardBody, CContainer } from "@coreui/react";

function Typography() {
  return (
    <CContainer className="py-4">
      <h1 className="fs-4 mb-3">Typography</h1>
      <CCard>
        <CCardBody>
          <h1>Heading 1</h1>
          <h2>Heading 2</h2>
          <h3>Heading 3</h3>
          <h4>Heading 4</h4>
          <h5>Heading 5</h5>
          <h6>Heading 6</h6>
          <p>
            This is a body paragraph, styled by CoreUI&apos;s base typography rules — no bespoke font-size or
            line-height overrides.
          </p>
          <p>
            Inline <code>code</code>, a <strong>bold</strong> word, and an <em>emphasized</em> one.
          </p>
          <ul>
            <li>Unordered list item one</li>
            <li>Unordered list item two</li>
          </ul>
          <blockquote className="blockquote">
            <p className="mb-0">A blockquote example, CoreUI-styled.</p>
          </blockquote>
        </CCardBody>
      </CCard>
    </CContainer>
  );
}

export default Typography;
