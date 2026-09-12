/**
 * Single barrel for the whole atomic-design component system (ADR-0043:
 * atoms/molecules/organisms/templates). Every reusable component in
 * `components/` is re-exported from here — this is the only import line a
 * consumer outside `components/` should need:
 *
 * ```tsx
 * import { Alert, Button, Card, Modal } from "../../../components";
 * ```
 *
 * Internal cross-imports (an organism composing a molecule, a template
 * composing organisms, etc.) still use direct relative paths between
 * sibling component folders — importing this barrel from *inside*
 * `components/` would be circular, since this file imports every component.
 *
 * A default-exported component (no named export in its own source) is
 * re-exported here under the same name every existing call site already
 * uses for it (`FkAutocomplete`, `FormField`, `ScopeSelector`,
 * `AppBreadcrumb`, `AppFooter`, `AppHeader`, `AppSidebar`, `EntityForm`,
 * `EntityTable`, `AppShell`) so this is a pure re-export, not a rename.
 *
 * When adding a new atom/molecule/organism/template, add its export line
 * here in the same pass — this file is the checklist of "every component
 * that exists," not just an import convenience.
 */

// atoms
export * from "./atoms/alert";
export * from "./atoms/brand-logo";
export * from "./atoms/button";
export * from "./atoms/card";
export * from "./atoms/checkbox";
export * from "./atoms/icon";
export * from "./atoms/select";
export * from "./atoms/spinner";
export * from "./atoms/text-input";
export * from "./atoms/text-link";

// molecules
export * from "./molecules/button-stack";
export * from "./molecules/featured-card";
export { default as FkAutocomplete } from "./molecules/fk-autocomplete";
export type { FkAutocompleteProps } from "./molecules/fk-autocomplete";
export { default as FormField } from "./molecules/form-field";
export type { FormFieldProps } from "./molecules/form-field";
export * from "./molecules/icon-input-group";
export * from "./molecules/info-box";
export * from "./molecules/labeled-checkbox";
export * from "./molecules/modal";
export * from "./molecules/pagination";
export { default as ScopeSelector } from "./molecules/scope-selector";
export type { ScopeSelectorProps } from "./molecules/scope-selector";
export * from "./molecules/social-auth-button";
export * from "./molecules/social-auth-panel";

// organisms
export { default as AppBreadcrumb } from "./organisms/app-breadcrumb";
export { default as AppFooter } from "./organisms/app-footer";
export { default as AppHeader } from "./organisms/app-header";
export { default as AppSidebar } from "./organisms/app-sidebar";
export { default as EntityForm } from "./organisms/entity-form";
export type { EntityFormProps } from "./organisms/entity-form";
export { default as EntityTable } from "./organisms/entity-table";
export type { EntityTableProps } from "./organisms/entity-table";
export * from "./organisms/login-form";
export * from "./organisms/login-panel";

// templates
export { default as AppShell } from "./templates/app-shell";
export * from "./templates/auth-box-layout";
