<p align="center"><img src="brand/fira-mark.svg" width="96" height="96" alt="fira"></p>

# fira

fira — a fast, personal Jira + Confluence replacement. Kanban board, Notion-style docs, REST API.

**Live:** https://fira-six.vercel.app

## Stack

Vite + React 19 + TypeScript, Tailwind CSS v4, Tiptap (markdown docs), dnd-kit (board), Firebase (Auth, Firestore, Storage), one Vercel function for the REST API.

## Develop

```sh
npm install
npm run dev        # SPA on Vite (the API runs on Vercel or under `vercel dev`)
npm run test:api   # API smoke tests against the Firebase emulators
```

Env vars: see `.env.example`.

## API

REST API under `/api/v1`, authenticated with personal tokens (`Authorization: Bearer fira_…`, created in Settings → API tokens).

- **API documentation:** https://fira-six.vercel.app/docs/api (getting started guide, reference, try-it-out)
- OpenAPI spec: [`/api/v1/openapi.json`](https://fira-six.vercel.app/api/v1/openapi.json), written by hand in `api/_lib/openapi.ts`; the docs page is the static `public/docs/api/index.html` (Scalar, loaded from a CDN, so it is not part of the app bundle).
