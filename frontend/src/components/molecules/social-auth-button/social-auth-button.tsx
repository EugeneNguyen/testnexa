/**
 * `SocialAuthButton` molecule — composes `atoms/button` (`as="a"`) +
 * `atoms/icon`. Dedupes the source's 2 near-identical links (Facebook,
 * Google) into one parametrized component. Per this story's
 * Decomposition-stage comment on TNX-0056, item #10.
 */
import { Button, ButtonColor, ButtonProps } from "../../atoms/button";
import { Icon, IconVariant } from "../../atoms/icon";

export interface SocialAuthButtonProps {
  href: string;
  /** Font Awesome name suffix, e.g. "facebook", "google" (ADR-0042). */
  icon: string;
  /**
   * Font Awesome style for `icon`. Defaults to `"brands"` — every provider a
   * social-auth button can plausibly represent (Facebook, Google, GitHub,
   * Apple, ...) is a third-party logo, and those glyphs live ONLY in Font
   * Awesome's `fa-brands` font; they do not exist in `fa-solid`, so the
   * atom's own `"solid"` default would render nothing here.
   */
  iconVariant?: IconVariant;
  label: string;
  color: ButtonColor;
  onClick?: ButtonProps["onClick"];
  /** Appended last, for callers that need to adjust layout/spacing. */
  className?: string;
}

export function SocialAuthButton({
  href,
  icon,
  iconVariant = "brands",
  label,
  color,
  onClick,
  className,
}: SocialAuthButtonProps) {
  return (
    <Button as="a" href={href} color={color} onClick={onClick} className={className}>
      <Icon name={icon} variant={iconVariant} spaced />
      {label}
    </Button>
  );
}
