/**
 * DASH-3 dashboard org list + chooser (ADR-0063, UI Design Document,
 * supersedes DASH-1's empty placeholder, ADR-0035).
 *
 * Routed at `/dashboard`, global (no `:orgId` — no org is chosen yet at the
 * point a user reaches it) and `ProtectedRoute`-wrapped like every other
 * authenticated screen (unchanged from DASH-1). On mount, fetches the
 * caller's active org memberships fresh via `GET /auth/me/orgs`
 * (`getMyOrgs`, unchanged since SHELL-6/ADR-0036) — deliberately never reads
 * `AuthContext.orgs`, which is populated only at login/signup/accept-invite
 * time and never refreshed afterward (the AUTH-2 gap NFR-35 already
 * documents), so a reload landing here would otherwise see a stale/empty
 * list.
 *
 * Branches on the fetch result:
 * - 0 orgs: empty state + a "Create organization" CTA (reuses `POST /orgs`,
 *   the same call `OrgPicker.tsx` used to make — no new backend surface).
 * - exactly 1 org: no render at all — immediately `navigate()`s to
 *   `/orgs/{id}`, replacing history so the back button doesn't return here.
 * - 2+ orgs: a "Select an organization" card list; clicking a card
 *   navigates to `/orgs/{id}`. A "Create organization" affordance stays
 *   available here too (same posture `OrgPicker` already had — pick or
 *   create together).
 *
 * `/orgs/pick`/`OrgPicker.tsx` are retired by this same story — this screen
 * now owns 100% of "list orgs, let the user pick or create one," reached
 * uniformly via `/dashboard` regardless of whether the visit came from `/`'s
 * root guard or a post-login/signup/accept-invite redirect (`Login.tsx`/
 * `Signup.tsx`/`AcceptInvite.tsx` all now navigate here unconditionally).
 *
 * Heading text is deliberately never the literal word "Dashboard" — this
 * incidentally softens (does not resolve) the separate `/dashboard`-vs-
 * `OrgHome` "Dashboard" naming overlap (ADR-0039/NFR-49), which stays an
 * open, accepted, unrelated issue.
 */
import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../../lib/api/client";
import { getMyOrgs, OrgSummary } from "../../../lib/api/auth";
import { createOrg } from "../../../lib/api/organizations";
import { Card, Alert, Button, Modal, Spinner } from "../../../components";

const SLUG_PATTERN = /^[a-z0-9-]+$/;

type LoadState = "loading" | "empty" | "list" | "error";

function Dashboard() {
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>("loading");
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState("loading");

    getMyOrgs()
      .then((response) => {
        if (cancelled) return;
        if (response.orgs.length === 1) {
          navigate(`/orgs/${response.orgs[0].id}`, { replace: true });
          return;
        }
        setOrgs(response.orgs);
        setState(response.orgs.length === 0 ? "empty" : "list");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

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

  const createOrgModal = (
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
  );

  if (state === "loading") {
    return (
      <div className="container-fluid h-100">
        <Spinner wrapperClassName="py-5" />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="container-fluid h-100">
        <Alert color="danger">Couldn't load your organizations. Please try reloading the page.</Alert>
      </div>
    );
  }

  if (state === "empty") {
    return (
      <div className="container-fluid h-100">
        <Card>
          <Card.Body className="p-4">
            <h1 className="mb-3 fs-4">No organizations yet</h1>
            <p className="text-body-secondary">You don't belong to an organization yet.</p>
            <Button color="primary" onClick={openModal}>
              Create organization
            </Button>
          </Card.Body>
        </Card>
        {createOrgModal}
      </div>
    );
  }

  return (
    <div className="container-fluid h-100">
      <Card>
        <Card.Body className="p-4">
          <h1 className="mb-3 fs-4">Select an organization</h1>
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
          <Button color="secondary" outline onClick={openModal}>
            Create organization
          </Button>
        </Card.Body>
      </Card>
      {createOrgModal}
    </div>
  );
}

export default Dashboard;
