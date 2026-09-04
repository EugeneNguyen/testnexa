/**
 * RBAC-2 org member management screen (ADR-0017): list an org's members,
 * invite a new one by email, suspend/reactivate an active/suspended member,
 * revoke a still-pending invite.
 *
 * Built with CoreUI (ADR-0012) — CTable/CCard/CForm/CFormInput/CButton/
 * CAlert/CBadge only, no hand-rolled table/badge markup. React Hook Form +
 * Zod own the invite form's state/validation, binding to CoreUI's
 * `CFormInput` the same way every other form in this codebase does its
 * client-side validation.
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
import {
  CAlert,
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CCol,
  CContainer,
  CForm,
  CFormInput,
  CFormLabel,
  CRow,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from "@coreui/react";
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
    <div className="bg-body-secondary min-vh-100 py-4">
      <CContainer>
        <CRow className="justify-content-center">
          <CCol xs={12} lg={9}>
            <h1 className="fs-4 mb-4">Members</h1>

            {isLoading && (
              <div className="d-flex align-items-center gap-2">
                <CSpinner size="sm" color="primary" />
                <span>Loading members...</span>
              </div>
            )}

            {!isLoading && loadError && (
              <CAlert color="danger" role="alert">
                {loadError}
              </CAlert>
            )}

            {!isLoading && !loadError && (
              <>
                <CCard className="mb-4">
                  <CCardBody>
                    <h2 className="fs-6 mb-3">Invite by email</h2>
                    <CForm
                      noValidate
                      onSubmit={(event: ReactFormEvent<HTMLFormElement>) => {
                        void handleSubmit(onInviteSubmit)(event);
                      }}
                    >
                      <CRow className="g-2 align-items-start">
                        <CCol xs={12} sm={8}>
                          <CFormLabel htmlFor="invite-email">Invite by email</CFormLabel>
                          <CFormInput
                            id="invite-email"
                            type="email"
                            invalid={Boolean(errors.email)}
                            {...register("email")}
                          />
                          {errors.email && (
                            <div className="invalid-feedback d-block">{errors.email.message}</div>
                          )}
                        </CCol>
                        <CCol xs={12} sm={4} className="d-flex align-items-end">
                          <CButton type="submit" color="primary" disabled={isInviting} className="w-100">
                            {isInviting ? "Sending..." : "Send invite"}
                          </CButton>
                        </CCol>
                      </CRow>
                    </CForm>

                    {inviteError && (
                      <CAlert color="danger" role="alert" className="mt-3 mb-0">
                        {inviteError}
                      </CAlert>
                    )}

                    {inviteResult && inviteResult.invite_link && (
                      <CAlert color="success" className="mt-3 mb-0">
                        <p className="mb-2">
                          Invite created. Share this link with the invitee — it is shown only once.
                        </p>
                        <div className="d-flex gap-2">
                          <CFormInput readOnly value={inviteResult.invite_link} />
                          <CButton
                            type="button"
                            color="secondary"
                            variant="outline"
                            onClick={() => void handleCopyLink(inviteResult.invite_link as string)}
                          >
                            {copied ? "Copied!" : "Copy"}
                          </CButton>
                        </div>
                        {copyError && (
                          <div className="text-danger small mt-2">
                            Couldn't copy automatically — select the link above and copy it manually
                            (Ctrl/Cmd+C).
                          </div>
                        )}
                      </CAlert>
                    )}

                    {inviteResult && !inviteResult.invite_link && (
                      <CAlert color="success" className="mt-3 mb-0">
                        Invite sent to {inviteResult.email} — this email already has an account and
                        can accept it directly from within the app.
                      </CAlert>
                    )}
                  </CCardBody>
                </CCard>

                {actionError && (
                  <CAlert color="danger" role="alert">
                    {actionError}
                  </CAlert>
                )}

                <CCard>
                  <CCardBody>
                    <CTable responsive>
                      <CTableHead>
                        <CTableRow>
                          <CTableHeaderCell>Email</CTableHeaderCell>
                          <CTableHeaderCell>Status</CTableHeaderCell>
                          <CTableHeaderCell>Joined</CTableHeaderCell>
                          <CTableHeaderCell>Actions</CTableHeaderCell>
                        </CTableRow>
                      </CTableHead>
                      <CTableBody>
                        {members.map((member) => (
                          <CTableRow key={member.membership_id}>
                            <CTableDataCell>{member.email}</CTableDataCell>
                            <CTableDataCell>
                              <CBadge color={statusColor(member.status)}>{member.status}</CBadge>
                            </CTableDataCell>
                            <CTableDataCell>{formatJoinedAt(member.joined_at)}</CTableDataCell>
                            <CTableDataCell>
                              {member.status === "active" && (
                                <CButton
                                  size="sm"
                                  color="warning"
                                  variant="outline"
                                  disabled={pendingMembershipId === member.membership_id}
                                  onClick={() => void handleSuspend(member)}
                                >
                                  Suspend
                                </CButton>
                              )}
                              {member.status === "suspended" && (
                                <CButton
                                  size="sm"
                                  color="success"
                                  variant="outline"
                                  disabled={pendingMembershipId === member.membership_id}
                                  onClick={() => void handleReactivate(member)}
                                >
                                  Reactivate
                                </CButton>
                              )}
                              {member.status === "invited" && (
                                <>
                                  <CButton
                                    size="sm"
                                    color="secondary"
                                    variant="outline"
                                    className="me-2"
                                    disabled={pendingMembershipId === member.membership_id}
                                    onClick={() => void handleCopyRowLink(member)}
                                  >
                                    {rowCopyStatus[member.membership_id] === "copied"
                                      ? "Copied!"
                                      : "Copy link"}
                                  </CButton>
                                  <CButton
                                    size="sm"
                                    color="danger"
                                    variant="outline"
                                    disabled={pendingMembershipId === member.membership_id}
                                    onClick={() => void handleRevoke(member)}
                                  >
                                    Revoke
                                  </CButton>
                                  {rowCopyStatus[member.membership_id] === "error" && (
                                    <div className="text-danger small mt-1">
                                      Couldn't copy automatically — try again or ask them to request
                                      a new invite.
                                    </div>
                                  )}
                                  {rowCopyStatus[member.membership_id] === "no-link" && (
                                    <div className="text-body-secondary small mt-1">
                                      This email already has an account — no link to copy, they can
                                      accept from within the app.
                                    </div>
                                  )}
                                </>
                              )}
                            </CTableDataCell>
                          </CTableRow>
                        ))}
                        {members.length === 0 && (
                          <CTableRow>
                            <CTableDataCell colSpan={4} className="text-body-secondary">
                              No members yet.
                            </CTableDataCell>
                          </CTableRow>
                        )}
                      </CTableBody>
                    </CTable>
                  </CCardBody>
                </CCard>
              </>
            )}
          </CCol>
        </CRow>
      </CContainer>
    </div>
  );
}

export default OrgMembers;
