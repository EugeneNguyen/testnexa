import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import OrgMembers from "../../../src/pages/workflows/OrgMembers";
import {
  inviteMember,
  listMembers,
  OrgMember,
  revokeInvite,
  updateMembershipStatus,
} from "../../../src/lib/api/members";
import { ApiError } from "../../../src/lib/api/client";

// Same partial-mock pattern as Signup.test.tsx: mock the API module the
// component calls directly, no real network calls, no need for a real
// AuthContext/ProtectedRoute wrapper since this page has no auth-state
// dependency of its own beyond being routed inside one.
vi.mock("../../../src/lib/api/members", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/members")>();
  return {
    ...actual,
    listMembers: vi.fn(),
    inviteMember: vi.fn(),
    updateMembershipStatus: vi.fn(),
    revokeInvite: vi.fn(),
  };
});

const mockListMembers = vi.mocked(listMembers);
const mockInviteMember = vi.mocked(inviteMember);
const mockUpdateMembershipStatus = vi.mocked(updateMembershipStatus);
const mockRevokeInvite = vi.mocked(revokeInvite);

const ORG_ID = "11111111-1111-1111-1111-111111111111";

const ACTIVE_MEMBER: OrgMember = {
  membership_id: "m-active",
  user_id: "u-active",
  email: "active@example.com",
  status: "active",
  joined_at: "2026-01-15T10:00:00Z",
};

const SUSPENDED_MEMBER: OrgMember = {
  membership_id: "m-suspended",
  user_id: "u-suspended",
  email: "suspended@example.com",
  status: "suspended",
  joined_at: "2026-01-10T10:00:00Z",
};

const INVITED_MEMBER: OrgMember = {
  membership_id: "m-invited",
  user_id: "u-invited",
  email: "invited@example.com",
  status: "invited",
  joined_at: null,
};

function page(items: OrgMember[]) {
  return { items, total: items.length, page: 1, page_size: 25 };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/orgs/${ORG_ID}/members`]}>
      <Routes>
        <Route path="/orgs/:orgId/members" element={<OrgMembers />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("OrgMembers page", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading state, then the members table with status badges and joined dates", async () => {
    mockListMembers.mockResolvedValue(page([ACTIVE_MEMBER, SUSPENDED_MEMBER, INVITED_MEMBER]));
    renderPage();

    expect(screen.getByText("Loading members...")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(mockListMembers).toHaveBeenCalledWith(ORG_ID);

    const rows = screen.getAllByRole("row");
    // header row + 3 member rows
    expect(rows).toHaveLength(4);

    expect(screen.getByText("active@example.com")).toBeInTheDocument();
    expect(screen.getByText("suspended@example.com")).toBeInTheDocument();
    expect(screen.getByText("invited@example.com")).toBeInTheDocument();

    const activeRow = screen.getByText("active@example.com").closest("tr") as HTMLElement;
    expect(within(activeRow).getByText("active", { selector: ".badge" })).toBeInTheDocument();

    const invitedRow = screen.getByText("invited@example.com").closest("tr") as HTMLElement;
    expect(within(invitedRow).getByText("—")).toBeInTheDocument();
  });

  it("renders a permission-restricted message and hides the table/form on a 403", async () => {
    mockListMembers.mockRejectedValue(
      new ApiError("You do not have permission to view this page.", 403, {
        code: "permission_denied",
      }),
    );
    renderPage();

    expect(await screen.findByText(/you do not have permission/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/invite by email/i)).not.toBeInTheDocument();
  });

  it("renders a generic error message on a 404 (cross-tenant/no membership)", async () => {
    mockListMembers.mockRejectedValue(
      new ApiError("Organization not found.", 404, { code: "not_found" }),
    );
    renderPage();

    expect(await screen.findByText(/organization not found/i)).toBeInTheDocument();
  });

  describe("invite by email form", () => {
    it("rejects an invalid email client-side without calling inviteMember()", async () => {
      mockListMembers.mockResolvedValue(page([]));
      renderPage();
      await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText(/invite by email/i), {
        target: { value: "not-an-email" },
      });
      fireEvent.click(screen.getByRole("button", { name: /send invite/i }));

      expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument();
      expect(mockInviteMember).not.toHaveBeenCalled();
    });

    it("invites a new email and shows the returned invite_link in a copyable field", async () => {
      mockListMembers.mockResolvedValue(page([]));
      mockInviteMember.mockResolvedValue({
        membership_id: "m-new",
        status: "invited",
        invite_link: "https://app.example.com/invites/raw-token/accept",
      });
      renderPage();
      await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText(/invite by email/i), {
        target: { value: "new@example.com" },
      });
      fireEvent.click(screen.getByRole("button", { name: /send invite/i }));

      await waitFor(() => expect(mockInviteMember).toHaveBeenCalledWith(ORG_ID, { email: "new@example.com" }));

      const linkField = await screen.findByDisplayValue(
        "https://app.example.com/invites/raw-token/accept",
      );
      expect(linkField).toHaveAttribute("readonly");
      // Invite success re-fetches the members list.
      expect(mockListMembers).toHaveBeenCalledTimes(2);
    });

    it("shows a no-link confirmation for an existing-user invite (invite_link: null)", async () => {
      mockListMembers.mockResolvedValue(page([]));
      mockInviteMember.mockResolvedValue({
        membership_id: "m-existing",
        status: "invited",
        invite_link: null,
      });
      renderPage();
      await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText(/invite by email/i), {
        target: { value: "existing@example.com" },
      });
      fireEvent.click(screen.getByRole("button", { name: /send invite/i }));

      expect(await screen.findByText(/existing@example\.com/i)).toBeInTheDocument();
      expect(screen.queryByDisplayValue(/http/)).not.toBeInTheDocument();
    });

    it("shows the backend's ApiError message inline on a failed invite (e.g. already a member)", async () => {
      mockListMembers.mockResolvedValue(page([]));
      mockInviteMember.mockRejectedValue(
        new ApiError("This email already has a membership in this organization.", 409, {
          code: "already_member",
        }),
      );
      renderPage();
      await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText(/invite by email/i), {
        target: { value: "dup@example.com" },
      });
      fireEvent.click(screen.getByRole("button", { name: /send invite/i }));

      expect(await screen.findByText(/already has a membership/i)).toBeInTheDocument();
    });

    describe("copy invite link", () => {
      const LINK = "https://app.example.com/invites/raw-token/accept";

      async function renderWithInvite() {
        mockListMembers.mockResolvedValue(page([]));
        mockInviteMember.mockResolvedValue({
          membership_id: "m-new",
          status: "invited",
          invite_link: LINK,
        });
        renderPage();
        await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
        fireEvent.change(screen.getByLabelText(/invite by email/i), {
          target: { value: "new@example.com" },
        });
        fireEvent.click(screen.getByRole("button", { name: /send invite/i }));
        await screen.findByDisplayValue(LINK);
      }

      afterEach(() => {
        // @ts-expect-error -- test-only cleanup of a per-test navigator override.
        delete window.navigator.clipboard;
        // @ts-expect-error -- restore jsdom's own default isSecureContext getter.
        delete window.isSecureContext;
        // @ts-expect-error -- jsdom doesn't implement execCommand; remove the test-added stub.
        delete document.execCommand;
        vi.restoreAllMocks();
      });

      it("uses navigator.clipboard.writeText in a secure context", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(window.navigator, { clipboard: { writeText } });
        Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
        await renderWithInvite();

        fireEvent.click(screen.getByRole("button", { name: "Copy" }));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
        expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
      });

      it("falls back to document.execCommand('copy') over a non-secure origin (e.g. LAN IP over HTTP) where navigator.clipboard is unavailable", async () => {
        // @ts-expect-error -- simulating an insecure context (no clipboard property at all).
        delete window.navigator.clipboard;
        Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
        const execCommand = vi.fn().mockReturnValue(true);
        Object.assign(document, { execCommand });
        await renderWithInvite();

        fireEvent.click(screen.getByRole("button", { name: "Copy" }));

        await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
        expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
      });

      it("shows a manual-copy hint if both the clipboard API and the execCommand fallback fail", async () => {
        // @ts-expect-error -- simulating an insecure context (no clipboard property at all).
        delete window.navigator.clipboard;
        Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
        Object.assign(document, { execCommand: vi.fn().mockReturnValue(false) });
        await renderWithInvite();

        fireEvent.click(screen.getByRole("button", { name: "Copy" }));

        expect(await screen.findByText(/copy it manually/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
      });
    });
  });

  describe("membership actions", () => {
    it("suspends an active member and refreshes the list", async () => {
      mockListMembers
        .mockResolvedValueOnce(page([ACTIVE_MEMBER]))
        .mockResolvedValueOnce(page([{ ...ACTIVE_MEMBER, status: "suspended" }]));
      mockUpdateMembershipStatus.mockResolvedValue({ ...ACTIVE_MEMBER, status: "suspended" });
      renderPage();

      const suspendButton = await screen.findByRole("button", { name: /suspend/i });
      fireEvent.click(suspendButton);

      await waitFor(() =>
        expect(mockUpdateMembershipStatus).toHaveBeenCalledWith(ORG_ID, ACTIVE_MEMBER.membership_id, "suspended"),
      );
      await waitFor(() => expect(mockListMembers).toHaveBeenCalledTimes(2));
    });

    it("reactivates a suspended member", async () => {
      mockListMembers.mockResolvedValue(page([SUSPENDED_MEMBER]));
      mockUpdateMembershipStatus.mockResolvedValue({ ...SUSPENDED_MEMBER, status: "active" });
      renderPage();

      const reactivateButton = await screen.findByRole("button", { name: /reactivate/i });
      fireEvent.click(reactivateButton);

      await waitFor(() =>
        expect(mockUpdateMembershipStatus).toHaveBeenCalledWith(
          ORG_ID,
          SUSPENDED_MEMBER.membership_id,
          "active",
        ),
      );
    });

    it("revokes a pending invite", async () => {
      mockListMembers.mockResolvedValue(page([INVITED_MEMBER]));
      mockRevokeInvite.mockResolvedValue(undefined);
      renderPage();

      const revokeButton = await screen.findByRole("button", { name: /revoke/i });
      fireEvent.click(revokeButton);

      await waitFor(() =>
        expect(mockRevokeInvite).toHaveBeenCalledWith(ORG_ID, INVITED_MEMBER.membership_id),
      );
    });

    it("shows an inline error if a membership action fails", async () => {
      mockListMembers.mockResolvedValue(page([ACTIVE_MEMBER]));
      mockUpdateMembershipStatus.mockRejectedValue(
        new ApiError("You do not have permission.", 403, { code: "permission_denied" }),
      );
      renderPage();

      const suspendButton = await screen.findByRole("button", { name: /suspend/i });
      fireEvent.click(suspendButton);

      expect(await screen.findByText(/you do not have permission/i)).toBeInTheDocument();
    });

    describe("copy link from the member list (pending invite row)", () => {
      afterEach(() => {
        // @ts-expect-error -- test-only cleanup of a per-test navigator override.
        delete window.navigator.clipboard;
        // @ts-expect-error -- restore jsdom's own default isSecureContext getter.
        delete window.isSecureContext;
        // @ts-expect-error -- jsdom doesn't implement execCommand; remove the test-added stub.
        delete document.execCommand;
        vi.restoreAllMocks();
      });

      it("resends the invite (a fresh token, since a prior one is never re-exposed) and copies the returned link", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(window.navigator, { clipboard: { writeText } });
        Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
        mockListMembers.mockResolvedValue(page([INVITED_MEMBER]));
        mockInviteMember.mockResolvedValue({
          membership_id: INVITED_MEMBER.membership_id,
          status: "invited",
          invite_link: "https://app.example.com/invites/fresh-token/accept",
        });
        renderPage();

        const copyButton = await screen.findByRole("button", { name: "Copy link" });
        fireEvent.click(copyButton);

        await waitFor(() =>
          expect(mockInviteMember).toHaveBeenCalledWith(ORG_ID, { email: INVITED_MEMBER.email }),
        );
        await waitFor(() =>
          expect(writeText).toHaveBeenCalledWith("https://app.example.com/invites/fresh-token/accept"),
        );
        expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
      });

      it("falls back to execCommand for a row copy over a non-secure origin", async () => {
        // @ts-expect-error -- simulating an insecure context.
        delete window.navigator.clipboard;
        Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
        const execCommand = vi.fn().mockReturnValue(true);
        Object.assign(document, { execCommand });
        mockListMembers.mockResolvedValue(page([INVITED_MEMBER]));
        mockInviteMember.mockResolvedValue({
          membership_id: INVITED_MEMBER.membership_id,
          status: "invited",
          invite_link: "https://app.example.com/invites/fresh-token/accept",
        });
        renderPage();

        fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));

        await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
        expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
      });

      it("shows a no-link message for an existing-user invite instead of attempting to copy", async () => {
        mockListMembers.mockResolvedValue(page([INVITED_MEMBER]));
        mockInviteMember.mockResolvedValue({
          membership_id: INVITED_MEMBER.membership_id,
          status: "invited",
          invite_link: null,
        });
        renderPage();

        fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));

        expect(await screen.findByText(/already has an account/i)).toBeInTheDocument();
      });

      it("shows an inline error if the resend call itself fails", async () => {
        mockListMembers.mockResolvedValue(page([INVITED_MEMBER]));
        mockInviteMember.mockRejectedValue(
          new ApiError("Something went wrong.", 500, { code: "internal_error" }),
        );
        renderPage();

        fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));

        expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
      });
    });
  });
});
