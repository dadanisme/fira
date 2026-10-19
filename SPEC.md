# fira — spec

fira ("f*** jira") is a fast, personal, Jira + Confluence replacement: a kanban board, Notion-style docs, and a REST API for automation agents.

**Small team**: Google sign-in for the **owner** (`OWNER_EMAIL`, currently `huntercitation@gmail.com`, hardcoded so they can never be locked out) and **members** the owner invites by email (Settings → Members). Members can do everything on boards, docs, projects and settings except manage members (owner-only). Plus **automation agents** that call the REST API with named tokens; each member creates their own. No assignees, mentions or notifications.

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
  lib/auth.tsx        auth gate (Google sign-in, reject anyone not the owner or an invited member)
  data/               client data layer: typed Firestore hooks + mutations (writes activity log entries in the same batch)
  features/board/     board UI
  features/docs/      docs UI
  features/settings/  settings (projects, columns, fields, labels, members, API tokens)
  components/         shared UI (incl. MarkdownEditor wrapper around Tiptap)
shared/               types + pure helpers shared by SPA and API (no firebase imports)
  types.ts            the data model below
api/                  Vercel functions (REST API)
  _lib/               admin init, auth, helpers (underscore = not a route)
firestore.rules, firestore.indexes.json, storage.rules, firebase.json
vercel.json
```

Env vars: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_APP_ID`, `VITE_OWNER_EMAIL` (client); `FIREBASE_SERVICE_ACCOUNT` (JSON, server), `OWNER_EMAIL` (server).

## Data model (Firestore)

All timestamps are Firestore `Timestamp` in the DB; ISO strings in the API.
`Actor = { type: 'user' | 'token', id: string, name: string, via?: { id, name } }` (user: uid + display name; token: token id + token name, `via` = the member who created the token (uid + display name), absent on legacy tokens). Displayed as `name (via X)`, e.g. "CI bot (via Alice)" (`actorName` in shared/actors.ts).

- `projects/{id}`: `key` (e.g. `NI`, uppercase, unique), `name`, `columns: {id, name}[]` (ordered; default `To Do`, `In Progress`, `Done`), `fields: FieldDef[]`, `nextNumber` (int, incremented in a transaction on card creation), `pageTemplateId?`, `pageParentId?`, `rank`, `createdAt`.
  - `FieldDef = { id, key (camelCase, unique per project), name, type: 'text'|'number'|'select'|'multiselect'|'date'|'checkbox'|'url', options?: string[] }`
- `labels/{id}`: `name` (unique, case-insensitive), `color` (one of a fixed palette token). Global across projects. Cards store label **names**.
- `cards/{id}`: `projectId`, `key` (`NI-12`), `number`, `type: 'epic'|'card'|'subtask'`, `parentId?` (epic for a card, card for a subtask), `title`, `description` (markdown), `descriptionVersion` (int, starts 1), `status` (column id), `rank`, `priority: 'none'|'low'|'medium'|'high'|'urgent'`, `labels: string[]`, `dueDate?: 'YYYY-MM-DD'`, `fields: Record<fieldKey, value>`, `pageId?`, `archived: boolean`, `createdAt`, `updatedAt`, `createdBy: Actor`, `updatedBy: Actor`.
  - `cards/{id}/comments/{id}`: `body` (md), `author: Actor`, `createdAt`, `updatedAt?`.
  - `cards/{id}/activity/{id}`: `at`, `actor: Actor`, `kind: 'created'|'status'|'title'|'description'|'priority'|'labels'|'dueDate'|'field'|'parent'|'archived'|'comment'|'attachment'|'page'`, `field?`, `from?`, `to?` (JSON-safe values; status from/to are column **names**). Every mutation (UI or API) writes the matching activity entries in the same batch.
  - `cards/{id}/attachments/{id}`: `name`, `size`, `contentType`, `storagePath` (`attachments/{cardId}/{attachmentId}/{name}`), `uploadedBy: Actor`, `createdAt`.
- `pages/{id}`: `title`, `icon?` (emoji), `parentId: string|null`, `rank`, `content` (markdown), `version` (int, starts 1, +1 per content/title save), `isTemplate: boolean`, `cardId?`, `trashed: boolean`, `trashedAt?`, `createdAt`, `updatedAt`, `updatedBy: Actor`.
  - `pages/{id}/versions/{id}`: `version`, `title`, `content`, `savedAt`, `actor`. A snapshot is written when a save starts a new "session" (> 10 min since previous snapshot or different actor), plus always on API writes. SPA: when a save starts a session (or is a "keep mine" / restore, which always do) and the page's current version has no snapshot yet, that state is snapshotted first (attributed to its `updatedBy`, `savedAt` = its `updatedAt`), so an overwritten edit stays in history.
  - `pages/{id}/presence/{uid}`: who has the page open. `uid`, `name`, `photoURL?`, `editing: boolean`, `at` (server time of the last heartbeat). Written on open, every 30 s while the tab is visible, and when `editing` flips; deleted on leave (unmount/pagehide, best effort). Entries older than 75 s are ignored. Deleted with the page.
  - `pages/{id}/threads/{id}`: inline comment threads. `quote` (selected text), `prefix`, `suffix` (≤ 32 chars of surrounding text, for re-anchoring — Markdown cannot hold marks, so the editor highlights by searching quote+context on load), `resolved: boolean`, `resolvedAt?`, `messages: {id, body, author: Actor, createdAt}[]`, `createdAt`.
  - `pages/{id}/attachments/{id}`: files stored with the page, for embedding (API uploads and images pasted in the editor). `name`, `size`, `contentType`, `storagePath` (`pages/{pageId}/{attachmentId}/{name}`), `url` (non-expiring Firebase download-token URL, `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encoded path>?alt=media&token=<uuid>`, token in the object's `firebaseStorageDownloadTokens` metadata), `uploadedBy: Actor`, `createdAt`. Immutable: uploading the same name again creates a new attachment (new id, path and URL); deleting removes the Storage object, so its URL stops working.
- `tokens/{id}`: `name` (e.g. `agen`), `color`, `hash` (sha256 of the secret), `prefix` (first 8 chars, for display), `createdAt`, `lastUsedAt?`, `revoked: boolean`, `userEmail?` (creator, lowercased), `userId?` (creator uid), `userName?` (creator display name). Secret format `fira_<32 random base62>`, shown once at creation. Created/revoked only via the API (server). Tokens without `userEmail` (created before members existed) count as the owner's.
- `members/{email lowercased}`: the invite list. `email` (lowercased, = doc id), `role: 'owner'|'member'`, `addedAt`, `addedBy` (adder's email), `uid?`, `name?`, `photoURL?`, `lastSignInAt?` (absent = "Pending", never signed in). The owner adds/removes member docs; on every app load the signed-in user writes their own `uid`/`name`/`photoURL`/`lastSignInAt` (Firebase Auth's last sign-in time); the owner creates their own doc with role `owner` on first sign-in. Removing a doc cuts access immediately everywhere (SPA gate, rules, API tokens).

Access rules (owner email hardcoded in both rule files; keep in sync with `OWNER_EMAIL`/`VITE_OWNER_EMAIL`): `isOwner` = verified email equals the owner's (case-insensitive); `isMember` = `isOwner` or (verified email and `members/<email.lower()>` exists).
- Firestore: `isMember` can read/write everything except `tokens` and `members`. `members`: read if `isMember`; create/update if `isOwner` (doc id = `email`, role `owner` only for the owner's own doc, `member` otherwise); a member may update only their own doc and only `uid`, `name`, `photoURL`, `lastSignInAt`; delete if `isOwner` and not the owner's own doc. `tokens`: read if `isOwner` or `isMember` and `userEmail` is the caller's (so members' queries must filter on `userEmail`); writes only by the server.
- Storage: `isMember` (via cross-service `firestore.exists(members/...)`) read/write on `attachments/**` and `pages/**`. Download-token URLs (page attachments) are served without evaluating the rules. Deploying cross-service rules asks once to grant Storage access to Firestore.
- Tests: `npm run test:rules` checks these rules on the emulators (scripts/rules-test.ts).

## Board (SPA)

- Sidebar: projects list, docs tree, settings.
- Board view per project: columns, cards (key, title, priority icon, labels, due date, epic tag, subtask progress). Drag between/within columns (optimistic; rank via fractional indexing). Inline "+ add card" at the bottom of each column (type title, Enter).
- Filter bar: text search, labels, priority, epic, custom select fields. Toggle to show subtasks on the board (hidden by default) and archived.
- Card click opens a **centered card dialog** (URL `/p/:projectKey/:cardKey`, e.g. `/p/NI/NI-12`) over the board, which stays mounted underneath; full-screen sheet on phones. Main column (title, description, subtasks, work page, attachments, then a tabbed **Comments / Activity** area like Jira's) plus a properties column on wide screens. All fields click-to-edit: title, description (Markdown editor), status, priority, labels (create on the fly), due date, custom fields, epic/parent, subtasks list (add/check off by moving to last column), linked work page ("Create work page" uses the project's template + parent), attachments (upload/download/delete). The Comments/Activity tabs show counts and remember the last selected tab (Comments by default). Comments tab: composer on top, comments newest first; edit/delete own comments; ⌘/Ctrl+Enter sends. Activity tab: the activity timeline, newest first, repeated description edits grouped.
- Settings: projects (create with key, rename), columns (add/rename/reorder/delete-if-empty), custom fields, labels (rename/color), members, API tokens (create → show secret once, revoke).
  - Members: list (avatar, name, email, owner badge, last sign-in, "Pending" if never signed in). The owner adds by email and removes (confirm; not themselves); others see it read-only.
  - API tokens: members see and revoke their own; the owner sees and can revoke all, with a "By <creator>" note ("Creator removed, inactive" when the creator is no longer a member).
- Auth gate: the owner is let in at once; anyone else only while their `members` doc exists (watched live: removal signs them out). Not invited: "<email> hasn't been invited to fira."
- Light + dark (follows OS, with a toggle). Minimal, dense, Linear/Notion-like. System font.

## Docs (SPA)

- One global nested page tree in the sidebar (expand/collapse, drag to reorder/reparent, "+" to add child). Templates are pages with `isTemplate` shown in a separate "Templates" section.
- Page view: title (click to edit), Tiptap editor (click to edit; `/` slash menu; markdown shortcuts; headings, lists, task lists, code blocks, quotes, links, tables, images via Storage upload), autosave (debounced; the editor never waits on it) that never silently overwrites anyone:
  - Every content/title save is conditional on the version the edit is based on (a Firestore transaction: read version, compare, write `version + 1` + snapshot per the session rule). A save based on a stale version is rejected, whether the newer version came from another person, another tab or an API token. Same title+content as the server = no-op.
  - Remote change and no unsaved local edits: loaded into the editor silently (only the differing blocks/characters are replaced, so the caret, scroll and comment highlights stay; not part of undo).
  - Field-level rule for title vs content: a remote change to a field you haven't touched is merged silently (their title + your content, or vice versa). Only when the same field changed on both sides (a remote snapshot arrives or your save is rejected) autosave pauses and a non-blocking banner shows "<updatedBy.name> edited this page." ("You edited this page in another tab or device." for yourself) with **Load their version** (discard mine) and **Keep mine** (save on top of the latest version, always snapshotting both theirs and mine, so theirs is restorable from history).
  - Offline (transactions need the server): edits stay in the editor and in `localStorage` (`fira:page-draft:<pageId>`, with the base version), status "Offline · kept on this device"; saved conditionally when back online (and retried every 10 s after errors). A draft left by a closed tab/reload is restored on the next visit and goes through the same rules (saved, merged, or banner).
- Presence: avatars of the other people on the page (header, max 4 + "+N"); someone who typed in the last 20 s (or holds unsaved edits) gets an accent ring + dot and the tooltip "<name> is editing" (else "is viewing"). You aren't shown.
- Header also has a "Show/Hide resolved comments (N)" toggle (only when resolved threads exist), next to version history.
- Card mentions: typing a card key (`NI-12`) renders as a chip linking to the card.
- Inline comments: select text → "Comment" → thread in a right margin panel; reply; resolve; show resolved toggle.
- Version history drawer: list versions, preview, restore (restore = new version, saved on top of whatever is current, snapshotting it first if needed).
- Trash: trashing a page trashes its subtree; restore; delete forever.
- "Create page from template".

## REST API (`/api/v1`)

- Auth: `Authorization: Bearer fira_...` → look up `tokens` by sha256 hash (not revoked), reject (401) if its `userEmail` is set, isn't the owner's and has no `members` doc (checked on every request), update `lastUsedAt` (throttled). Actor = the token, with `via` = its creator. The token-management endpoints instead accept a Firebase ID token of a member (owner or invited; others get 403), used by the Settings UI: list returns the caller's tokens (the owner: all), create records the caller as creator, revoke only own tokens (others' → 404; the owner can revoke any).
- JSON in/out. Errors: `{ error: { code, message } }` with proper status (400/401/404/409/422).
- Card search filters in memory after loading the project's cards (scale is hundreds, not millions) — no composite indexes needed.
- Cards are addressed by key (`NI-12`); statuses accepted by column name (case-insensitive) or id; responses include both `status` (name) and `statusId`.
- Pagination: `limit` (default 50, max 200) + opaque `cursor`; response `{ items, nextCursor }`.
- Docs: public API reference at `/docs/api` — a static page (`public/docs/api/index.html`, Scalar from a CDN, outside the SPA bundle) rendering `/api/v1/openapi.json`, whose `info.description` is the getting-started guide.

Endpoints:

```
GET    /api/v1/openapi.json                      OpenAPI 3.1 spec (no auth)
GET    /api/v1/me                                the calling actor
POST   /api/v1/tokens        (ID token)          {name} → {token: {...}, secret}
GET    /api/v1/tokens        (ID token)
DELETE /api/v1/tokens/{id}   (ID token)          revoke

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

Every mutating endpoint writes activity entries (cards) / versions (pages) exactly like the UI.

## Out of scope (v1)

Sprints, story points, keyboard shortcuts / command palette, GitHub PR linking, Jira import, webhooks, CLI, assignees, mentions/notifications, roles beyond owner/member.
