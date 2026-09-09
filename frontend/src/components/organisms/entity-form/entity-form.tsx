/**
 * `components/organisms/` (ADR-0043, superseding ADR-0023's `components/crud/`
 * location). UI Design Document §2/§3: one input per
 * `fields[]` entry, type-dispatched, React Hook Form + a Zod schema built
 * from `fields[]` (`required` -> `.min(1)`/non-optional; `enum` ->
 * `z.enum(values)`; `fk` -> `z.string().uuid()`; `date` -> a non-empty ISO
 * date string). Bound via `register()` spread only, matching this
 * codebase's own established convention (`FormField.tsx`'s docstring,
 * `OrgHome.tsx`/`ProjectDetail.tsx`) — never RHF's `Controller`. `fk` fields
 * are the one exception: `FkAutocomplete` isn't a plain native input, so its
 * value is wired via `watch`/`setValue` instead, still without `Controller`.
 *
 * `string`/`date` fields reuse `FormField` (`components/molecules/form-field/`)
 * directly, per ADR-0023's still-binding error-display convention;
 * `enum`/`boolean` fields hand-roll the same label + input + invalid-feedback
 * shape inline (not a second convention — just not promoted to their own
 * molecule, since DS-1's own scope names `FormField` as the only inhabitant
 * there today).
 *
 * **ADR-0042 (CoreUI -> AdminLTE v4):** the markup is raw Bootstrap 5 now —
 * `CForm` -> `<form>`, `CFormLabel` -> `<label class="form-label">`,
 * `CFormInput` -> `<input class="form-control">`, `CFormSelect` ->
 * `<select class="form-select">` (`invalid` -> the `is-invalid` class),
 * `CFormSwitch` -> Bootstrap's `form-check form-switch` block, `CFormFeedback
 * invalid` -> `<div class="invalid-feedback d-block">`, `CAlert` -> `<div
 * class="alert alert-danger" role="alert">`, `CButton` -> `<button
 * class="btn btn-*">`. **React Hook Form + Zod are untouched** — every
 * `register(field.name)` spread lands on the same native element CoreUI was
 * forwarding it to, so `name`/`onChange`/`onBlur`/`ref` wiring, the Zod
 * resolver, and `serverFieldErrors` mapping all behave identically. The
 * `d-block` on the feedback div is load-bearing: Bootstrap only reveals a
 * bare `.invalid-feedback` as the adjacent sibling of an `.is-invalid`
 * control, and these render conditionally in a separate position.
 *
 * Fields marked `readOnly` (`entityConfigs/types.ts`) or present in
 * `lockedValues` (a scope field already fixed by route/scope-selector
 * context, e.g. `project_id`) render as plain disabled display, never part
 * of the Zod schema or the submitted payload — `lockedValues` are merged
 * into the payload directly by the caller (`EntityFormPage`) only on
 * `create`, matching the backend's own "scope fields aren't reassignable
 * through `update`" posture (every `Update*Request` schema omits them).
 */
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z, ZodTypeAny } from "zod";
import FormField from "../../molecules/form-field";
import { EntityConfig, FieldConfig } from "../../../entityConfigs/types";
import FkAutocomplete from "../../molecules/fk-autocomplete";

export interface EntityFormProps {
  config: EntityConfig;
  mode: "create" | "edit";
  initialValues?: Record<string, unknown>;
  /** Scope field(s) already fixed by route/scope-selector context — rendered disabled, never user-editable. */
  lockedValues?: Record<string, string>;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
  /** Non-field API error (network failure, unexpected 4xx/5xx) — same inline-alert posture every other form in this codebase uses. */
  submitError?: string | null;
  /** `422 error.body.field_errors`, mapped onto the matching RHF field. */
  serverFieldErrors?: Record<string, string>;
}

function isLocked(field: FieldConfig, lockedValues?: Record<string, string>): boolean {
  return Boolean(lockedValues && field.name in lockedValues);
}

function buildFieldSchema(field: FieldConfig): ZodTypeAny {
  switch (field.type) {
    case "enum": {
      const values = (field.values ?? []) as [string, ...string[]];
      if (values.length === 0) {
        return z.string().optional();
      }
      return field.required ? z.enum(values) : z.union([z.enum(values), z.literal("")]).optional();
    }
    case "fk": {
      const uuid = z.string().uuid({ message: `${field.label} must be a valid selection.` });
      return field.required ? uuid : z.union([uuid, z.literal("")]).optional();
    }
    case "date": {
      const required = z.string().min(1, `${field.label} is required.`);
      return field.required ? required : z.string().optional();
    }
    case "boolean":
      return z.boolean().optional();
    case "string":
    default: {
      const required = z.string().trim().min(1, `${field.label} is required.`);
      return field.required ? required : z.string().optional();
    }
  }
}

function buildSchema(fields: FieldConfig[]) {
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.name] = buildFieldSchema(field);
  }
  return z.object(shape);
}

function defaultValueFor(field: FieldConfig, initialValues?: Record<string, unknown>): unknown {
  const raw = initialValues?.[field.name];
  if (field.type === "boolean") {
    return Boolean(raw);
  }
  return raw === null || raw === undefined ? "" : String(raw);
}

function EntityForm({
  config,
  mode,
  initialValues,
  lockedValues,
  onSubmit,
  onCancel,
  submitError,
  serverFieldErrors,
}: EntityFormProps) {
  const editableFields = config.fields.filter((f) => !f.readOnly && !isLocked(f, lockedValues));
  const displayOnlyFields = config.fields.filter((f) => f.readOnly || isLocked(f, lockedValues));

  const schema = buildSchema(editableFields);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues: Object.fromEntries(editableFields.map((f) => [f.name, defaultValueFor(f, initialValues)])),
  });

  useEffect(() => {
    if (!serverFieldErrors) {
      return;
    }
    for (const [field, message] of Object.entries(serverFieldErrors)) {
      setError(field, { type: "server", message });
    }
  }, [serverFieldErrors, setError]);

  function fieldError(field: FieldConfig): string | undefined {
    const rhfMessage = errors[field.name]?.message as string | undefined;
    return rhfMessage ?? serverFieldErrors?.[field.name];
  }

  function renderEditable(field: FieldConfig) {
    const error = fieldError(field);
    switch (field.type) {
      case "string":
        return <FormField key={field.name} id={field.name} label={field.label} error={error} {...register(field.name)} />;
      case "date":
        return (
          <FormField key={field.name} id={field.name} label={field.label} type="date" error={error} {...register(field.name)} />
        );
      case "enum":
        return (
          <div className="mb-3" key={field.name}>
            <label className="form-label" htmlFor={field.name}>
              {field.label}
            </label>
            <select
              className={`form-select${error ? " is-invalid" : ""}`}
              id={field.name}
              {...register(field.name)}
            >
              <option value="">Select...</option>
              {(field.values ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            {error && (
              <div className="invalid-feedback d-block" role="alert">
                {error}
              </div>
            )}
          </div>
        );
      case "boolean":
        return (
          <div className="mb-3" key={field.name}>
            <div className="form-check form-switch">
              <input
                className="form-check-input"
                type="checkbox"
                role="switch"
                id={field.name}
                {...register(field.name)}
              />
              <label className="form-check-label" htmlFor={field.name}>
                {field.label}
              </label>
            </div>
          </div>
        );
      case "fk":
        return (
          <FkAutocomplete
            key={field.name}
            id={field.name}
            label={field.label}
            refEntity={field.refEntity ?? ""}
            labelField={field.labelField}
            value={watch(field.name) as string | undefined}
            onChange={(id) => setValue(field.name, id ?? "", { shouldValidate: true })}
            error={error}
          />
        );
      default:
        return null;
    }
  }

  function renderDisplayOnly(field: FieldConfig) {
    const value = lockedValues?.[field.name] ?? initialValues?.[field.name];
    if (field.type === "fk") {
      return (
        <FkAutocomplete
          key={field.name}
          id={field.name}
          label={field.label}
          refEntity={field.refEntity ?? ""}
          labelField={field.labelField}
          value={typeof value === "string" ? value : undefined}
          onChange={() => {}}
          disabled
        />
      );
    }
    return (
      <div className="mb-3" key={field.name}>
        <label className="form-label" htmlFor={`${field.name}-readonly`}>
          {field.label}
        </label>
        <input
          className="form-control"
          type="text"
          id={`${field.name}-readonly`}
          value={value === null || value === undefined ? "" : String(value)}
          disabled
        />
      </div>
    );
  }

  async function handleFormSubmit(values: Record<string, unknown>) {
    const payload: Record<string, unknown> = { ...values };
    if (mode === "create" && lockedValues) {
      Object.assign(payload, lockedValues);
    }
    for (const field of editableFields) {
      if (payload[field.name] === "") {
        payload[field.name] = null;
      }
    }
    await onSubmit(payload);
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} noValidate>
      {displayOnlyFields.map(renderDisplayOnly)}
      {editableFields.map(renderEditable)}
      {submitError && (
        <div className="alert alert-danger" role="alert">
          {submitError}
        </div>
      )}
      <div className="d-flex gap-2 justify-content-end">
        {onCancel && (
          <button type="button" className="btn btn-outline-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : mode === "create" ? "Create" : "Save"}
        </button>
      </div>
    </form>
  );
}

export default EntityForm;
