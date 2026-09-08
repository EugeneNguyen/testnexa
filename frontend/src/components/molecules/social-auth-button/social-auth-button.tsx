/**
 * `SocialAuthButton` molecule — composes `atoms/button` (`as="a"`) +
 * `atoms/icon`. Dedupes the source's 2 near-identical links (Facebook,
 * Google) into one parametrized component. Per this story's
 * Decomposition-stage comment on TNX-0056, item #10.
 */
import { Button, ButtonColor, ButtonProps } from "../../atoms/button";
import { Icon } from "../../atoms/icon";

export interface SocialAuthButtonProps {
  href: string;
  /** Bootstrap Icons name suffix, e.g. "facebook", "google". */
  icon: string;
  label: string;
  color: ButtonColor;
  onClick?: ButtonProps["onClick"];
  /** Appended last, for callers that need to adjust layout/spacing. */
  className?: string;
}

export function SocialAuthButton({ href, icon, label, color, onClick, className }: SocialAuthButtonProps) {
  return (
    <Button as="a" href={href} color={color} onClick={onClick} className={className}>
      <Icon name={icon} spaced />
      {label}
    </Button>
  );
}
