# UI Design Document — SHELL-6: Organization switcher header dropdown

**Date:** 2026-09-07
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0036](../adr/0036-shell-6-organization-switcher-header-dropdown.md), [SHELL-6 user story](../user-stories/2026-09-04-admin-shell-sidebar-stories.md), [ADR-0020](../adr/0020-admin-shell-full-template-parity.md) (existing header-dropdown precedent — dark/light mode toggle), [ADR-0012](../adr/0012-coreui-design-system.md) (CoreUI design system)

## 1. Scope

One new control in `AppHeader`, rendered on every `ProtectedRoute` screen: an icon-triggered dropdown listing the caller's organizations, letting them switch into any of them. Frontend-only change plus the one new backend read route (`GET /auth/me/orgs`) it calls — see ADR-0036 for the endpoint contract.

## 2. Placement and trigger

`AppHeader.tsx`'s existing dropdown region (where the color-mode toggle already lives, `AppHeader.tsx:82-121`) gains a second `CDropdown`, placed immediately to its left (closer to the brand/toggler side), so header order reads: sidebar toggler → brand → *(spacer)* → **org switcher** → color-mode toggle → logout button.

Trigger: a `CDropdownToggle color="secondary" variant="ghost">` icon button, `CIcon icon={cilBuilding}`, wrapped in a `CTooltip` reading "Switch organization" — same ghost-icon-button shape the color-mode toggle already uses, no new visual pattern introduced.

```
┌───────────────────────────────────────────────────────────────────┐
│ [☰]  TestNexa                              [🏢▾] [🌗▾] [Log out]  │
└───────────────────────────────────────────────────────────────────┘
        ^toggler  ^brand                       ^org    ^color  ^logout
                                                switcher mode
                                                (new)
```

## 3. Dropdown contents

Opening the trigger fires `GET /auth/me/orgs` (lazy-fetch — no call before the first open, no caching across opens, per ADR-0036). While the request is in flight, the menu shows a single disabled row with a small spinner. On success:

```
┌─────────────────────────────┐
│ SWITCH ORGANIZATION          │  <- CDropdownHeader, static label
├─────────────────────────────┤
│ ✓ Acme QA                    │  <- current org (matches :orgId), checkmark, non-clickable
│   Beta Testing Co            │  <- CDropdownItem, click → navigate
│   Gamma Labs                 │  <- CDropdownItem, click → navigate
└─────────────────────────────┘
```

- One `CDropdownItem` per org in the response, label = `org.name`.
- The org whose `id` matches the current route's `:orgId` (via `useParams()`) is marked active (checkmark/highlighted — ~~CoreUI's own `active` prop on `CDropdownItem`~~ → Bootstrap's own `active` class on the `button.dropdown-item`, revised 2026-09-08 per [ADR-0042](../adr/0042-adminlte-design-system.md)) and is not itself clickable (no-op switching to the org you're already in). This checkmark row is exactly the row `useParams().orgId` matches — no separate "current org" section above the list.
- Every other org is a plain clickable `CDropdownItem`.
- No "New Organization" item anywhere in this menu (ADR-0036 decision) — org creation stays on `/orgs/pick`.
- Single-org accounts: the list still renders (one row, marked current, non-clickable) — the trigger itself is never hidden or disabled.
- Zero-org edge case (direct-nav only, should not occur post-login): menu shows one disabled row, "No organizations" — no crash, no error toast.
- Fetch failure: menu shows one disabled row, "Couldn't load organizations" — no silent empty list masquerading as "you have no orgs."

## 4. Switch behavior

Clicking a non-current org's dropdown item calls `navigate(`/orgs/${org.id}`)` — always the org root, never an attempt to reconstruct the current nested path in the target org (ADR-0036). ~~The dropdown closes on click (CoreUI's default `CDropdownItem` behavior, no extra handling needed).~~ **Revised 2026-09-08 ([ADR-0042](../adr/0042-adminlte-design-system.md)): close-on-click is now our own responsibility** — the dropdown is hand-rolled (`useState` open boolean toggling Bootstrap's `.show`, plus a document click-outside listener, the `useDropdown` pattern in `AppHeader.tsx`), and AdminLTE's plugin JS is not vendored, so the item's own handler must clear the open state explicitly. This is exactly the class of implicit library behavior worth re-checking anywhere a doc said "no extra handling needed."

## 5. Non-goals (explicit)

- No client-side permission cache tied to the switch — the target org's screens re-check permissions server-side on their own next fetch, same as any direct navigation.
- No change to `AuthContext`'s `orgs`/`orgContext` fields, `Login.tsx`'s post-login redirect, or `OrgPicker.tsx` — all untouched.
- No badge/count indicator on the trigger icon (e.g. showing org count) — out of scope, not requested.
