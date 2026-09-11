/**
 * RBAC-2 org member management screen (ADR-0017): list an org's members,
 * invite a new one by email, suspend/reactivate an active/suspended member,
 * revoke a still-pending invite.
 *
 * Originally built with CoreUI (ADR-0012) — CTable/CCard/CForm/CFormInput/
 * CButton/CAlert/CBadge only, no hand-rolled table/badge markup. **ADR-0042
 * (2026-09-08)** replaces CoreUI with AdminLTE v4, so those components are
 * now raw Bootstrap 5 markup written out directly (`table.table` inside a
 * `div.table-responsive`, `div.card`, `input.form-control`, `button.btn`,
 * `div.alert[role=alert]`, `span.badge.bg-*`). React Hook Form + Zod still
 * own the invite form's state/validation, binding to the raw `<input>` the
 * same way every other form in this codebase does its client-side
 * validation — only the rendered element changed, not the wiring.
 *
 * Two deliberate markup details here, both load-bearing:
 * - the members `<table>` gets **no `table-hover`** — the CoreUI original
 *   passed `responsive` only, so only the `div.table-responsive` wrapper
 *   carries over;
 * - the two invite-success `div.alert-success` blocks carry **no
 *   `role="alert"`**, matching the `CAlert`s they replace (which were
 *   written without one). Adding one would give this screen two
 *   alert-role nodes at once and turn a singular `getByRole("alert")` into
 *   a strict-mode multiple-match failure.
 *
 * Permission gating: unlike `Login`/`Signup`/`OrgPicker`, this repo has no
 * existing client-side signal of the current actor's *permissions* to reuse
 * — `AuthContext`'s `orgs` are `{id, name, slug}` only (no role/permission
 * field), and `GET /auth/me` deliberately ships identity-only, its "+
 * resolved permission codes" contract explicitly deferred (API Document §2)
 * until a story exists to resolve permission codes for the frontend at all.
 * RBAC-2 doesn't add that route. So this page can't pre-emptively hide
 * itself for a non-`org_admin` the way a client-side role flag would allow;
 * instead it attempts `GET /orgs/{org_id}/members` (`org_membership.read`,
 * `org_admin`-only per RBAC-4's seeded bundles) and, on a `403
 * permission_denied` (or the `404` NFR-19 cross-tenant/no-membership case),
 * renders only that error and never mounts the invite form or per-row
 * action buttons — the backend's `require_permission` check is the actual
 * gate, this is just not rendering controls a `403` would immediately
 * reject anyway. Per-row mutation calls (invite/suspend/reactivate/revoke)
 * are otherwise attempted unconditionally once the list loads and surface
 * any `403`/`422` inline, the same `ApiError.message`-inline convention
 * every other screen in this codebase uses (`Login`/`Signup`/`OrgPicker`).
 */
import { FormEvent as ReactFormEvent, useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useParams } from "react-router-dom";
import { ApiError } from "../../lib/api/client";
import {
  InviteMemberResponse,
  OrgMember,
  inviteMember,
  listMembers,
  revokeInvite,
  updateMembershipStatus,
} from "../../lib/api/members";

const inviteSchema = z.object({
  email: z.string().email("Enter a valid email address."),
});

type InviteFormValues = z.infer<typeof inviteSchema>;

interface InviteSuccessState extends InviteMemberResponse {
  email: string;
}

function statusColor(status: OrgMember["status"]): "success" | "warning" | "secondary" {
  if (status === "active") return "success";
  if (status === "suspended") return "warning";
  return "secondary";
}

function formatJoinedAt(joinedAt: string | null): string {
  if (!joinedAt) return "—";
  const date = new Date(joinedAt);
  return Number.isNaN(date.getTime()) ? joinedAt : date.toLocaleDateString();
}

function OrgMembers() {
  const { orgId } = useParams<{ orgId: string }>();

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [inviteResult, setInviteResult] = useState<InviteSuccessState | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingMembershipId, setPendingMembershipId] = useState<string | null>(null);
  // Per-row feedback for the "Copy link" action on a pending (`invited`)
  // member — keyed by membership_id so multiple pending rows track
  // independently. "no-link" covers the existing-user invite path, which
  // never has a token/link to copy (see handleCopyRowLink).
  const [rowCopyStatus, setRowCopyStatus] = useState<
    Record<string, "copied" | "error" | "no-link" | undefined>
  >({});

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteFormValues>({ resolver: zodResolver(inviteSchema) });

  const fetchMembers = useCallback(async () => {
    if (!orgId) return;
    try {
      const result = await listMembers(orgId);
      setMembers(result.items);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void fetchMembers();
  }, [fetchMembers]);

  async function onInviteSubmit(values: InviteFormValues) {
    if (!orgId) return;
    setInviteError(null);
    setInviteResult(null);
    setCopied(false);
    setIsInviting(true);
    try {
      const result = await inviteMember(orgId, { email: values.email });
      setInviteResult({ ...result, email: values.email });
      reset();
      await fetchMembers();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsInviting(false);
    }
  }

  async function handleSuspend(member: OrgMember) {
    if (!orgId) return;
    setActionError(null);
    setPendingMembershipId(member.membership_id);
    try {
      await updateMembershipStatus(orgId, member.membership_id, "suspended");
      await fetchMembers();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPendingMembershipId(null);
    }
  }

  async function handleReactivate(member: OrgMember) {
    if (!orgId) return;
    setActionError(null);
    setPendingMembershipId(member.membership_id);
    try {
      await updateMembershipStatus(orgId, member.membership_id, "active");
      await fetchMembers();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPendingMembershipId(null);
    }
  }

  async function handleRevoke(member: OrgMember) {
    if (!orgId) return;
    setActionError(null);
    setPendingMembershipId(member.membership_id);
    try {
      await revokeInvite(orgId, member.membership_id);
      await fetchMembers();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPendingMembershipId(null);
    }
  }

  // `navigator.clipboard` only exists in a secure context (HTTPS, or
  // `localhost`/`127.0.0.1`) — a plain-HTTP LAN-IP origin (this app's own
  // documented "access via the host's LAN IP" mode, ADR-0010) never gets it,
  // so the fallback below is the *expected* path there, not just a rare
  // permission-denial edge case. Shared by both the just-created invite's
  // "Copy" button and each pending row's "Copy link" action.
  async function copyToClipboard(link: string): Promise<boolean> {
    if (window.isSecureContext && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(link);
        return true;
      } catch {
        // Fall through to the legacy fallback below.
      }
    }

    // Legacy fallback: a temporary, off-screen textarea + `execCommand`,
    // which works over plain HTTP. Self-contained (no visible field
    // required), so it works for a row copy just as well as the invite
    // form's own displayed link.
    const textarea = document.createElement("textarea");
    textarea.value = link;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let succeeded = false;
    try {
      succeeded = document.execCommand("copy");
    } catch {
      succeeded = false;
    }
    document.body.removeChild(textarea);
    return succeeded;
  }

  async function handleCopyLink(link: string) {
    setCopyError(false);
    const succeeded = await copyToClipboard(link);
    if (succeeded) {
      setCopied(true);
    } else {
      setCopyError(true);
    }
  }

  async function handleCopyRowLink(member: OrgMember) {
    if (!orgId) return;
    setActionError(null);
    setPendingMembershipId(member.membership_id);
    setRowCopyStatus((prev) => ({ ...prev, [member.membership_id]: undefined }));
    try {
      // RBAC-2 never re-exposes a previously-issued invite token (same
      // one-time-secret pattern as an AIAgent API key) — the only way to get
      // a usable link for an already-pending invite is to resend it, which
      // mints a fresh token and invalidates the old one (ADR-0017; the old
      // link stops working the moment this succeeds).
      const result = await inviteMember(orgId, { email: member.email });
      if (result.invite_link) {
        const succeeded = await copyToClipboard(result.invite_link);
        setRowCopyStatus((prev) => ({
          ...prev,
          [member.membership_id]: succeeded ? "copied" : "error",
        }));
      } else {
        // Existing-user invite path — never had a token/link to begin with.
        setRowCopyStatus((prev) => ({ ...prev, [member.membership_id]: "no-link" }));
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPendingMembershipId(null);
    }
  }

  return (
    <div className="min-vh-100 py-4">
      <div className="container-fluid px-4">
        <div className="row justify-content-center">
          <div className="col-12 col-lg-9">
            <h1 className="fs-4 mb-4">Members</h1>

            {isLoading && (
              <div className="d-flex align-items-center gap-2">
                {/* `CSpinner` carried `role="status"` implicitly (ADR-0042 §4.5.5) — a raw div must say so. */}
                <div className="spinner-border spinner-border-sm text-primary" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
                <span>Loading members...</span>
              </div>
            )}

            {!isLoading && loadError && (
              <div className="alert alert-danger" role="alert">
                {loadError}
              </div>
            )}

            {!isLoading && !loadError && (
              <>
                <div className="card mb-4">
                  <div className="card-body">
                    <h2 className="fs-6 mb-3">Invite by email</h2>
                    <form
                      noValidate
                      onSubmit={(event: ReactFormEvent<HTMLFormElement>) => {
                        void handleSubmit(onInviteSubmit)(event);
                      }}
                    >
                      <div className="row g-2 align-items-start">
                        <div className="col-12 col-sm-8">
                          <label className="form-label" htmlFor="invite-email">
                            Invite by email
                          </label>
                          <input
                            id="invite-email"
                            type="email"
                            className={`form-control${errors.email ? " is-invalid" : ""}`}
                            {...register("email")}
                          />
                          {errors.email && (
                            <div className="invalid-feedback d-block">{errors.email.message}</div>
                          )}
                        </div>
                        <div className="col-12 col-sm-4 d-flex align-items-end">
                          <button type="submit" className="btn btn-primary w-100" disabled={isInviting}>
                            {isInviting ? "Sending..." : "Send invite"}
                          </button>
                        </div>
                      </div>
                    </form>

                    {inviteError && (
                      <div className="alert alert-danger mt-3 mb-0" role="alert">
                        {inviteError}
                      </div>
                    )}

                    {/* No `role="alert"` on either success block — see this file's docstring. */}
                    {inviteResult && inviteResult.invite_link && (
                      <div className="alert alert-success mt-3 mb-0">
                        <p className="mb-2">
                          Invite created. Share this link with the invitee — it is shown only once.
                        </p>
                        <div className="d-flex gap-2">
                          <input className="form-control" readOnly value={inviteResult.invite_link} />
                          <button
                            type="button"
                            className="btn btn-outline-secondary"
                            onClick={() => void handleCopyLink(inviteResult.invite_link as string)}
                          >
                            {copied ? "Copied!" : "Copy"}
                          </button>
                        </div>
                        {copyError && (
                          <div className="text-danger small mt-2">
                            Couldn't copy automatically — select the link above and copy it manually
                            (Ctrl/Cmd+C).
                          </div>
                        )}
                      </div>
                    )}

                    {inviteResult && !inviteResult.invite_link && (
                      <div className="alert alert-success mt-3 mb-0">
                        Invite sent to {inviteResult.email} — this email already has an account and
                        can accept it directly from within the app.
                      </div>
                    )}
                  </div>
                </div>

                {actionError && (
                  <div className="alert alert-danger" role="alert">
                    {actionError}
                  </div>
                )}

                <div className="card">
                  <div className="card-body">
                    {/* `responsive` only on the old CTable — no `table-hover` here (ADR-0042 §4.5.11). */}
                    <div className="table-responsive">
                      <table className="table">
                        <thead>
                          <tr>
                            <th scope="col">Email</th>
                            <th scope="col">Status</th>
                            <th scope="col">Joined</th>
                            <th scope="col">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {members.map((member) => (
                            <tr key={member.membership_id}>
                              <td>{member.email}</td>
                              <td>
                                {/* `bg-*`, not Bootstrap 5.3's `text-bg-*` — CoreUI emitted `bg-*` and assertions check it. */}
                                <span className={`badge bg-${statusColor(member.status)}`}>
                                  {member.status}
                                </span>
                              </td>
                              <td>{formatJoinedAt(member.joined_at)}</td>
                              <td>
                                {member.status === "active" && (
                                  <button
                                    type="button"
                                    className="btn btn-outline-warning btn-sm"
                                    disabled={pendingMembershipId === member.membership_id}
                                    onClick={() => void handleSuspend(member)}
                                  >
                                    Suspend
                                  </button>
                                )}
                                {member.status === "suspended" && (
                                  <button
                                    type="button"
                                    className="btn btn-outline-success btn-sm"
                                    disabled={pendingMembershipId === member.membership_id}
                                    onClick={() => void handleReactivate(member)}
                                  >
                                    Reactivate
                                  </button>
                                )}
                                {member.status === "invited" && (
                                  <>
                                    <button
                                      type="button"
                                      className="btn btn-outline-secondary btn-sm me-2"
                                      disabled={pendingMembershipId === member.membership_id}
                                      onClick={() => void handleCopyRowLink(member)}
                                    >
                                      {rowCopyStatus[member.membership_id] === "copied"
                                        ? "Copied!"
                                        : "Copy link"}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-outline-danger btn-sm"
                                      disabled={pendingMembershipId === member.membership_id}
                                      onClick={() => void handleRevoke(member)}
                                    >
                                      Revoke
                                    </button>
                                    {rowCopyStatus[member.membership_id] === "error" && (
                                      <div className="text-danger small mt-1">
                                        Couldn't copy automatically — try again or ask them to
                                        request a new invite.
                                      </div>
                                    )}
                                    {rowCopyStatus[member.membership_id] === "no-link" && (
                                      <div className="text-body-secondary small mt-1">
                                        This email already has an account — no link to copy, they
                                        can accept from within the app.
                                      </div>
                                    )}
                                  </>
                                )}
                              </td>
                            </tr>
                          ))}
                          {members.length === 0 && (
                            <tr>
                              <td colSpan={4} className="text-body-secondary">
                                No members yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default OrgMembers;
