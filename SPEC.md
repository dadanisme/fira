# fira — spec

fira ("f*** jira") is a fast, personal, Jira + Confluence replacement: a kanban board, Notion-style docs, and a REST API for automation agents.

**Single user** (Google sign-in, locked to `OWNER_EMAIL`, currently `huntercitation@gmail.com`) plus **automation agents** that call the REST API with named personal tokens.

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
  lib/auth.tsx        auth gate (Google sign-in, reject non-owner)
  data/               client data layer: typed Firestore hooks + mutations (writes activity log entries in the same batch)
  features/board/     board UI
  features/docs/      docs UI
  features/settings/  settings (projects, columns, fields, labels, API tokens)
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
`Actor = { type: 'user' | 'token', id: string, name: string }` (user: uid + display name; token: token id + token name).

- `projects/{id}`: `key` (e.g. `NI`, uppercase, unique), `name`, `columns: {id, name}[]` (ordered; default `To Do`, `In Progress`, `Done`), `fields: FieldDef[]`, `nextNumber` (int, incremented in a transaction on card creation), `pageTemplateId?`, `pageParentId?`, `rank`, `createdAt`.
  - `FieldDef = { id, key (camelCase, unique per project), name, type: 'text'|'number'|'select'|'multiselect'|'date'|'checkbox'|'url', options?: string[] }`
- `labels/{id}`: `name` (unique, case-insensitive), `color` (one of a fixed palette token). Global across projects. Cards store label **names**.
- `cards/{id}`: `projectId`, `key` (`NI-12`), `number`, `type: 'epic'|'card'|'subtask'`, `parentId?` (epic for a card, card for a subtask), `title`, `description` (markdown), `descriptionVersion` (int, starts 1), `status` (column id), `rank`, `priority: 'none'|'low'|'medium'|'high'|'urgent'`, `labels: string[]`, `dueDate?: 'YYYY-MM-DD'`, `fields: Record<fieldKey, value>`, `pageId?`, `archived: boolean`, `createdAt`, `updatedAt`, `createdBy: Actor`, `updatedBy: Actor`.
  - `cards/{id}/comments/{id}`: `body` (md), `author: Actor`, `createdAt`, `updatedAt?`.
  - `cards/{id}/activity/{id}`: `at`, `actor: Actor`, `kind: 'created'|'status'|'title'|'description'|'priority'|'labels'|'dueDate'|'field'|'parent'|'archived'|'comment'|'attachment'|'page'`, `field?`, `from?`, `to?` (JSON-safe values; status from/to are column **names**). Every mutation (UI or API) writes the matching activity entries in the same batch.
  - `cards/{id}/attachments/{id}`: `name`, `size`, `contentType`, `storagePath` (`attachments/{cardId}/{attachmentId}/{name}`), `uploadedBy: Actor`, `createdAt`.
- `pages/{id}`: `title`, `icon?` (emoji), `parentId: string|null`, `rank`, `content` (markdown), `version` (int, starts 1, +1 per content/title save), `isTemplate: boolean`, `cardId?`, `trashed: boolean`, `trashedAt?`, `createdAt`, `updatedAt`, `updatedBy: Actor`.
  - `pages/{id}/versions/{id}`: `version`, `title`, `content`, `savedAt`, `actor`. A snapshot is written when a save starts a new "session" (> 10 min since previous snapshot or different actor), plus always on API writes.
  - `pages/{id}/threads/{id}`: inline comment threads. `quote` (selected text), `prefix`, `suffix` (≤ 32 chars of surrounding text, for re-anchoring — Markdown cannot hold marks, so the editor highlights by searching quote+context on load), `resolved: boolean`, `resolvedAt?`, `messages: {id, body, author: Actor, createdAt}[]`, `createdAt`.
- `tokens/{id}`: `name` (e.g. `agen`), `color`, `hash` (sha256 of the secret), `prefix` (first 8 chars, for display), `createdAt`, `lastUsedAt?`, `revoked: boolean`. Secret format `fira_<32 random base62>`, shown once at creation. Created/revoked only via the API (server).

Firestore rules: only the owner (`request.auth.token.email == OWNER_EMAIL` and `email_verified`) can read/write everything except `tokens` (owner read-only). Storage rules: owner read/write on `attachments/**`.

## Board (SPA)

- Sidebar: projects list, docs tree, settings.
- Board view per project: columns, cards (key, title, priority icon, labels, due date, epic tag, subtask progress). Drag between/within columns (optimistic; rank via fractional indexing). Inline "+ add card" at the bottom of each column (type title, Enter).
- Filter bar: text search, labels, priority, epic, custom select fields. Toggle to show subtasks on the board (hidden by default) and archived.
- Card click opens a **centered card dialog** (URL `/p/:projectKey/:cardKey`, e.g. `/p/NI/NI-12`) over the board, which stays mounted underneath; full-screen sheet on phones. Main column (title, description, subtasks, work page, attachments, comments, activity) plus a properties column on wide screens. All fields click-to-edit: title, description (Markdown editor), status, priority, labels (create on the fly), due date, custom fields, epic/parent, subtasks list (add/check off by moving to last column), linked work page ("Create work page" uses the project's template + parent), attachments (upload/download/delete), comments, activity timeline.
- Settings: projects (create with key, rename), columns (add/rename/reorder/delete-if-empty), custom fields, labels (rename/color), API tokens (create → show secret once, revoke).
- Light + dark (follows OS, with a toggle). Minimal, dense, Linear/Notion-like. System font.

## Docs (SPA)

- One global nested page tree in the sidebar (expand/collapse, drag to reorder/reparent, "+" to add child). Templates are pages with `isTemplate` shown in a separate "Templates" section.
- Page view: title (click to edit), Tiptap editor (click to edit; `/` slash menu; markdown shortcuts; headings, lists, task lists, code blocks, quotes, links, tables, images via Storage upload), autosave (debounced, optimistic) with `version` conflict detection: if the remote version moved on while you edit, show a non-blocking notice and offer reload/merge-by-overwrite.
- Card mentions: typing a card key (`NI-12`) renders as a chip linking to the card.
- Inline comments: select text → "Comment" → thread in a right margin panel; reply; resolve; show resolved toggle.
- Version history drawer: list versions, preview, restore (restore = new version).
- Trash: trashing a page trashes its subtree; restore; delete forever.
- "Create page from template".

## REST API (`/api/v1`)

- Auth: `Authorization: Bearer fira_...` → look up `tokens` by sha256 hash (not revoked), update `lastUsedAt` (throttled). Actor = the token. The token-management endpoints instead accept a Firebase ID token for the owner (used by the Settings UI).
- JSON in/out. Errors: `{ error: { code, message } }` with proper status (400/401/404/409/422).
- Card search filters in memory after loading the project's cards (scale is hundreds, not millions) — no composite indexes needed.
- Cards are addressed by key (`NI-12`); statuses accepted by column name (case-insensitive) or id; responses include both `status` (name) and `statusId`.
- Pagination: `limit` (default 50, max 200) + opaque `cursor`; response `{ items, nextCursor }`.

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
```

Every mutating endpoint writes activity entries (cards) / versions (pages) exactly like the UI.

## Out of scope (v1)

Sprints, story points, keyboard shortcuts / command palette, GitHub PR linking, Jira import, webhooks, CLI, multi-user.
