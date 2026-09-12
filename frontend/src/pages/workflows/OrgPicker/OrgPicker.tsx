/**
 * AUTH-1 org picker: shown after login resolves `org_context: "picker"`
 * (more than one active org membership). Reads `orgs` from `useAuth()` and
 * renders a clickable list (name + slug); picking one navigates to
 * `/orgs/{org.id}`. If `orgs` is empty — e.g. a direct navigation to this
 * route without having logged in first — redirects back to `/login`.
 *
 * RBAC-1/ADR-0016 AC2: adds a small "New Organization" action — a Bootstrap
 * modal with `name`/`slug` inputs calling `createOrg` (`POST /orgs`). This
 * is the already-authenticated-org_admin path (distinct from `Signup.tsx`'s
 * bootstrap-only `POST /auth/signup`). On success, navigates straight to
 * the newly created org (`/orgs/{new org.id}`) rather than trying to splice
 * it into this screen's own `orgs` list — that list is `AuthContext` state
 * populated only by `login()`/`signup()`'s response and has no setter
 * exposed for a one-off addition; the new org is fully usable via direct
 * navigation regardless (the access token alone is what `/orgs/:orgId`
 * needs), so there's nothing missing by not updating the list here. A
 * `403 permission_denied` (no `organization.create` grant anywhere) or
 * `422` (slug collision) is shown inline in the modal.
 *
 * Built with raw Bootstrap 5 / AdminLTE markup (ADR-0042, superseding the
 * CoreUI build of ADR-0012) — `list-group`/`list-group-item-action` for the
 * org list, and a hand-rolled `.modal` for the create dialog. The modal is
 * rendered only while open (matching `CModal`'s own unmount-when-hidden
 * behavior, which the negative `queryBy*` assertions in this screen's e2e
 * coverage rely on) and closes on ESC, which was `CModal`'s default
 * `keyboard` behavior. Focus trapping is a deliberate, accepted gap
 * (ADR-0042).
 */
import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/AuthContext";
import { ApiError } from "../../../lib/api/client";
import { createOrg } from "../../../lib/api/organizations";
import { Card, Alert, Button, Modal } from "../../../components";

const SLUG_PATTERN = /^[a-z0-9-]+$/;

function OrgPicker() {
  const { orgs } = useAuth();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (orgs.length === 0) {
      navigate("/login", { replace: true });
    }
  }, [orgs, navigate]);

  function openModal() {
    setNewOrgName("");
    setNewOrgSlug("");
    setCreateError(null);
    setShowModal(true);
  }

  async function handleCreateOrg(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);

    if (!SLUG_PATTERN.test(newOrgSlug)) {
      setCreateError("Slug may only contain lowercase letters, numbers, and hyphens.");
      return;
    }

    setCreating(true);
    try {
      const org = await createOrg({ name: newOrgName, slug: newOrgSlug });
      setShowModal(false);
      navigate(`/orgs/${org.id}`);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  if (orgs.length === 0) {
    return null;
  }

  return (
    <div className="min-vh-100 d-flex align-items-center">
      <div className="container">
        <div className="row justify-content-center">
          <div className="col-md-8 col-lg-5">
            <Card>
              <Card.Body className="p-4">
                <h1 className="mb-3 fs-4">Choose an organization</h1>
                {/*
                 * Bootstrap's own documented markup for an *actionable* list
                 * group is `div.list-group` wrapping `button.list-group-item`
                 * — not `ul`/`li`, which cannot legally contain a `<button>`
                 * as a direct child. This matches what `CListGroup` rendered
                 * for `CListGroupItem as="button"` children.
                 */}
                <div className="list-group mb-3">
                  {orgs.map((org) => (
                    <button
                      key={org.id}
                      type="button"
                      onClick={() => navigate(`/orgs/${org.id}`)}
                      className="list-group-item list-group-item-action text-start"
                    >
                      <div className="fw-semibold">{org.name}</div>
                      <div className="text-body-secondary small">{org.slug}</div>
                    </button>
                  ))}
                </div>
                <Button color="secondary" outline className="w-100" onClick={openModal}>
                  New Organization
                </Button>
              </Card.Body>
            </Card>
          </div>
        </div>
      </div>

      <Modal visible={showModal} title="New Organization" onClose={() => setShowModal(false)}>
        <form onSubmit={handleCreateOrg}>
          <Modal.Body>
            <div className="mb-3">
              <label className="form-label" htmlFor="newOrgName">
                Name
              </label>
              <input
                className="form-control"
                id="newOrgName"
                type="text"
                required
                value={newOrgName}
                onChange={(event) => setNewOrgName(event.target.value)}
              />
            </div>
            <div className="mb-3">
              <label className="form-label" htmlFor="newOrgSlug">
                Slug
              </label>
              <input
                className="form-control"
                id="newOrgSlug"
                type="text"
                required
                value={newOrgSlug}
                onChange={(event) => setNewOrgSlug(event.target.value)}
              />
              <div className="form-text">Lowercase letters, numbers, and hyphens only.</div>
            </div>
            {createError && <Alert color="danger">{createError}</Alert>}
          </Modal.Body>
          <Modal.Footer>
            <Button color="secondary" outline onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button type="submit" color="primary" disabled={creating}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>
    </div>
  );
}

export default OrgPicker;
