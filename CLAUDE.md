# fira

Multi-tenant Jira + Confluence replacement: any Google user signs in and works in workspaces they own or were invited to. **SPEC.md is the source of truth** (data model, API, rules, behavior); update it with any behavior change. Live at https://fira-six.vercel.app (Firebase project `fira-dadanisme`).

## Commands

- `npm run dev`: Vite dev server against production Firebase (SPA only; the API runs on Vercel or under `vercel dev`)
- `npm run dev:emu`: Auth/Firestore/Storage emulators (`demo-fira`, empty each start) + the API on :3100 (`scripts/dev-emu-api.ts`) + Vite with `VITE_USE_EMULATORS=1`, which proxies `/api` there
- `npm run typecheck` / `npm run build` (typecheck + `vite build`) / `npm run lint` (oxlint)
- Emulator tests (Firebase CLI, project `demo-fira`): `test:api` (REST API), `test:rules` (Firestore + Storage rules), `test:docs` (conditional page saves)

Env: see `.env.example`; `.env.local` holds secrets, never print it.

## Shipping

Commit straight to `main` and deploy once a change is verified: typecheck, lint, build, and the emulator tests that cover what changed. Then push, run `vercel deploy --prod --yes`, and check the live site. Rules changes also need `firebase deploy --only firestore:rules,storage --project fira-dadanisme`. Vercel's function build prints TypeScript errors from its own config; they don't fail the deploy.

## Layout

- `shared/`: types (`types.ts`) and pure helpers (keys, status, rank, activity, pages, labels, actors, ids). No Firebase imports; relative imports use `.js` extensions (Node ESM on Vercel). The SPA imports it as `@shared/...`.
- `src/lib/`: `firebase.ts` (emulator wiring behind `VITE_USE_EMULATORS`), `auth.tsx` (sign-in gate, `useUser`), `theme.ts`, `cx.ts`.
- `src/data/`: the only place that talks to Firestore and the API. Live hooks (`useX`, from `live.ts`) + mutations, one file per resource. Everything is scoped to the active workspace (`workspace.ts`): hooks read `useWorkspaceId()` (and put it in memo deps), mutations read `currentWorkspaceId()`; a mutation that awaits before writing captures the id first. Workspace/member/invite/token changes go through the API (`workspaces.ts`, `tokens.ts`, `apiFetch` in `api.ts`).
- `src/components/`: shared primitives (Button, IconButton, Popover, Menu, Avatar, MarkdownEditor/MarkdownView, ...). Reuse them; add a primitive here rather than restyling in a feature.
- `src/app/`: shell (router, layout, sidebar). `WorkspaceRoute` resolves `/w/:slug` against the user's memberships and provides the workspace; `RootRedirect` sends `/` to the last-used workspace or `/workspaces` (Landing). In-app links are built with `useWsPath()` (or `wsPath(currentWorkspace().slug, ...)` outside React), never bare `/p/...`. `src/features/{board,docs,settings}/`: feature UIs, lazy-loaded route modules.
- `api/`: one Vercel function (`api/index.ts`); `vercel.json` rewrites `/api/v1/*` to it. Add routes as `route(method, '/cards/:key', auth, handler)` in `api/_routes/<resource>.ts`, register them in `api/_routes/index.ts`, and document them in `api/_lib/openapi.ts`. Don't add function files.

## Conventions

- **Activity log**: every card mutation (SPA or API) writes its activity entries in the same batch/transaction, computed with `cardPatchActivity` (shared/activity.ts).
- **Page saves** go through `src/data/pageSave.ts`: a transaction conditional on the editor's base version, which bumps `version` and snapshots per `startsVersionSession` (API writes always snapshot). Never write page content/title directly; that brings back silent overwrites.
- **Markdown** is the stored format for descriptions, comments and pages, edited and rendered only through `src/components/MarkdownEditor.tsx`. Editor-only features (folds, highlights, link clicks) are decorations/plugins: they must never change the Markdown or trigger a save.
- **Timestamps** are ISO strings in client/API types; `src/data/db.ts` and `api/_lib/serialize.ts` convert Firestore `Timestamp`s.
- **Ordering** uses fractional `rank` strings (shared/rank.ts); compare with `compareRank`/`byRank`, never `localeCompare`.
- **Optimistic writes**: don't block UI on mutation promises; handle their errors.
- **Styling**: Tailwind with the tokens in `src/index.css`, rem sizes only, no raw colors. Icons: `lucide-react`.
- **Workspaces**: all content lives under `workspaces/{wid}/...` (Storage: `workspaces/{wid}/{cards|pages}/...`). Access is "`workspaces/{wid}/members/{uid}` exists", in both rule files; roles (owner, admin, member) are enforced only by the API, since clients can't write workspaces, members or invites. No owner email anywhere. API tokens are scoped to one workspace, belong to their creator, and stop working when that member leaves or is removed. "My workspaces"/"my invites" are collection-group queries; results not at `workspaces/{wid}/members|invites/{id}` are dropped, and their `workspaceId` comes from the path.
- **Parallel agents**: split work by area (`src/features/board`+`settings`, `src/features/docs`+`src/components/markdown`, `api/`); shared dirs (`shared/`, `src/data/`, `src/components/`, `src/app/`) change only additively.

## Gotchas

- Keep `"overrides": {"jwks-rsa": {"jose": "^5.10.0"}}`: Vercel runs Node with `--no-experimental-require-module`, and jose 6 crashes the API.
- Vercel rejects request bodies over 4.5 MB with a plain-text 413 before our code runs.
- Storage rules read Firestore (`firestore.exists`), which needs the Storage service agent to hold `roles/firebaserules.firestoreServiceAgent` (already granted).
- The collection-group queries need the single-field index exemptions for `members.uid` and `invites.email` (`firestore.indexes.json`, deployed with `firebase deploy --only firestore:indexes`); without them production rejects the queries.
- Until the workspace migration is cut over (see the migration in SPEC.md), production data and rules are on the old layout: develop the SPA with `npm run dev:emu`, not `npm run dev`.
- `gh issue view` fails in this repo; use `gh api repos/dadanisme/fira/issues/N`.
