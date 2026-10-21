# fira — spec

fira ("f*** jira") is a fast, personal, Jira + Confluence replacement: a kanban board, Notion-style docs, and a REST API for automation agents.

**Workspaces**: anyone can sign in with Google; all content lives in a **workspace** (name + slug), which its **owner** creates and fills by inviting people by email. A user can belong to many workspaces and switches between them in the sidebar. Roles per workspace: owner, admin, member (see [Workspaces](#workspaces)). Plus **automation agents** that call the REST API with named tokens; each member creates their own, scoped to one workspace. No assignees, mentions or notifications.

Primary goal: **speed**. Board must render from local cache instantly; every edit is optimistic. Notion-like click-to-edit everywhere.

## Stack

- **Vite + React + TypeScript** SPA (no SSR), React Router, Tailwind CSS v4.
- **Firebase JS SDK** (modular): Firestore with `persistentLocalCache({ tabManager: persistentMultipleTabManager() })`, Auth (Google), Storage. The SPA reads/writes Firestore directly; live updates via `onSnapshot`.
- **Vercel**: one project serving the static SPA + Node.js serverless functions in `/api` (REST API, using `firebase-admin`). SPA fallback rewrite to `index.html` for non-`/api` paths.
- **Tiptap** editor (lazy loaded) with Markdown in/out. Markdown is the stored format everywhere (card descriptions, comments, pages).
- **dnd-kit** for drag and drop. Fractional indexing (`fractional-indexing` package) for ordering (`rank` strings).
- Package manager: **npm**. Node 22.

## Repo layout

```
src/                  SPA
  lib/firebase.ts     Firebase init (env: VITE_FIREBASE_*)
  lib/auth.tsx        auth gate (Google sign-in; any verified Google account)
  data/               client data layer: typed Firestore hooks + mutations (writes activity log entries in the same batch),
                      scoped to the active workspace (data/workspace.ts); workspace/member/invite changes call the API
  app/                shell: router (`/w/:slug/...`), landing, workspace switcher, sidebar
  features/board/     board UI
  features/docs/      docs UI
  features/settings/  settings (projects, columns, fields, labels, members, API tokens)
  components/         shared UI (incl. MarkdownEditor wrapper around Tiptap)
shared/               types + pure helpers shared by SPA and API (no firebase imports)
  types.ts            the data model below
api/                  Vercel functions (REST API)
  _lib/               admin init, auth, email (Resend), helpers (underscore = not a route)
  _routes/            route modules (cards, pages, workspaces, members, invites, tokens, ...)
scripts/              emulator test suites, migrate-workspaces.ts (one-time migration)
firestore.rules, firestore.indexes.json, storage.rules, firebase.json
vercel.json
```

Env vars: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_APP_ID` (client), `VITE_USE_EMULATORS` (client, dev only: `1` = local emulators of `demo-fira`, used by `npm run dev:emu`); `FIREBASE_SERVICE_ACCOUNT` (JSON, server), `RESEND_API_KEY` (server; unset = invites are created but not emailed), `INVITE_FROM` (server, `Fira <invites@mail.muhammadramdan.com>`), `APP_URL` (server, `https://fira-six.vercel.app`, for links in emails). No owner email anywhere.

## Data model (Firestore)

All timestamps are Firestore `Timestamp` in the DB; ISO strings in the API.
`Actor = { type: 'user' | 'token', id: string, name: string, via?: { id, name } }` (user: uid + display name; token: token id + token name, `via` = the member who created the token (uid + display name)). Displayed as `name (via X)`, e.g. "CI bot (via Alice)" (`actorName` in shared/actors.ts).

Everything but tokens and slug reservations lives under its workspace: `W = workspaces/{workspaceId}`. Keys and names that are "unique" (project keys, card keys, label names) are unique **per workspace**.

### Workspaces, members, invites (written only by the API)

- `workspaces/{id}`: `name` (1–60 chars), `slug` (unique, see `WORKSPACE_SLUG_RE`: 3–32 chars, lowercase letters/digits/hyphens, starts with a letter, no leading/trailing/double hyphen, not in `RESERVED_SLUGS`), `ownerUid`, `createdAt`, `createdBy` (uid), `deleting?: true` + `deletingAt?` (set first by a delete; never in API responses). The id is random and never changes; name and slug are renameable by the owner (old `/w/<slug>` links break).
- `slugs/{slug}`: `workspaceId`. Slug reservation, created/swapped/deleted in the same transaction as the workspace, so slugs stay unique. Server only (clients cannot read it).
- `W/members/{uid}`: `uid` (= doc id), `email` (lowercased), `name`, `photoURL?`, `role: 'owner'|'admin'|'member'`, `joinedAt`, `invitedBy?` (uid; absent for the creator), `lastSignInAt?`, `workspaceName`, `workspaceSlug` (denormalized, so a user's workspace list is one query; rewritten on rename). Exactly one member has role `owner` (= `workspaces.ownerUid`). Deleting the doc cuts access immediately everywhere (SPA, rules, API tokens).
- `W/invites/{email lowercased}`: a pending invite. `email` (= doc id), `role: 'admin'|'member'`, `invitedBy: { uid, name, email }`, `createdAt`, `lastSentAt?`, `emailStatus: 'pending'|'sent'|'failed'` (`pending` while the email is being sent), `emailError?`, `workspaceId`, `workspaceName` (denormalized: the invitee can read the invite but not the workspace). Deleted on accept, decline or revoke.
- `inviteSends/{sha256(workspaceId + "\n" + email)}`: `lastSentAt` of the last invite email to that address from that workspace. Kept apart from the invite (and after the workspace is deleted), so revoking and re-inviting does not reset the cooldown. Server only.
- `inviteQuotas/{uid}`: `day` (UTC `YYYY-MM-DD`), `count`, `updatedAt`: invite emails the user sent that day, across all workspaces. Server only.

### Content (written by the SPA under the rules, and by the API)

- `W/projects/{id}`: `key` (e.g. `NI`, uppercase, unique in the workspace), `name`, `columns: {id, name}[]` (ordered; default `To Do`, `In Progress`, `Done`), `fields: FieldDef[]`, `nextNumber` (int, incremented in a transaction on card creation), `pageTemplateId?`, `pageParentId?`, `rank`, `createdAt`.
  - `FieldDef = { id, key (camelCase, unique per project), name, type: 'text'|'number'|'select'|'multiselect'|'date'|'checkbox'|'url', options?: string[] }`
- `W/labels/{id}`: `name` (unique in the workspace, case-insensitive), `color` (one of a fixed palette token). Shared by the workspace's projects. Cards store label **names**.
- `W/cards/{id}`: `projectId`, `key` (`NI-12`), `number`, `type: 'epic'|'card'|'subtask'`, `parentId?` (epic for a card, card for a subtask), `title`, `description` (markdown), `descriptionVersion` (int, starts 1), `status` (column id), `rank`, `priority: 'none'|'low'|'medium'|'high'|'urgent'`, `labels: string[]`, `dueDate?: 'YYYY-MM-DD'`, `fields: Record<fieldKey, value>`, `pageId?`, `archived: boolean`, `createdAt`, `updatedAt`, `createdBy: Actor`, `updatedBy: Actor`.
  - `W/cards/{id}/comments/{id}`: `body` (md), `author: Actor`, `createdAt`, `updatedAt?`.
  - `W/cards/{id}/activity/{id}`: `at`, `actor: Actor`, `kind: 'created'|'status'|'title'|'description'|'priority'|'labels'|'dueDate'|'field'|'parent'|'archived'|'comment'|'attachment'|'page'`, `field?`, `from?`, `to?` (JSON-safe values; status from/to are column **names**). Every mutation (UI or API) writes the matching activity entries in the same batch.
  - `W/cards/{id}/attachments/{id}`: `name`, `size`, `contentType`, `storagePath` (`workspaces/{workspaceId}/cards/{cardId}/{attachmentId}/{name}`), `uploadedBy: Actor`, `createdAt`. Downloaded through the rules (short-lived URLs), never by download token. `storagePath` must be the record's own object (rules on write; the API and SPA check it again before signing, reading or deleting, and a record that fails is never signed and loses only the record on delete). The same applies to page attachments.
- `W/pages/{id}`: `title`, `icon?` (emoji), `parentId: string|null`, `rank`, `content` (markdown), `version` (int, starts 1, +1 per content/title save), `isTemplate: boolean`, `cardId?`, `trashed: boolean`, `trashedAt?`, `createdAt`, `updatedAt`, `updatedBy: Actor`.
  - `W/pages/{id}/versions/{id}`: `version`, `title`, `content`, `savedAt`, `actor`. A snapshot is written when a save starts a new "session" (> 10 min since previous snapshot or different actor), plus always on API writes. SPA: when a save starts a session (or is a "keep mine" / restore, which always do) and the page's current version has no snapshot yet, that state is snapshotted first (attributed to its `updatedBy`, `savedAt` = its `updatedAt`), so an overwritten edit stays in history.
  - `W/pages/{id}/presence/{uid}`: who has the page open. `uid`, `name`, `photoURL?`, `editing: boolean`, `at` (server time of the last heartbeat). Written on open, every 30 s while the tab is visible, and when `editing` flips; deleted on leave (unmount/pagehide, best effort). Entries older than 75 s are ignored. Deleted with the page.
  - `W/pages/{id}/threads/{id}`: inline comment threads. `quote` (selected text), `prefix`, `suffix` (≤ 32 chars of surrounding text, for re-anchoring — Markdown cannot hold marks, so the editor highlights by searching quote+context on load), `resolved: boolean`, `resolvedAt?`, `messages: {id, body, author: Actor, createdAt}[]`, `createdAt`.
  - `W/pages/{id}/attachments/{id}`: files stored with the page, for embedding (API uploads and images pasted in the editor). `name`, `size`, `contentType`, `storagePath` (`workspaces/{workspaceId}/pages/{pageId}/{attachmentId}/{name}`), `url` (non-expiring Firebase download-token URL, `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encoded path>?alt=media&token=<uuid>`, token in the object's `firebaseStorageDownloadTokens` metadata), `uploadedBy: Actor`, `createdAt`. Immutable: uploading the same name again creates a new attachment (new id, path and URL); deleting removes the Storage object, so its URL stops working.

### Tokens

- `tokens/{id}` (top level, so the API finds a token by hash with one query): `workspaceId`, `name` (e.g. `agen`), `color`, `hash` (sha256 of the secret), `prefix` (first 8 chars, for display), `createdAt`, `lastUsedAt?`, `revoked: boolean`, `userId` (creator uid), `userEmail` (creator, lowercased), `userName` (creator display name). Secret format `fira_<32 random base62>`, shown once at creation. Created/revoked only via the API; never read by clients directly. A token works only while `W/members/{userId}` exists; leaving or being removed also marks the member's tokens in that workspace `revoked`.

### Storage

- `workspaces/{workspaceId}/cards/{cardId}/{attachmentId}/{name}`: card attachments.
- `workspaces/{workspaceId}/pages/{pageId}/{attachmentId}/{name}`: page files (embedded by download-token URL).
- Max **10 MB** per file (storage rules; the SPA checks first and shows an error). API uploads stay ≤ 4 MB (Vercel's request body limit). No storage quota.

### Access rules

`isMember(w)` = `W/members/{request.auth.uid}` exists (one `exists()` per request, shared by both rule files via cross-service `firestore.exists`); `isAdmin(w)` = that doc's `role` is `owner` or `admin`.
- Firestore: `workspaces/{w}` read if `isMember(w)`. `W/members/{uid}` read if `isMember(w)`; plus a collection-group rule: any signed-in user may read member docs whose `uid` is their own (the "my workspaces" query, `collectionGroup('members').where('uid', '==', uid)`). `W/invites/{email}` read if `isMember(w)`; plus a collection-group rule: a verified user may read invites whose `email` equals their lowercased email (`collectionGroup('invites').where('email', '==', email)`). `W/{projects|labels|cards|pages}/{id}` and their subcollections (`comments`, `activity`, `attachments`, `versions`, `presence`, `threads`, one level deep) read if `isMember(w)`, write if `isMember(w)` and the workspace doc exists without `deleting == true` (one `get()` per request); `attachments` create/update also need `storagePath` split on `/` to be exactly `workspaces`, `{w}`, `{cards|pages}`, `{id}`, `{attachmentId}`, then a non-empty name (segments compared as strings, no regex); any other path under `W` is denied, so a member cannot plant nested `members`/`invites` docs that the collection-group queries would surface to other users. No client writes to `workspaces`, `members`, `invites`; no client access at all to `slugs`, `tokens`, `inviteSends` and `inviteQuotas` (the API uses the Admin SDK).
- Storage: `workspaces/{w}/{cards|pages}/**` read/delete if `isMember(w)`; create/update if `isMember(w)` and `request.resource.size <= 10 MB`. Download-token URLs (page attachments) are served without evaluating the rules. Storage needs `roles/firebaserules.firestoreServiceAgent` to read Firestore (already granted).
- Indexes: single-field collection-group index exemptions for `members.uid` and `invites.email` (firestore.indexes.json `fieldOverrides`).
- Tests: `npm run test:rules` checks these rules on the emulators (scripts/rules-test.ts).

## Workspaces

| Action | owner | admin | member |
|---|---|---|---|
| Boards, docs, projects, columns, fields, labels, own API tokens | ✓ | ✓ | ✓ |
| See all the workspace's API tokens, revoke any | ✓ | ✓ | |
| Invite (role admin or member), resend, revoke invites | ✓ | ✓ | |
| Change a non-owner's role (admin ↔ member), remove a non-owner | ✓ | ✓ | |
| Leave | (transfer first) | ✓ | ✓ |
| Rename (name, slug), transfer ownership, delete workspace | ✓ | | |

- **Landing** (`/workspaces`): after sign-in, lists the user's pending invites (workspace name, inviter, role; Accept / Decline), their workspaces (open), and "Create workspace" (name; slug suggested from the name, editable). A first-time user sees only invites + create; nothing is created automatically.
- **Create**: any user; at most **3 owned** workspaces per user (transfers count for the receiver). The creator becomes the owner.
- **Invites**: by email + role. At most **50 seats** per workspace = members + pending invites. Inviting an existing member or an already-invited email is a 409. Creating an invite sends one email (Resend, from `INVITE_FROM`, fixed subject "You've been invited to a workspace on Fira": no user-controlled text in it; the body names the inviter and workspace, HTML-escaped; button to `APP_URL/workspaces`); a send failure keeps the invite, records `emailStatus: 'failed'` and the UI shows a warning. Pending invites have **Resend** and **Revoke**. Invite emails (creates and resends) are limited server-side: one per address per workspace per minute, kept in `inviteSends` so revoke + re-invite doesn't reset it (429 `too_many_requests`), and **20 per inviter per UTC day** across all workspaces (429 `invite_limit`); a limited create makes no invite and sends nothing, and the Members settings show both as plain messages. Invites match by exact lowercased email of the signed-in Google account; they don't expire.
- **Accept** creates the member doc (role from the invite, name/photo from the Google account) and deletes the invite; **Decline** deletes it.
- **Transfer** (owner → any member): the target becomes owner, the previous owner becomes admin. The target must own fewer than 3 workspaces.
- **Delete** (owner; type the slug to confirm): immediate, server-side hard delete of the workspace doc and everything under it (members, invites, content and all subcollections), its slug, its tokens, and every Storage object under `workspaces/{id}/`. Not recoverable. It first sets `deleting: true` on the workspace doc; from then on invites, resends, accepts, token creation, rename, transfer, card and work-page creation, and every API-token request answer 409 `workspace_deleting`, and the rules deny content writes. A delete cut short can be retried (the flag stays); a final recursive sweep removes anything written during the run. Other members' open tabs lose access and go to the landing page.
- **Profile sync**: on app load (once per session) the SPA calls `POST /account/sync`, which refreshes `name`, `photoURL`, `lastSignInAt` on all of the caller's member docs.

## Board (SPA)

- Routing: every in-app URL is under `/w/:slug` (`/w/:slug/p/...`, `/w/:slug/d/...`, `/w/:slug/trash`, `/w/:slug/settings/...`). `/` redirects to the last-used workspace (this device, `localStorage` `fira:last-workspace` = workspace id, if still a member) or else to the landing page `/workspaces`. An unknown slug, or one the user isn't a member of: "Workspace not found" + link to `/workspaces`. Losing membership while in a workspace (removed, workspace deleted) sends the user to `/workspaces` with a notice. Old un-prefixed URLs (`/p/...`, `/d/...`) are not kept.
- Sidebar: workspace switcher at the top (current workspace name; menu: the user's workspaces, pending-invites count → landing, "Create workspace"), projects list, docs tree, settings.
- Board view per project: columns, cards (key, title, priority icon, labels, due date, epic tag, subtask progress). Drag between/within columns (optimistic; rank via fractional indexing). Inline "+ add card" at the bottom of each column (type title, Enter).
- Filter bar: text search, labels, priority, epic, custom select fields. Toggle to show subtasks on the board (hidden by default) and archived.
- Card click opens a **centered card dialog** (URL `/w/:slug/p/:projectKey/:cardKey`, e.g. `/w/ramdan/p/NI/NI-12`) over the board, which stays mounted underneath; full-screen sheet on phones. Main column (title, description, subtasks, work page, attachments, then a tabbed **Comments / Activity** area like Jira's) plus a properties column on wide screens. All fields click-to-edit: title, description (Markdown editor), status, priority, labels (create on the fly), due date, custom fields, epic/parent, subtasks list (add/check off by moving to last column), linked work page ("Create work page" uses the project's template + parent), attachments (upload/download/delete). The Comments/Activity tabs show counts and remember the last selected tab (Comments by default). Comments tab: composer on top, comments newest first; edit/delete own comments; ⌘/Ctrl+Enter sends. Activity tab: the activity timeline, newest first, repeated description edits grouped.
- Settings (per workspace): workspace, projects (create with key, rename), columns (add/rename/reorder/delete-if-empty), custom fields, labels (rename/color), members, API tokens (create → show secret once, revoke).
  - Workspace: name and slug (owner edits; others read-only), "Transfer ownership" (pick a member, confirm), "Delete workspace" (type the slug to confirm), "Leave workspace" (admins/members, confirm; the owner must transfer first).
  - Members: members (avatar, name, email, role badge, last sign-in) then pending invites (email, role, invited by, "Email failed" warning when `emailStatus` is `failed`). Admins/owner: invite (email + role, shows the seat count `n / 50`), Resend, Revoke, change role (admin ↔ member) and remove non-owners (confirm). Members see it read-only. Non-owners also find "Leave workspace" here. Confirmations (remove, revoke, delete, transfer, leave) are in-app dialogs, never the browser's `confirm`.
  - API tokens: tokens of this workspace. Members see and revoke their own; admins/owner see and can revoke all, with a "By <creator>" note.
- Auth gate: any verified Google account is let in (no allow-list); workspace access is per workspace (above).
- Light + dark (follows OS, with a toggle). Minimal, dense, Linear/Notion-like. System font.

## Docs (SPA)

- One nested page tree per workspace in the sidebar (expand/collapse, remembered per workspace on this device in `localStorage` `fira:docs-expanded:<workspaceId>`; drag to reorder/reparent, "+" to add child; renaming goes through the conditional save, on top of any newer version). Templates are pages with `isTemplate` shown in a separate "Templates" section.
- Page view: title (click to edit), Tiptap editor (click to edit; `/` slash menu; markdown shortcuts; headings, lists, task lists, code blocks, quotes, links, tables, images via Storage upload), autosave (debounced; the editor never waits on it) that never silently overwrites anyone:
  - Every content/title save is conditional on the version the edit is based on (a Firestore transaction: read version, compare, write `version + 1` + snapshot per the session rule). A save based on a stale version is rejected, whether the newer version came from another person, another tab or an API token. Same title+content as the server = no-op.
  - Remote change and no unsaved local edits: loaded into the editor silently (only the differing blocks/characters are replaced, so the caret, scroll and comment highlights stay; not part of undo).
  - Field-level rule for title vs content: a remote change to a field you haven't touched is merged silently (their title + your content, or vice versa). Only when the same field changed on both sides (a remote snapshot arrives or your save is rejected) autosave pauses and a non-blocking banner shows "<updatedBy.name> edited this page." ("You edited this page in another tab or device." for yourself) with **Load their version** (discard mine) and **Keep mine** (save on top of the latest version, always snapshotting both theirs and mine, so theirs is restorable from history).
  - Offline (transactions need the server): edits stay in the editor and in `localStorage` (`fira:page-draft:<workspaceId>:<pageId>`, with the base version; heading folds likewise under `fira:folds:<workspaceId>:<pageId>`), status "Offline · kept on this device"; saved conditionally when back online (and retried every 10 s after errors). A draft left by a closed tab/reload is restored on the next visit and goes through the same rules (saved, merged, or banner).
- Presence: avatars of the other people on the page (header, max 4 + "+N"); someone who typed in the last 20 s (or holds unsaved edits) gets an accent ring + dot and the tooltip "<name> is editing" (else "is viewing"). You aren't shown.
- Header also has a "Show/Hide resolved comments (N)" toggle (only when resolved threads exist), next to version history.
- Card mentions: typing a card key (`NI-12`) renders as a chip linking to the card in the current workspace.
- Links: in-app links (root-relative paths or absolute URLs on the app's origin) open in place; workspace-relative ones (`/d/<pageId>`, `/p/NI/NI-12`, `/trash`, `/settings/...`) resolve within the current workspace, `/w/<slug>/...` stays as written. Resolution is render/click time only; the Markdown keeps its href. In the editor a click follows an in-app link, ⌘/Ctrl-click opens it in a new tab, Alt/Option-click edits; other links open in a new tab.
- Image uploads over 10 MB are rejected before uploading, with a message naming the file.
- Inline comments: select text → "Comment" → thread in a right margin panel; reply; resolve; show resolved toggle.
- Version history drawer: list versions, preview, restore (restore = new version, saved on top of whatever is current, snapshotting it first if needed).
- Trash: trashing a page trashes its subtree; restore; delete forever.
- "Create page from template".

## REST API (`/api/v1`)

- Auth, three kinds:
  - **API token** (content endpoints): `Authorization: Bearer fira_...` → look up `tokens` by sha256 hash (not revoked), reject (401) unless `workspaces/{workspaceId}/members/{userId}` exists (checked on every request), and reject (401) a token whose `createdAt` is before that member's `joinedAt` (a token from an earlier membership never comes back with a re-invite; tokens older than the workspace's `createdAt`, which only the migration makes, are exempt); 409 `workspace_deleting` while the workspace is being deleted; update `lastUsedAt` (throttled). The token's workspace is implied: content paths carry no workspace, and everything outside it is a 404. Actor = the token, with `via` = its creator.
  - **Member** (`/workspaces/{id}/...` management endpoints): `Bearer <Firebase ID token>` of a verified Google account that is a member of `{id}` (else 404 `not_found`, so workspaces don't leak); role requirements per the table in [Workspaces](#workspaces) (else 403).
  - **User** (create workspace, accept/decline an invite, account sync): `Bearer <Firebase ID token>` of any verified Google account.
- Tokens (member auth): list returns the caller's tokens in that workspace (admins/owner: all of them); create records the caller as creator; revoke own (others' → 404; admins/owner can revoke any).
- JSON in/out. Errors: `{ error: { code, message } }` with proper status (400/401/403/404/409/422/429). Limit errors are 422 with codes `workspace_limit` (3 owned) and `seat_limit` (50 seats); invite email limits are 429 `too_many_requests` (same address within a minute) and `invite_limit` (20 a day per inviter); 409 `workspace_deleting` while a workspace is being deleted.
- Card search filters in memory after loading the project's cards (scale is hundreds, not millions) — no composite indexes needed.
- Cards are addressed by key (`NI-12`); statuses accepted by column name (case-insensitive) or id; responses include both `status` (name) and `statusId`.
- Pagination: `limit` (default 50, max 200) + opaque `cursor`; response `{ items, nextCursor }`.
- Docs: public API reference at `/docs/api` — a static page (`public/docs/api/index.html`, Scalar from a CDN, outside the SPA bundle) rendering `/api/v1/openapi.json`, whose `info.description` is the getting-started guide.

Endpoints:

```
GET    /api/v1/openapi.json                      OpenAPI 3.1 spec (no auth)
GET    /api/v1/me                                the calling actor + {workspace: {id, name, slug}}

POST   /api/v1/workspaces                        (user)   {name, slug} → Workspace (201); 409 slug_taken; 422 workspace_limit
PATCH  /api/v1/workspaces/{id}                   (owner)  {name?, slug?} → Workspace; 409 slug_taken
DELETE /api/v1/workspaces/{id}                   (owner)  {confirm: <slug>} → 204; hard delete (see Workspaces)
POST   /api/v1/workspaces/{id}/transfer          (owner)  {uid} → Workspace; 422 workspace_limit for the target
PATCH  /api/v1/workspaces/{id}/members/{uid}     (admin)  {role: 'admin'|'member'} → Member; owner's doc → 403
DELETE /api/v1/workspaces/{id}/members/{uid}     (admin; or self = leave, any non-owner) → 204; revokes their tokens here; one transaction re-reads target, caller and `ownerUid`, so the owner is never removed
POST   /api/v1/workspaces/{id}/invites           (admin)  {email, role?='member'} → 201 {invite, emailSent, emailError?}; 409 already_member/already_invited; 422 seat_limit; 429 too_many_requests/invite_limit
POST   /api/v1/workspaces/{id}/invites/{email}/resend (admin) → {invite, emailSent, emailError?}; 429 too_many_requests within a minute of the last send to that address, invite_limit over 20 a day
DELETE /api/v1/workspaces/{id}/invites/{email}   (admin: revoke; or user whose email it is: decline) → 204
POST   /api/v1/workspaces/{id}/invites/{email}/accept (user whose email it is) → {workspace, member}
POST   /api/v1/account/sync                      (user)   refreshes name/photo/lastSignInAt on all own member docs → 204
POST   /api/v1/workspaces/{id}/tokens            (member) {name, color?} → {token: {...}, secret}
GET    /api/v1/workspaces/{id}/tokens            (member)
DELETE /api/v1/workspaces/{id}/tokens/{tid}      (member) revoke

GET    /api/v1/projects                          with columns + fields
GET    /api/v1/projects/{key}
GET    /api/v1/labels

GET    /api/v1/cards?project=&status=&label=&type=&parent=&priority=&q=&field.<key>=&archived=false&sort=created|-created|updated|-updated|rank&limit=&cursor=
         status/label may repeat (OR within a param, AND across params)
POST   /api/v1/cards                             {project, title, description?, status?, type?, parent?, priority?, labels?, dueDate?, fields?}
GET    /api/v1/cards/{key}
PATCH  /api/v1/cards/{key}                       {title?, status?, priority?, dueDate?, parent?, fields? (merge), labels? (replace), addLabels?, removeLabels?, archived?, description?, descriptionVersion? (required with description; 409 if stale)}
GET    /api/v1/cards/{key}/activity?kind=&since=
GET    /api/v1/cards/{key}/comments
POST   /api/v1/cards/{key}/comments              {body}
GET    /api/v1/cards/{key}/attachments           includes short-lived download URLs
POST   /api/v1/cards/{key}/attachments           multipart/form-data `file` (≤ 4 MB) → stored in Storage
DELETE /api/v1/cards/{key}/attachments/{id}
POST   /api/v1/cards/{key}/page                  {template?: pageId} → creates & links work page (project template/parent by default); 409 if already linked

GET    /api/v1/pages?parent=&q=&template=&trashed=false
POST   /api/v1/pages                             {title, parent?, content?, template? (pageId to copy), isTemplate?}
GET    /api/v1/pages/{id}
PATCH  /api/v1/pages/{id}                        {title?, content?, parent?, icon?, trashed?, version (required with content/title; 409 if stale)}
GET    /api/v1/pages/{id}/versions
GET    /api/v1/pages/{id}/threads?resolved=false
POST   /api/v1/pages/{id}/threads                {quote, prefix?, suffix?, body}
POST   /api/v1/pages/{id}/threads/{tid}/messages {body}
PATCH  /api/v1/pages/{id}/threads/{tid}          {resolved}
GET    /api/v1/pages/{id}/attachments           with permanent download-token URLs
POST   /api/v1/pages/{id}/attachments           multipart/form-data `file` (≤ 4 MB) → {..., url} for `![alt](url)`; same name again = new attachment
DELETE /api/v1/pages/{id}/attachments/{aid}     deletes the stored file too (URL stops working)
```

Every mutating endpoint writes activity entries (cards) / versions (pages) exactly like the UI. The workspace, member, invite, account and token endpoints serve the SPA, not agents (they are still in the OpenAPI spec).

## Migration (one-time)

`scripts/migrate-workspaces.ts` moves the single-space data (top-level `projects`, `labels`, `cards`, `pages` with all subcollections except `presence`, and Storage `attachments/**`, `pages/**`) into workspace "Ramdan" (slug `ramdan`), owner = the former owner; former members become members (never-signed-in ones become invites, not emailed); tokens get `workspaceId` and their creator's uid (legacy tokens: the owner). Storage paths and download-token URLs (in `storagePath`, `url`, and inside Markdown of pages, versions, cards, comments, threads) and in-app links (`/p/...`, `/d/...`) are rewritten to the new layout. Modes `copy` (idempotent; keeps workspace docs, members, invites and files that have no original unless `--prune`; refuses, writing nothing, after the lock or when anything it would overwrite or delete was written after the last completed copy, `migration.copiedAt`, or the workspace was renamed), `verify` (strict until locked; `verify --lock` marks the copy final and is run right after the last copy + verify, before the app goes live; after the lock, structural checks only), and `cleanup` (deletes the old top-level data; run separately, only after `verify` passes, with `--confirm ramdan`).

## Out of scope (v1)

Sprints, story points, keyboard shortcuts / command palette, GitHub PR linking, Jira import, webhooks, CLI, assignees, mentions/notifications, read-only/guest roles, invite expiry, storage quotas, account deletion, privacy/terms pages.
