# fira

Jira + Confluence replacement for the owner and invited members. **SPEC.md is the source of truth** (data model, API, rules, behavior); update it with any behavior change. Live at https://fira-six.vercel.app (Firebase project `fira-dadanisme`).

## Commands

- `npm run dev`: Vite dev server (SPA only; the API runs on Vercel or under `vercel dev`)
- `npm run typecheck` / `npm run build` (typecheck + `vite build`) / `npm run lint` (oxlint)
- Emulator tests (Firebase CLI, project `demo-fira`): `test:api` (REST API), `test:rules` (Firestore + Storage rules), `test:docs` (conditional page saves)

Env: see `.env.example`; `.env.local` holds secrets, never print it.

## Shipping

Commit straight to `main` and deploy once a change is verified: typecheck, lint, build, and the emulator tests that cover what changed. Then push, run `vercel deploy --prod --yes`, and check the live site. Rules changes also need `firebase deploy --only firestore:rules,storage --project fira-dadanisme`. Vercel's function build prints TypeScript errors from its own config; they don't fail the deploy.

## Layout

- `shared/`: types (`types.ts`) and pure helpers (keys, status, rank, activity, pages, labels, actors, ids). No Firebase imports; relative imports use `.js` extensions (Node ESM on Vercel). The SPA imports it as `@shared/...`.
- `src/lib/`: `firebase.ts`, `auth.tsx` (member gate, `useUser`), `theme.ts`, `cx.ts`.
- `src/data/`: the only place that talks to Firestore. Live hooks (`useX`, from `live.ts`) + mutations, one file per resource.
- `src/components/`: shared primitives (Button, IconButton, Popover, Menu, Avatar, MarkdownEditor/MarkdownView, ...). Reuse them; add a primitive here rather than restyling in a feature.
- `src/app/`: shell (router, layout, sidebar). `src/features/{board,docs,settings}/`: feature UIs, lazy-loaded route modules.
- `api/`: one Vercel function (`api/index.ts`); `vercel.json` rewrites `/api/v1/*` to it. Add routes as `route(method, '/cards/:key', auth, handler)` in `api/_routes/<resource>.ts`, register them in `api/_routes/index.ts`, and document them in `api/_lib/openapi.ts`. Don't add function files.

## Conventions

- **Activity log**: every card mutation (SPA or API) writes its activity entries in the same batch/transaction, computed with `cardPatchActivity` (shared/activity.ts).
- **Page saves** go through `src/data/pageSave.ts`: a transaction conditional on the editor's base version, which bumps `version` and snapshots per `startsVersionSession` (API writes always snapshot). Never write page content/title directly; that brings back silent overwrites.
- **Markdown** is the stored format for descriptions, comments and pages, edited and rendered only through `src/components/MarkdownEditor.tsx`. Editor-only features (folds, highlights, link clicks) are decorations/plugins: they must never change the Markdown or trigger a save.
- **Timestamps** are ISO strings in client/API types; `src/data/db.ts` and `api/_lib/serialize.ts` convert Firestore `Timestamp`s.
- **Ordering** uses fractional `rank` strings (shared/rank.ts); compare with `compareRank`/`byRank`, never `localeCompare`.
- **Optimistic writes**: don't block UI on mutation promises; handle their errors.
- **Styling**: Tailwind with the tokens in `src/index.css`, rem sizes only, no raw colors. Icons: `lucide-react`.
- **Members**: the owner (`OWNER_EMAIL`/`VITE_OWNER_EMAIL`, hardcoded in `firestore.rules` and `storage.rules`; keep in sync) plus `members/{email}` docs. Every access check is "owner or members doc exists"; only the owner manages members. API tokens belong to their creator and stop working when that member is removed.
- **Parallel agents**: split work by area (`src/features/board`+`settings`, `src/features/docs`+`src/components/markdown`, `api/`); shared dirs (`shared/`, `src/data/`, `src/components/`, `src/app/`) change only additively.

## Gotchas

- Keep `"overrides": {"jwks-rsa": {"jose": "^5.10.0"}}`: Vercel runs Node with `--no-experimental-require-module`, and jose 6 crashes the API.
- Vercel rejects request bodies over 4.5 MB with a plain-text 413 before our code runs.
- Storage rules read Firestore (`firestore.exists`), which needs the Storage service agent to hold `roles/firebaserules.firestoreServiceAgent` (already granted).
- `gh issue view` fails in this repo; use `gh api repos/dadanisme/fira/issues/N`.
