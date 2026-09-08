/**
 * `SocialAuthPanel` molecule — the "- OR -" divider + N `social-auth-button`s.
 * Per this story's Decomposition-stage comment on TNX-0056, item #11.
 *
 * Generic over `providers` (not hardcoded to Facebook/Google) so it stays
 * reusable if a future screen offers a different provider set — this
 * screen's own Wire-up stage supplies the concrete Facebook/Google list.
 * Drops AdminLTE's own `social-auth-links` class (no `coreui.min.css` rule
 * references it, per the Style-Translation stage comment) — the source's
 * visual layout is reproduced by `text-center`/`mb-3` here plus the button
 * stacking below.
 *
 * **Reuse fix (Verify & Review stage, sent back to Scaffold):** the button
 * stack itself is `molecules/button-stack`'s `layout="stacked"` job
 * (`d-grid gap-2`) — composed here instead of a second, hand-rolled copy of
 * the same class string. `ButtonStack`'s "stacked" layout passes children
 * through unmodified (its `cloneElement`/`me-md-2` logic only applies to
 * `layout="inline-end"`), so it's a safe drop-in for `SocialAuthButton`
 * children.
 *
 * Renders nothing for an empty `providers` array (added during the Wire-up
 * stage: TestNexa's own `Login.tsx` has no OAuth providers to offer, ADR-0003
 * is password-only — an "- OR -" divider with zero buttons below it would be
 * a dead affordance, not a faithful "no providers configured" state).
 */
import { ButtonStack } from "../button-stack";
import { SocialAuthButton, SocialAuthButtonProps } from "../social-auth-button";

export interface SocialAuthPanelProps {
  providers: SocialAuthButtonProps[];
  /** Text shown above the provider buttons — defaults to the source's own "- OR -". */
  dividerText?: string;
  /** Appended last, for callers that need to adjust layout/spacing. */
  className?: string;
}

export function SocialAuthPanel({ providers, dividerText = "- OR -", className }: SocialAuthPanelProps) {
  if (providers.length === 0) {
    return null;
  }

  const classNames = ["text-center", "mb-3", className].filter(Boolean).join(" ");

  return (
    <div className={classNames}>
      <p>{dividerText}</p>
      <ButtonStack layout="stacked">
        {providers.map((provider) => (
          <SocialAuthButton key={provider.href} {...provider} />
        ))}
      </ButtonStack>
    </div>
  );
}
