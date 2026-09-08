/**
 * `LoginPanel` organism — the full `card-body` content: message text,
 * `login-form`, `social-auth-panel`, and the 2 footer `text-link`s. Per
 * this story's Decomposition-stage comment on TNX-0056, item #13.
 *
 * Login-specific (not generalized for register/forgot-password), per the
 * Decomposition stage's open question 3 default. **Presentational only** —
 * see `login-form`'s own doc comment; this organism just forwards its props
 * straight through.
 *
 * Doesn't render an error alert — the source AdminLTE markup has none, and
 * the current `pages/workflows/Login.tsx`'s CoreUI `CAlert` for API-failure
 * messages is a separate, pre-existing page-level concern, not part of this
 * decomposition. `LoginForm`'s `errorSlot` prop is where the Wire-up stage
 * can pass that through if needed.
 */
import { LoginForm, LoginFormProps } from "../login-form";
import { SocialAuthPanel, SocialAuthPanelProps } from "../../molecules/social-auth-panel";
import { TextLink } from "../../atoms/text-link";

export interface LoginPanelProps {
  message?: string;
  loginFormProps: LoginFormProps;
  socialAuthProviders: SocialAuthPanelProps["providers"];
  forgotPasswordHref: string;
  registerHref: string;
}

export function LoginPanel({
  message = "Sign in to start your session",
  loginFormProps,
  socialAuthProviders,
  forgotPasswordHref,
  registerHref,
}: LoginPanelProps) {
  return (
    <>
      <p className="text-center mb-3">{message}</p>
      <LoginForm {...loginFormProps} />
      <SocialAuthPanel providers={socialAuthProviders} />
      <p className="mb-1">
        <TextLink href={forgotPasswordHref}>I forgot my password</TextLink>
      </p>
      <p className="mb-0">
        <TextLink href={registerHref} centered>
          Register a new membership
        </TextLink>
      </p>
    </>
  );
}
