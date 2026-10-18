# fira

Personal Jira + Confluence replacement. **SPEC.md is the source of truth** (data model, API, behavior).

## Commands

- `npm run dev`: Vite dev server (SPA only; the API runs on Vercel or under `vercel dev`)
- `npm run typecheck`: `tsc -b` over src/, shared/ and api/
- `npm run build`: typecheck + `vite build` to `dist/`
- `npm run lint`: oxlint

Env: see `.env.example` (`.env.local` is not committed). Don't deploy or commit unless asked.

## Layout

- `shared/`: types (`types.ts`) and pure helpers (keys, status, rank, activity diff, pages, labels, ids). No Firebase imports. Relative imports use `.js` extensions (Node ESM on Vercel). The SPA imports it as `@shared/...`.
- `src/lib/`: `firebase.ts` (app, db, auth, storage), `auth.tsx` (owner-only gate, `useUser`), `theme.ts`, `cx.ts`.
- `src/data/`: the only place that talks to Firestore. Live hooks (`useX`, from `live.ts`) + mutations, one file per resource.
- `src/components/`: shared primitives (Button, IconButton, Input, Popover, Menu, Badge, Avatar, MarkdownEditor/MarkdownView). Reuse them; add a primitive here rather than restyling in a feature.
- `src/app/`: shell (router, layout, sidebar, home).
- `src/features/{board,docs,settings}/`: feature UIs; route modules default-export their page and are lazy loaded.
- `api/`: one Vercel function (`api/index.ts`). `vercel.json` rewrites `/api/v1/*` to it; `api/_lib/router.ts` dispatches. Add routes as `route(method, '/cards/:key', auth, handler)` in `api/_routes/<resource>.ts` and register them in `api/_routes/index.ts`. Don't add more function files.

## Conventions

- **Activity log**: every card mutation (SPA or API) writes its activity entries in the same batch/transaction. Compute them with `cardPatchActivity` (shared/activity.ts) so both writers log identically. Page content/title saves bump `version` and write version snapshots per `startsVersionSession` (API writes always snapshot).
- **Markdown** is the stored format for card descriptions, comments and pages. Edit and render it only through `src/components/MarkdownEditor.tsx` (lazy Tiptap).
- **Timestamps** are ISO strings in every client/API type. Firestore holds `Timestamp`s; `src/data/db.ts` and `api/_lib/serialize.ts` convert.
- **Ordering** uses fractional-index `rank` strings (shared/rank.ts); compare with `compareRank`/`byRank`, never `localeCompare`.
- **Optimistic writes**: snapshots reflect local writes immediately. Don't block UI on mutation promises; handle their errors.
- **Styling**: Tailwind with the design tokens in `src/index.css` (`bg-surface`, `text-fg-muted`, `border-line`, label colors via `--label-<color>-bg/fg`). No raw colors. Icons: `lucide-react`.
- **Ownership**: board agent owns `src/features/board` and `src/features/settings`; docs agent owns `src/features/docs` and `src/components/markdown/` (the MarkdownEditor implementation); API agent owns `api/`. Shared files (`shared/`, `src/data/`, `src/components/`, `src/app/`) change only additively and compatibly.
- Owner email is hardcoded in `firestore.rules` and `storage.rules`; keep in sync with `OWNER_EMAIL`.
