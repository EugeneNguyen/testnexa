/**
 * ADR-0025: the surface's other page component — the dedicated `/edit`
 * route only (UI Design Document §2: create renders inside a `CModal` on
 * `EntityListPage` instead). Route:
 * `/orgs/:orgId/admin/:entity/:id/edit` or
 * `/projects/:projectId/admin/:entity/:id/edit`.
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CAlert, CCard, CCardBody, CSpinner } from "@coreui/react";
import EntityForm from "../../components/crud/EntityForm";
import { ApiError } from "../../lib/api/client";
import { EntityRow, getEntity, updateEntity } from "../../lib/api/entityCrud";
import { useAdminRouteContext } from "./useAdminRouteContext";

function fieldErrorsFrom(error: unknown): Record<string, string> | undefined {
  if (!(error instanceof ApiError)) {
    return undefined;
  }
  const body = error.body as { field_errors?: Record<string, string[]> } | undefined;
  if (!body?.field_errors) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(body.field_errors).map(([field, messages]) => [field, messages[0]]));
}

function EntityFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { entityKey, config } = useAdminRouteContext();

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>(undefined);

  const itemQuery = useQuery({
    queryKey: ["entity-item", entityKey, id],
    queryFn: () => getEntity<EntityRow>(config!, id as string),
    enabled: Boolean(config) && Boolean(id),
  });

  const updateMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => updateEntity(config!, id as string, values),
    onSuccess: () => navigate(-1),
    onError: (error: unknown) => {
      const errors = fieldErrorsFrom(error);
      if (errors) {
        setFieldErrors(errors);
      } else {
        setSubmitError(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
      }
    },
  });

  if (!config) {
    return (
      <CCard>
        <CCardBody>
          <CAlert color="danger" role="alert">
            Unknown admin entity &quot;{entityKey}&quot;.
          </CAlert>
        </CCardBody>
      </CCard>
    );
  }

  return (
    <CCard>
      <CCardBody>
        <h1 className="fs-4 mb-3">Edit {entityKey.replace(/-/g, " ")}</h1>

        {itemQuery.isLoading ? (
          <div className="d-flex justify-content-center py-4">
            <CSpinner color="primary" />
          </div>
        ) : itemQuery.isError ? (
          <CAlert color="danger" role="alert">
            Something went wrong loading this record.
          </CAlert>
        ) : (
          <EntityForm
            config={config}
            mode="edit"
            initialValues={itemQuery.data}
            submitError={submitError}
            serverFieldErrors={fieldErrors}
            onCancel={() => navigate(-1)}
            onSubmit={async (values) => {
              setSubmitError(null);
              setFieldErrors(undefined);
              await updateMutation.mutateAsync(values);
            }}
          />
        )}
      </CCardBody>
    </CCard>
  );
}

export default EntityFormPage;
