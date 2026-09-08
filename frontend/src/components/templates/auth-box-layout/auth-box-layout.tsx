/**
 * `AuthBoxLayout` template — `brand-logo` + `card` wrapping a children slot.
 * Per this story's Decomposition-stage comment on TNX-0056, item #14.
 *
 * Confirmed genuinely reusable (not speculative): AdminLTE's `register.html`
 * / `forgot-password.html` example pages (not yet built in this repo) share
 * this identical wrapper shape. Replaces AdminLTE's own `.login-page`/
 * `.login-box`/`.login-card-body` (not loaded — `adminlte.css` isn't a
 * dependency here) with Bootstrap-utility equivalents already proven in
 * this repo's own `pages/workflows/Login.tsx`.
 */
import { ReactNode } from "react";
import { BrandLogo } from "../../atoms/brand-logo";
import { Card } from "../../atoms/card";

export interface AuthBoxLayoutProps {
  /** Href for the brand wordmark link. */
  logoHref: string;
  children: ReactNode;
  /** Appended last, to the outermost wrapper. */
  className?: string;
}

export function AuthBoxLayout({ logoHref, children, className }: AuthBoxLayoutProps) {
  const wrapperClassNames = ["min-vh-100", "d-flex", "align-items-center", "bg-body-secondary", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapperClassNames}>
      <div className="container">
        <div className="row justify-content-center">
          <div className="col-md-6 col-lg-4">
            <BrandLogo href={logoHref} />
            <Card bodyClassName="p-4">{children}</Card>
          </div>
        </div>
      </div>
    </div>
  );
}
