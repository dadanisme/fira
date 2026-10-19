import { ACTIVITY_KINDS, CARD_TYPES, FIELD_TYPES, LABEL_COLORS, PRIORITIES } from '../../shared/types.js';

/**
 * Hand-written OpenAPI 3.1 description of the REST API, served at
 * `GET /api/v1/openapi.json` and rendered by the API reference at `/docs/api`
 * (public/docs/api/index.html, Scalar). Keep in sync with api/_routes: the smoke test
 * checks that every route is documented and every documented route exists.
 */

const SITE = 'https://fira-six.vercel.app';
const BASE = `${SITE}/api/v1`;
const DOCS = `${SITE}/docs/api`;

// ---------------------------------------------------------------- helpers

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown, example?: unknown) => ({
  'application/json': example === undefined ? { schema } : { schema, example },
});
/** A JSON media type with several named examples (`{ name: [summary, value] }`). */
const jsonExamples = (schema: unknown, examples: Record<string, [string, unknown]>) => ({
  'application/json': {
    schema,
    examples: Object.fromEntries(Object.entries(examples).map(([k, [summary, value]]) => [k, { summary, value }])),
  },
});
const ok = (description: string, schema: unknown, example?: unknown) => ({ description, content: json(schema, example) });
const pageOf = (item: string) => ({
  type: 'object',
  required: ['items', 'nextCursor'],
  properties: {
    items: { type: 'array', items: ref(item) },
    nextCursor: { type: ['string', 'null'], description: 'Pass as `cursor` to get the next page; `null` on the last page' },
  },
});
const list = (items: unknown[], nextCursor: string | null = null) => ({ items, nextCursor });
const RESPONSES = { 400: 'BadRequest', 401: 'Unauthorized', 403: 'Forbidden', 404: 'NotFound', 409: 'Conflict', 413: 'TooLarge', 422: 'Unprocessable' };
const errors = (...codes: (keyof typeof RESPONSES)[]) =>
  Object.fromEntries(codes.map((c) => [String(c), { $ref: `#/components/responses/${RESPONSES[c]}` }]));
const param = (name: string) => ({ $ref: `#/components/parameters/${name}` });
const query = (name: string, schema: unknown, description: string, extra: Record<string, unknown> = {}) => ({
  name,
  in: 'query',
  required: false,
  description,
  schema,
  ...extra,
});
const body = (schema: unknown, example?: unknown) => ({ required: true, content: json(schema, example) });
const curl = (label: string, source: string) => ({ lang: 'Shell', label, source });

// ---------------------------------------------------------------- examples
// One consistent world: project NI (video ideas pipeline), card NI-42 under epic NI-7,
// its work page, and the agent token "agen".

const agent = { type: 'token', id: 'Tk8Qm2Vx4LpZr7Ws1Hn3', name: 'agen' };
const owner = { type: 'user', id: 'Gk2v9XcR1sYhQ7mN3pLw8ZtB4a62', name: 'Owner' };

const columns = [
  { id: 'c0Id3a7K', name: 'Idea' },
  { id: 'c1Rs8cHq', name: 'Research' },
  { id: 'c2Sc4pTz', name: 'Script' },
  { id: 'c3Rv9wLm', name: 'Script Review' },
  { id: 'c4Pb2sHd', name: 'Published' },
];
const columnNames = columns.map((c) => c.name);

const projectExample = {
  id: 'Pn1Qx7Lm2Va9Rt4Kc8Ze',
  key: 'NI',
  name: 'Next Ideas',
  columns,
  fields: [
    { id: 'f1Src0aQ', key: 'ideaSource', name: 'Idea source', type: 'select', options: ['Audience question', 'Trend', 'Backlog', 'Sponsor'] },
    { id: 'f2Fmt7bX', key: 'format', name: 'Format', type: 'select', options: ['Short', 'Long-form'] },
    { id: 'f3Len4cR', key: 'targetMinutes', name: 'Target length (min)', type: 'number' },
    { id: 'f4Spn9dW', key: 'sponsored', name: 'Sponsored', type: 'checkbox' },
    { id: 'f5Ref2eK', key: 'reference', name: 'Reference', type: 'url' },
  ],
  nextNumber: 43,
  pageTemplateId: 'PgTmpl5Script0Hk2Lq9',
  pageParentId: 'PgScripts7Rq1Vn4Xc0B',
  rank: 'a0',
  createdAt: '2026-09-02T08:14:03.512Z',
};

const cardDescription = '## Hook\nAsphalt and brick soak up heat all day and give it back all night.\n\n## Sources\n- [ ] Urban heat island review (2024)';
const cardExample = {
  id: 'Cd4Hq8Lm2Rz6Wx0Kp3Ty',
  projectId: projectExample.id,
  project: 'NI',
  key: 'NI-42',
  number: 42,
  type: 'card',
  parentId: 'Ep7Sm1Nr5Qa9Lx3Vb2Hc',
  parent: 'NI-7',
  title: 'Why do cities stay hot at night?',
  description: cardDescription,
  descriptionVersion: 4,
  status: 'Script Review',
  statusId: 'c3Rv9wLm',
  rank: 'a3V',
  priority: 'high',
  labels: ['Explainer', 'Needs sources'],
  dueDate: '2026-11-06',
  fields: { ideaSource: 'Audience question', format: 'Long-form', targetMinutes: 12 },
  pageId: 'PgWk3Nq7Hd1Lm5Rx9Zc2',
  archived: false,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-19T08:30:12.204Z',
  createdBy: owner,
  updatedBy: agent,
};
const newCardExample = {
  ...cardExample,
  id: 'Cd9Bv2Xk6Mq1Hs4Lw8Pe',
  key: 'NI-43',
  number: 43,
  title: 'How do noise-cancelling headphones work?',
  description: 'Viewer asked in the comments of NI-31.',
  descriptionVersion: 1,
  status: 'Idea',
  statusId: 'c0Id3a7K',
  rank: 'a7',
  priority: 'medium',
  labels: ['Explainer'],
  // Unset optional values are omitted from the JSON.
  dueDate: undefined,
  fields: { ideaSource: 'Audience question', format: 'Short' },
  pageId: undefined,
  createdAt: '2026-10-19T09:12:44.018Z',
  updatedAt: '2026-10-19T09:12:44.018Z',
  createdBy: agent,
};

const workPageContent = '## Hook\nAsphalt and brick soak up heat all day…\n\n## Script\n\n## B-roll';
const pageExample = {
  id: 'PgWk3Nq7Hd1Lm5Rx9Zc2',
  title: 'NI-42 Why do cities stay hot at night?',
  icon: '🎬',
  parentId: 'PgScripts7Rq1Vn4Xc0B',
  rank: 'a4',
  content: workPageContent,
  version: 5,
  isTemplate: false,
  cardId: cardExample.id,
  trashed: false,
  createdAt: '2026-10-03T10:00:00.000Z',
  updatedAt: '2026-10-19T08:30:12.204Z',
  updatedBy: agent,
};
const versionExample = {
  id: 'Vr6Lq2Hx8Nm4Kt0Wz1Pa',
  version: 5,
  title: pageExample.title,
  content: workPageContent,
  savedAt: '2026-10-19T08:30:12.204Z',
  actor: agent,
};
const threadExample = {
  id: 'Th2Kx9Lm4Qr7Vn1Hs5Wd',
  quote: 'give it back all night',
  prefix: 'soak up heat all day and ',
  suffix: '.',
  resolved: false,
  messages: [
    { id: 'Ms3Hq7Lx1Vb5', body: 'Can we show this with a thermal camera shot?', author: owner, createdAt: '2026-10-19T08:41:00.000Z' },
    { id: 'Ms8Nr2Kw6Zt0', body: 'Added two stock clips to the B-roll section.', author: agent, createdAt: '2026-10-19T08:52:30.000Z' },
  ],
  createdAt: '2026-10-19T08:41:00.000Z',
};
const commentExample = {
  id: 'Cm5Rt1Hq9Lx3Vk7Np2Zs',
  body: 'First draft of the script is in the work page — ready for review.',
  author: agent,
  createdAt: '2026-10-19T08:31:02.117Z',
};
const attachmentExample = {
  id: 'At7Kp3Lx9Hq2Vm6Rz1Nw',
  name: 'thumbnail-draft.png',
  size: 482113,
  contentType: 'image/png',
  storagePath: `attachments/${cardExample.id}/At7Kp3Lx9Hq2Vm6Rz1Nw/thumbnail-draft.png`,
  uploadedBy: agent,
  createdAt: '2026-10-19T08:35:40.000Z',
  url: 'https://storage.googleapis.com/fira-app.appspot.com/attachments/Cd4Hq8Lm2Rz6Wx0Kp3Ty/At7Kp3Lx9Hq2Vm6Rz1Nw/thumbnail-draft.png?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires=3600&X-Goog-Signature=5f2c9a',
  urlExpiresAt: '2026-10-19T09:35:40.000Z',
};
const activityExamples = [
  { id: 'Ac0Cr1Hq', at: '2026-10-01T09:00:00.000Z', actor: owner, kind: 'created' },
  { id: 'Ac1Fd2Lx', at: '2026-10-02T14:05:10.000Z', actor: agent, kind: 'field', field: 'ideaSource', from: null, to: 'Audience question' },
  { id: 'Ac2St3Vm', at: '2026-10-19T08:30:12.204Z', actor: agent, kind: 'status', from: 'Research', to: 'Script Review' },
  { id: 'Ac3Ds4Kp', at: '2026-10-19T08:30:12.204Z', actor: agent, kind: 'description', from: 3, to: 4 },
  { id: 'Ac4Cm5Rt', at: '2026-10-19T08:31:02.117Z', actor: agent, kind: 'comment', to: commentExample.id },
];
const labelExamples = [
  { id: 'Lb1Ex7Hq2Vm', name: 'Explainer', color: 'blue' },
  { id: 'Lb2Ns4Kx8Rt', name: 'Needs sources', color: 'orange' },
  { id: 'Lb3Sp9Lw1Zc', name: 'Sponsor', color: 'green' },
];
const tokenExample = {
  id: agent.id,
  name: 'agen',
  color: 'blue',
  prefix: 'fira_a1b',
  createdAt: '2026-09-02T08:20:00.000Z',
  lastUsedAt: '2026-10-19T08:30:11.000Z',
  revoked: false,
};
const errorExample = (code: string, message: string, extra: Record<string, unknown> = {}) => ({ error: { code, message, ...extra } });

// ---------------------------------------------------------------- getting started guide (info.description)

const guide = `
fira is a fast, personal Jira + Confluence replacement: a kanban **board** (projects with columns, cards, epics, subtasks, labels and custom fields) and Notion-style **docs** (a tree of Markdown pages with version history and inline comment threads).

This REST API lets automation agents do what the app does — search and move cards, comment, attach files, write pages and discuss them — and everything they change shows up live in the app, attributed to the agent's token.

## Getting started

### 1. Create a token

In fira, open **Settings → API tokens** ([${SITE}/settings/tokens](${SITE}/settings/tokens)), name a token after the agent that will use it (for example \`agen\`) and copy the secret. It looks like \`fira_\` followed by 32 letters and digits and is **shown only once** (fira stores only its hash). Revoking a token there takes effect immediately.

### 2. Make a request

Base URL: \`${BASE}\`. Send the token as a bearer token with every request:

\`\`\`bash
export FIRA_TOKEN=fira_...
curl ${BASE}/me -H "Authorization: Bearer $FIRA_TOKEN"
# {"type":"token","id":"Tk8Qm2Vx4LpZr7Ws1Hn3","name":"agen"}
\`\`\`

Bodies are JSON (\`Content-Type: application/json\`), except attachment uploads (\`multipart/form-data\`). Timestamps are ISO 8601 strings in UTC, dates are \`YYYY-MM-DD\`, and card descriptions, comments and pages are Markdown.

To send requests from this page, open an endpoint's **Test Request** panel and paste your token into the Bearer authentication field. It stays in this browser only (local storage).

## Errors

Every error has the same shape: a machine-readable \`code\` and a \`message\` written to be acted on, sometimes with extra members.

\`\`\`json
{
  "error": {
    "code": "unprocessable",
    "message": "Unknown status \\"Doing\\" for project NI. Valid: ${columnNames.join(', ')}",
    "validStatuses": ${JSON.stringify(columnNames)}
  }
}
\`\`\`

| Status | \`code\` | When |
| --- | --- | --- |
| 400 | \`bad_request\` | Malformed request: invalid JSON, wrong JSON types, **unknown body fields** (a typo such as \`label\` for \`labels\` is rejected, not ignored), missing required fields, bad \`limit\`/\`cursor\`/\`sort\` |
| 401 | \`unauthorized\` | Missing \`Authorization\` header, malformed or revoked token |
| 403 | \`forbidden\` | Token management by anyone but the owner |
| 404 | \`not_found\` | Unknown card key, project, page, thread or attachment; unknown route |
| 405 | \`method_not_allowed\` | The path exists, but not with this method (see the \`Allow\` header) |
| 409 | \`version_conflict\` | A versioned write based on a stale version (see below) |
| 409 | \`conflict\` | The card already has a work page |
| 413 | \`payload_too_large\` | Attachment over 4 MB |
| 422 | \`unprocessable\` | Well-formed but invalid: unknown status or field, value not allowed by a field, broken epic/card/subtask hierarchy, empty title or comment |
| 500 | \`internal\` | A bug on fira's side |

## Pagination

List endpoints return \`{ "items": [...], "nextCursor": "..." }\`. \`limit\` is 1–200 (default 50). To get the next page, repeat the request with the same parameters plus \`cursor=<nextCursor>\`; \`nextCursor\` is \`null\` on the last page. Cursors are opaque.

\`\`\`bash
cursor=""
while :; do
  page=$(curl -sG ${BASE}/cards -H "Authorization: Bearer $FIRA_TOKEN" \\
    -d project=NI -d limit=200 \${cursor:+-d cursor=$cursor})
  echo "$page" | jq -r '.items[] | "\\(.key)\\t\\(.status)\\t\\(.title)"'
  cursor=$(echo "$page" | jq -r '.nextCursor // empty')
  [ -z "$cursor" ] && break
done
\`\`\`

## Cards, keys and statuses

- **Cards are addressed by key** — \`NI-42\` — in paths, in \`parent\` and in filters. Keys are case-insensitive (\`ni-42\` works). Responses also carry internal ids (\`id\`, \`parentId\`, \`statusId\`), which you never need to send.
- **Statuses are the columns of the card's project** and are accepted **by column name** (case-insensitive, so \`"script review"\` works) or by column id. Card responses include both \`status\` (the name) and \`statusId\`. An unknown status is a 422 that lists \`validStatuses\`. \`GET /projects/NI\` returns the columns in board order; the last one is the "done" column.
- **Custom fields** live in \`fields\`, keyed by the field's \`key\` (for example \`ideaSource\`), and are validated against the project's field definitions: select values must be one of the options (matched case-insensitively), numbers accept numeric strings, checkboxes \`true\`/\`false\`, dates \`YYYY-MM-DD\`, urls absolute http(s). Filter by them with \`field.ideaSource=Trend\`.
- **Labels** are global and referenced by name; unknown names are created on the fly.
- **Hierarchy**: an epic has no parent, a card's parent is an epic, a subtask's parent is a card, all in the same project.

\`\`\`bash
# Move NI-42 to the "Script Review" column
curl -X PATCH ${BASE}/cards/NI-42 -H "Authorization: Bearer $FIRA_TOKEN" \\
  -H "Content-Type: application/json" -d '{"status": "Script Review"}'
\`\`\`

## Versioned writes and 409 conflicts

Long text is edited by people and agents at the same time, so these writes use optimistic concurrency instead of silently overwriting each other:

- a card \`description\` needs \`descriptionVersion\`: the \`descriptionVersion\` of the card your edit is based on;
- a page \`title\` or \`content\` needs \`version\`: the page's \`version\` your edit is based on.

If the text changed in the meantime, **nothing is applied** and the response is \`409 version_conflict\` with \`error.current\`, the resource as it is now. Re-apply your change to \`current\` (or re-read it) and retry with its version. Other card properties (status, labels, fields, …) are not versioned: the last write wins, per property.

\`\`\`bash
# 1. Read the card: note descriptionVersion
curl -s ${BASE}/cards/NI-42 -H "Authorization: Bearer $FIRA_TOKEN" | jq '{descriptionVersion, description}'
# {"descriptionVersion": 4, "description": "## Hook\\n…"}

# 2. Write, based on version 4
curl -X PATCH ${BASE}/cards/NI-42 -H "Authorization: Bearer $FIRA_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"description": "## Hook\\n…\\n\\n## Sources\\n- [x] Urban heat island review (2024)", "descriptionVersion": 4}'
# 200 with "descriptionVersion": 5 — or, if someone saved first:
# 409 {"error": {"code": "version_conflict", "message": "Description is at version 5; your edit is based on 4", "current": {…}}}
\`\`\`

A re-read-and-retry loop (JavaScript):

\`\`\`js
const BASE = '${BASE}';
const headers = { Authorization: \`Bearer \${process.env.FIRA_TOKEN}\`, 'Content-Type': 'application/json' };

async function appendToDescription(key, text) {
  let card = await (await fetch(\`\${BASE}/cards/\${key}\`, { headers })).json();
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(\`\${BASE}/cards/\${key}\`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ description: card.description + text, descriptionVersion: card.descriptionVersion }),
    });
    if (res.status !== 409) return res.json();
    card = (await res.json()).error.current; // the latest card: re-apply the edit to it
  }
  throw new Error(\`\${key}: description keeps changing, giving up\`);
}
\`\`\`

## Attachments

Upload one file per request as \`multipart/form-data\` in a part named \`file\`, at most **4 MB** (larger files are rejected with 413). The stored content type is the one sent with the part. Attachment responses include a signed download \`url\` that works without the token and expires after one hour (\`urlExpiresAt\`); list the attachments again for fresh URLs.

## Actors and history

Every write is attributed to an **actor** \`{ type, id, name }\`: \`token\` for API calls (named after the token), \`user\` for the owner in the app. It appears as \`createdBy\`/\`updatedBy\` on cards, \`author\` on comments and thread messages, \`uploadedBy\` on attachments, \`updatedBy\` on pages and \`actor\` on activity entries and page versions — so name tokens after the agents using them.

Every card change writes entries to the card's activity timeline (\`GET /cards/{key}/activity\`), exactly like the app does; status entries record column names. Every page title/content save through the API writes a version snapshot (\`GET /pages/{id}/versions\`).

## Token management

The \`/tokens\` endpoints back **Settings → API tokens** and require the owner's Firebase ID token, not an API token: agents cannot create or revoke tokens.
`.trim();

// ---------------------------------------------------------------- the document

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'fira API',
    version: '1.0.0',
    summary: 'REST API of fira, a personal Jira + Confluence replacement, for automation agents.',
    description: guide,
  },
  externalDocs: { description: 'fira API documentation', url: DOCS },
  servers: [{ url: '/api/v1', description: 'This deployment (same origin)' }],
  security: [{ bearerToken: [] }],
  tags: [
    {
      name: 'Cards',
      description:
        'Cards on the kanban board: epics, cards and subtasks. Search and filter them, create them, move them between columns by status name, edit properties and custom fields, and create their linked work page.',
    },
    { name: 'Comments', description: 'Markdown comments on a card, oldest first. Adding one logs a `comment` activity entry.' },
    {
      name: 'Activity',
      description: 'The timeline of everything that happened to a card — written by the app and the API alike, in the same transaction as the change.',
    },
    { name: 'Attachments', description: 'Files on a card (≤ 4 MB each), stored in Firebase Storage and downloaded through signed URLs.' },
    {
      name: 'Pages',
      description: 'Docs: one tree of Markdown pages, including templates and the trash. Title/content saves are versioned and snapshotted.',
    },
    { name: 'Threads', description: 'Inline comment threads anchored to a quote in a page, with replies and resolve/reopen.' },
    { name: 'Projects & labels', description: 'Read-only project configuration (columns, custom fields) and the global label list.' },
    { name: 'Tokens', description: "API token management, used by Settings → API tokens. Requires the owner's Firebase ID token." },
    { name: 'Meta', description: 'The calling actor and this OpenAPI document.' },
  ],
  'x-tagGroups': [
    { name: 'Board', tags: ['Cards', 'Comments', 'Activity', 'Attachments', 'Projects & labels'] },
    { name: 'Docs', tags: ['Pages', 'Threads'] },
    { name: 'Account', tags: ['Tokens', 'Meta'] },
  ],
  paths: {
    // ------------------------------------------------------------ cards
    '/cards': {
      get: {
        tags: ['Cards'],
        operationId: 'searchCards',
        summary: 'Search cards',
        description: [
          'Returns the cards matching all given filters, as full card objects. Every filter is optional; without `project`, all projects are searched.',
          '',
          '- `status` and `label` may repeat: OR within a parameter, AND across parameters (`status=Research&status=Script&label=Explainer`).',
          '- `status` takes column names (case-insensitive) or ids. With `project`, an unknown status or `field.<key>` is a 422; across projects, a status matches the cards whose project has a column of that name.',
          '- `q` is a case-insensitive substring match on title and description.',
          '- `parent` lists the children of a card: the cards of an epic, or the subtasks of a card.',
          '- Archived cards are excluded unless `archived=true` (only archived) or `archived=all`.',
          '- `sort=rank` (default) is board order: project, column, position in the column.',
        ].join('\n'),
        parameters: [
          query('project', { type: 'string' }, 'Project key (case-insensitive)', { example: 'NI' }),
          query('status', { type: 'array', items: { type: 'string' } }, 'Column name (case-insensitive) or id; repeatable', {
            style: 'form',
            explode: true,
            example: ['Research', 'Script Review'],
          }),
          query('label', { type: 'array', items: { type: 'string' } }, 'Label name (case-insensitive); repeatable', {
            style: 'form',
            explode: true,
            example: ['Explainer'],
          }),
          query('type', { type: 'string', enum: CARD_TYPES }, 'Card type'),
          query('parent', { type: 'string' }, 'Parent card key: the cards of an epic or the subtasks of a card', { example: 'NI-7' }),
          query('priority', { type: 'string', enum: PRIORITIES }, 'Priority'),
          query('q', { type: 'string' }, 'Case-insensitive substring of title or description', { example: 'heat' }),
          {
            name: 'field.<key>',
            in: 'query',
            required: false,
            description:
              'Custom field filter: replace `<key>` with the field key, e.g. `field.ideaSource=Trend`. Matches case-insensitively; multiselect fields match when they contain the value; an empty value matches cards without the field; repeat for OR.',
            schema: { type: 'string' },
          },
          query('archived', { type: 'string', enum: ['false', 'true', 'all'], default: 'false' }, '`false`: active cards only, `true`: archived only, `all`: both'),
          query(
            'sort',
            { type: 'string', enum: ['rank', 'created', '-created', 'updated', '-updated'], default: 'rank' },
            '`rank` is board order (project, column, position); `-` means descending',
          ),
          param('limit'),
          param('cursor'),
        ],
        responses: {
          200: ok('A page of matching cards', pageOf('Card'), list([cardExample], 'eyJvIjo1MH0')),
          ...errors(400, 401, 404, 422),
        },
        'x-codeSamples': [
          curl(
            'curl',
            `curl -G ${BASE}/cards \\
  -H "Authorization: Bearer $FIRA_TOKEN" \\
  -d project=NI \\
  --data-urlencode "status=Script Review" \\
  -d label=Explainer \\
  -d field.ideaSource=Trend \\
  -d q=heat \\
  -d sort=-updated`,
          ),
        ],
      },
      post: {
        tags: ['Cards'],
        operationId: 'createCard',
        summary: 'Create a card',
        description: [
          'Creates a card with the next number of the project (`NI-43`), appended at the bottom of its column, and logs a `created` activity entry.',
          '',
          'Defaults: `status` = the first column, `type` = `card`, `priority` = `none`, no labels or fields. Label names that do not exist yet are created. `fields` is validated against the project\'s field definitions. Hierarchy: an epic has no parent, a card\'s parent (optional) must be an epic and a subtask\'s parent (required) a card, in the same project.',
        ].join('\n'),
        requestBody: {
          required: true,
          content: jsonExamples(ref('CardCreate'), {
            idea: [
              'A new idea in the first column',
              {
                project: 'NI',
                title: 'How do noise-cancelling headphones work?',
                description: 'Viewer asked in the comments of NI-31.',
                priority: 'medium',
                labels: ['Explainer'],
                fields: { ideaSource: 'Audience question', format: 'Short' },
              },
            ],
            subtask: ['A subtask of NI-42 in a given column', { project: 'NI', title: 'Find thermal camera B-roll', type: 'subtask', parent: 'NI-42', status: 'Research' }],
            epic: ['An epic', { project: 'NI', title: 'Winter science series', type: 'epic', dueDate: '2026-12-15' }],
          }),
        },
        responses: { 201: ok('The created card', ref('Card'), newCardExample), ...errors(400, 401, 404, 422) },
        'x-codeSamples': [
          curl(
            'curl',
            `curl -X POST ${BASE}/cards \\
  -H "Authorization: Bearer $FIRA_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "project": "NI",
    "title": "How do noise-cancelling headphones work?",
    "description": "Viewer asked in the comments of NI-31.",
    "labels": ["Explainer"],
    "fields": { "ideaSource": "Audience question", "format": "Short" }
  }'`,
          ),
        ],
      },
    },
    '/cards/{key}': {
      parameters: [param('cardKey')],
      get: {
        tags: ['Cards'],
        operationId: 'getCard',
        summary: 'Get a card',
        description: 'Returns one card by key, archived or not. Use its `descriptionVersion` when editing the description.',
        responses: { 200: ok('The card', ref('Card'), cardExample), ...errors(401, 404) },
      },
      patch: {
        tags: ['Cards'],
        operationId: 'updateCard',
        summary: 'Update a card',
        description: [
          'Applies the given changes in one transaction and logs one activity entry per changed value. Omitted properties are left alone; a patch that changes nothing writes nothing.',
          '',
          '- `status`: column name (case-insensitive) or id; moves the card to the bottom of that column. Moving to the last column is how a card is completed.',
          '- `fields` merges per key; `null` removes a value.',
          '- `labels` replaces the list; `addLabels` / `removeLabels` are applied after it (names, case-insensitive; unknown names are created).',
          '- `parent`: a card key, or `null` to detach (a subtask always needs one).',
          '- `dueDate`: `YYYY-MM-DD`, or `null` to clear.',
          '- `description` requires `descriptionVersion`, the version your edit is based on. If the description changed since, nothing is applied and the response is 409 `version_conflict` with the current card; see *Versioned writes* above. A changed description bumps `descriptionVersion` by one.',
        ].join('\n'),
        requestBody: {
          required: true,
          content: jsonExamples(ref('CardPatch'), {
            move: ['Move to a column by name', { status: 'Script Review' }],
            properties: ['Labels, priority, fields', { priority: 'urgent', addLabels: ['Sponsor'], removeLabels: ['Needs sources'], fields: { sponsored: true, targetMinutes: 10 } }],
            description: ['Edit the description (versioned)', { description: `${cardDescription}\n- [x] NOAA heat data`, descriptionVersion: 4 }],
            archive: ['Archive', { archived: true }],
          }),
        },
        responses: {
          200: ok('The updated card', ref('Card'), cardExample),
          409: {
            description: 'Stale `descriptionVersion`: the description changed since your read. Nothing was applied; `error.current` is the card as it is now.',
            content: json(
              ref('VersionConflict'),
              errorExample('version_conflict', 'Description is at version 5; your edit is based on 4', { current: { ...cardExample, descriptionVersion: 5 } }),
            ),
          },
          ...errors(400, 401, 404, 422),
        },
        'x-codeSamples': [
          curl(
            'Move by status name (curl)',
            `curl -X PATCH ${BASE}/cards/NI-42 \\
  -H "Authorization: Bearer $FIRA_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "Script Review"}'`,
          ),
          curl(
            'Update description (curl)',
            `# The descriptionVersion you read with GET /cards/NI-42; 409 version_conflict if it moved on
curl -X PATCH ${BASE}/cards/NI-42 \\
  -H "Authorization: Bearer $FIRA_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"description": "## Hook\\nAsphalt and brick soak up heat all day…", "descriptionVersion": 4}'`,
          ),
        ],
      },
    },
    '/cards/{key}/page': {
      post: {
        tags: ['Cards'],
        operationId: 'createWorkPage',
        summary: "Create the card's work page",
        description:
          "Creates a page titled `<key> <title>` with the content and icon of `template` (default: the project's page template), under the project's page parent (or at the root), and links it both ways (`card.pageId`, `page.cardId`). Logs a `page` activity entry and writes the page's first version snapshot. A card has at most one work page: 409 if it already has one.",
        parameters: [param('cardKey')],
        requestBody: {
          required: false,
          content: json(
            {
              type: 'object',
              additionalProperties: false,
              properties: { template: { type: 'string', description: "Id of the page to copy content and icon from (default: the project's page template)" } },
            },
            {},
          ),
        },
        responses: {
          201: ok(
            'The new page and the updated card',
            { type: 'object', required: ['page', 'card'], properties: { page: ref('Page'), card: ref('Card') } },
            { page: { ...pageExample, version: 1, updatedAt: pageExample.createdAt }, card: cardExample },
          ),
          ...errors(400, 401, 404, 409, 422),
        },
      },
    },

    // ------------------------------------------------------------ comments
    '/cards/{key}/comments': {
      parameters: [param('cardKey')],
      get: {
        tags: ['Comments'],
        operationId: 'listComments',
        summary: 'List comments',
        description: "The card's comments, oldest first.",
        parameters: [param('limit'), param('cursor')],
        responses: { 200: ok('A page of comments', pageOf('Comment'), list([commentExample])), ...errors(400, 401, 404) },
      },
      post: {
        tags: ['Comments'],
        operationId: 'addComment',
        summary: 'Add a comment',
        description:
          'Adds a Markdown comment (1–50,000 characters) by the calling token and logs a `comment` activity entry whose `to` is the comment id. Card keys in the text (`NI-12`) render as links in the app.',
        requestBody: body(
          { type: 'object', required: ['body'], additionalProperties: false, properties: { body: { type: 'string', maxLength: 50000, description: 'Markdown' } } },
          { body: commentExample.body },
        ),
        responses: { 201: ok('The created comment', ref('Comment'), commentExample), ...errors(400, 401, 404, 422) },
        'x-codeSamples': [
          curl(
            'curl',
            `curl -X POST ${BASE}/cards/NI-42/comments \\
  -H "Authorization: Bearer $FIRA_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"body": "First draft of the script is in the work page — ready for **review**."}'`,
          ),
        ],
      },
    },

    // ------------------------------------------------------------ activity
    '/cards/{key}/activity': {
      get: {
        tags: ['Activity'],
        operationId: 'listActivity',
        summary: 'List activity',
        description:
          "The card's activity timeline, oldest first. Filter by `kind` and poll with `since` (strictly after) to pick up only new entries. See the `Activity` schema for what `from`/`to` hold per kind.",
        parameters: [
          param('cardKey'),
          query('kind', { type: 'array', items: { type: 'string', enum: ACTIVITY_KINDS } }, 'Only these kinds; repeatable or comma-separated', {
            style: 'form',
            explode: true,
            example: ['status', 'comment'],
          }),
          query('since', { ...timestampSchema(), description: 'ISO 8601; only entries strictly after this time' }, 'Only entries after this time', {
            example: '2026-10-19T00:00:00Z',
          }),
          param('limit'),
          param('cursor'),
        ],
        responses: { 200: ok('A page of activity entries', pageOf('Activity'), list(activityExamples)), ...errors(400, 401, 404, 422) },
      },
    },

    // ------------------------------------------------------------ attachments
    '/cards/{key}/attachments': {
      parameters: [param('cardKey')],
      get: {
        tags: ['Attachments'],
        operationId: 'listAttachments',
        summary: 'List attachments',
        description: "The card's attachments, oldest first, each with a fresh signed download `url` valid for one hour.",
        parameters: [param('limit'), param('cursor')],
        responses: { 200: ok('A page of attachments', pageOf('AttachmentWithUrl'), list([attachmentExample])), ...errors(400, 401, 404) },
      },
      post: {
        tags: ['Attachments'],
        operationId: 'uploadAttachment',
        summary: 'Upload an attachment',
        description:
          'Uploads one file as `multipart/form-data` in the part `file` (at most 4 MB; 413 otherwise). The stored name is the part\'s file name (path separators replaced) and the content type the part\'s. Logs an `attachment` activity entry whose `to` is the file name.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary', description: 'The file, at most 4 MB' } },
              },
            },
          },
        },
        responses: { 201: ok('The stored attachment', ref('AttachmentWithUrl'), attachmentExample), ...errors(400, 401, 404, 413) },
        'x-codeSamples': [
          curl(
            'curl',
            `curl -X POST ${BASE}/cards/NI-42/attachments \\
  -H "Authorization: Bearer $FIRA_TOKEN" \\
  -F "file=@thumbnail-draft.png;type=image/png"`,
          ),
        ],
      },
    },
    '/cards/{key}/attachments/{id}': {
      delete: {
        tags: ['Attachments'],
        operationId: 'deleteAttachment',
        summary: 'Delete an attachment',
        description: 'Deletes the attachment and its stored file, and logs an `attachment` activity entry whose `from` is the file name.',
        parameters: [param('cardKey'), { name: 'id', in: 'path', required: true, description: 'Attachment id', schema: { type: 'string' }, example: attachmentExample.id }],
        responses: { 204: { description: 'Deleted' }, ...errors(401, 404) },
      },
    },

    // ------------------------------------------------------------ pages
    '/pages': {
      get: {
        tags: ['Pages'],
        operationId: 'listPages',
        summary: 'List pages',
        description:
          'Pages in tree order (by rank among siblings), filtered by parent, text, template flag and trash. Live (non-trashed) pages unless `trashed=true`. Returns full pages including `content`.',
        parameters: [
          query('parent', { type: 'string' }, 'Only the children of this page id; `root` for top-level pages. All levels when omitted.', { example: 'root' }),
          query('q', { type: 'string' }, 'Case-insensitive substring of title or content'),
          query('template', { type: 'boolean' }, 'Only templates (`true`) or only non-templates (`false`); both when omitted'),
          query('trashed', { type: 'boolean', default: false }, 'List the trash instead of live pages'),
          param('limit'),
          param('cursor'),
        ],
        responses: { 200: ok('A page of pages', pageOf('Page'), list([pageExample])), ...errors(400, 401) },
      },
      post: {
        tags: ['Pages'],
        operationId: 'createPage',
        summary: 'Create a page',
        description:
          "Creates a page at version 1 (with its first version snapshot), appended after its siblings. With `template`, the template's content and icon — and its title, when `title` is omitted — are copied; an explicit `content` or `icon` wins. The parent and the template must exist and not be in the trash (422).",
        requestBody: {
          required: true,
          content: jsonExamples(ref('PageCreate'), {
            page: ['A page under a parent', { title: 'Thumbnail checklist', parent: 'PgScripts7Rq1Vn4Xc0B', content: '- [ ] Face visible\n- [ ] 3 words max', icon: '🖼️' }],
            fromTemplate: ['From a template', { title: 'NI-43 Noise-cancelling headphones', template: 'PgTmpl5Script0Hk2Lq9', parent: 'PgScripts7Rq1Vn4Xc0B' }],
            template: ['A new template', { title: 'Script template', content: '## Hook\n\n## Script\n\n## B-roll', isTemplate: true }],
          }),
        },
        responses: {
          201: ok('The created page', ref('Page'), {
            ...pageExample,
            id: 'PgNw8Lq2Hx6Rt0Vm4Kz1',
            title: 'Thumbnail checklist',
            icon: '🖼️',
            content: '- [ ] Face visible\n- [ ] 3 words max',
            version: 1,
            rank: 'a5',
            cardId: undefined,
            createdAt: '2026-10-19T09:20:00.000Z',
            updatedAt: '2026-10-19T09:20:00.000Z',
          }),
          ...errors(400, 401, 422),
        },
      },
    },
    '/pages/{id}': {
      parameters: [param('pageId')],
      get: {
        tags: ['Pages'],
        operationId: 'getPage',
        summary: 'Get a page',
        description: 'Returns one page with its Markdown content, trashed or not. Use its `version` when saving the title or content.',
        responses: { 200: ok('The page', ref('Page'), pageExample), ...errors(401, 404) },
      },
      patch: {
        tags: ['Pages'],
        operationId: 'updatePage',
        summary: 'Update a page',
        description: [
          'Applies the given changes in one transaction. Omitted properties are left alone.',
          '',
          '- `title` / `content` require `version`, the version your edit is based on. A save bumps `version` by one and writes a version snapshot. If the page changed since, nothing is applied and the response is 409 `version_conflict` with the current page; see *Versioned writes* above.',
          '- `parent` moves the page under another page (appended after its new siblings), or to the root with `null`. Moving a page under itself or its descendants is a 422.',
          '- `trashed: true` trashes the page and its live descendants; `trashed: false` restores it together with the descendants trashed with it (to the root if its parent is still in the trash).',
          '- `icon: null` clears the icon; `isTemplate` turns the page into a template or back.',
        ].join('\n'),
        requestBody: {
          required: true,
          content: jsonExamples(ref('PagePatch'), {
            content: ['Save content (versioned)', { content: `${workPageContent}\n- Thermal camera: city at night`, version: 5 }],
            move: ['Move to the root', { parent: null }],
            trash: ['Move to the trash', { trashed: true }],
          }),
        },
        responses: {
          200: ok('The updated page', ref('Page'), { ...pageExample, version: 6 }),
          409: {
            description: 'Stale `version`: the page changed since your read. Nothing was applied; `error.current` is the page as it is now.',
            content: json(
              ref('VersionConflict'),
              errorExample('version_conflict', 'Page is at version 6; your edit is based on 5', { current: { ...pageExample, version: 6, updatedBy: owner } }),
            ),
          },
          ...errors(400, 401, 404, 422),
        },
      },
    },
    '/pages/{id}/versions': {
      get: {
        tags: ['Pages'],
        operationId: 'listPageVersions',
        summary: 'List page versions',
        description:
          "The page's version snapshots, newest first. The app writes one per editing session (a different editor or more than 10 minutes since the last snapshot); the API writes one on every save.",
        parameters: [param('pageId'), param('limit'), param('cursor')],
        responses: { 200: ok('A page of versions', pageOf('PageVersion'), list([versionExample])), ...errors(400, 401, 404) },
      },
    },

    // ------------------------------------------------------------ threads
    '/pages/{id}/threads': {
      parameters: [param('pageId')],
      get: {
        tags: ['Threads'],
        operationId: 'listThreads',
        summary: 'List threads',
        description: "The page's inline comment threads, oldest first; open ones unless `resolved` says otherwise.",
        parameters: [
          query('resolved', { type: 'string', enum: ['false', 'true', 'all'], default: 'false' }, 'Open threads, resolved ones, or all'),
          param('limit'),
          param('cursor'),
        ],
        responses: { 200: ok('A page of threads', pageOf('Thread'), list([threadExample])), ...errors(400, 401, 404) },
      },
      post: {
        tags: ['Threads'],
        operationId: 'createThread',
        summary: 'Start a thread',
        description:
          'Starts a thread on a passage of the page with its first message. `quote` is the commented text exactly as it appears in the page; `prefix`/`suffix` (the text just before and after it, at most 32 characters each are kept) let the app find the right occurrence when the quote appears more than once.',
        requestBody: body(
          {
            type: 'object',
            required: ['quote', 'body'],
            additionalProperties: false,
            properties: {
              quote: { type: 'string', minLength: 1, description: 'The commented text, as it appears in the page' },
              prefix: { type: 'string', description: 'Text right before the quote (the last 32 characters are kept)' },
              suffix: { type: 'string', description: 'Text right after the quote (the first 32 characters are kept)' },
              body: { type: 'string', maxLength: 50000, description: 'The first message (Markdown)' },
            },
          },
          { quote: threadExample.quote, prefix: threadExample.prefix, suffix: threadExample.suffix, body: threadExample.messages[0].body },
        ),
        responses: {
          201: ok('The created thread', ref('Thread'), { ...threadExample, messages: [threadExample.messages[0]] }),
          ...errors(400, 401, 404, 422),
        },
      },
    },
    '/pages/{id}/threads/{tid}': {
      patch: {
        tags: ['Threads'],
        operationId: 'resolveThread',
        summary: 'Resolve or reopen a thread',
        description: 'Sets `resolved` (and `resolvedAt`, cleared on reopen).',
        parameters: [param('pageId'), param('threadId')],
        requestBody: body(
          { type: 'object', required: ['resolved'], additionalProperties: false, properties: { resolved: { type: 'boolean' } } },
          { resolved: true },
        ),
        responses: {
          200: ok('The updated thread', ref('Thread'), { ...threadExample, resolved: true, resolvedAt: '2026-10-19T09:00:00.000Z' }),
          ...errors(400, 401, 404),
        },
      },
    },
    '/pages/{id}/threads/{tid}/messages': {
      post: {
        tags: ['Threads'],
        operationId: 'replyToThread',
        summary: 'Reply to a thread',
        description: 'Appends a Markdown message (1–50,000 characters) by the calling token and returns the whole thread.',
        parameters: [param('pageId'), param('threadId')],
        requestBody: body(
          { type: 'object', required: ['body'], additionalProperties: false, properties: { body: { type: 'string', maxLength: 50000, description: 'Markdown' } } },
          { body: threadExample.messages[1].body },
        ),
        responses: { 201: ok('The thread with the new message', ref('Thread'), threadExample), ...errors(400, 401, 404, 422) },
      },
    },

    // ------------------------------------------------------------ projects & labels
    '/projects': {
      get: {
        tags: ['Projects & labels'],
        operationId: 'listProjects',
        summary: 'List projects',
        description: 'All projects in sidebar order, with their columns (board order) and custom field definitions.',
        parameters: [param('limit'), param('cursor')],
        responses: { 200: ok('A page of projects', pageOf('Project'), list([projectExample])), ...errors(400, 401) },
      },
    },
    '/projects/{key}': {
      get: {
        tags: ['Projects & labels'],
        operationId: 'getProject',
        summary: 'Get a project',
        description: 'One project by key (case-insensitive). Read it to learn the column names cards can move to and the custom fields cards accept.',
        parameters: [{ name: 'key', in: 'path', required: true, description: 'Project key (case-insensitive)', schema: { type: 'string' }, example: 'NI' }],
        responses: { 200: ok('The project', ref('Project'), projectExample), ...errors(401, 404) },
      },
    },
    '/labels': {
      get: {
        tags: ['Projects & labels'],
        operationId: 'listLabels',
        summary: 'List labels',
        description: 'The global labels, by name. Cards reference labels by name; creating or updating a card with a new name creates the label.',
        parameters: [param('limit'), param('cursor')],
        responses: { 200: ok('A page of labels', pageOf('Label'), list(labelExamples)), ...errors(400, 401) },
      },
    },

    // ------------------------------------------------------------ tokens
    '/tokens': {
      get: {
        tags: ['Tokens'],
        operationId: 'listTokens',
        summary: 'List API tokens',
        description: 'All tokens, newest first, including revoked ones. Secrets are never returned (only their first 8 characters, `prefix`).',
        security: [{ firebaseIdToken: [] }],
        parameters: [param('limit'), param('cursor')],
        responses: { 200: ok('A page of tokens', pageOf('ApiToken'), list([tokenExample])), ...errors(400, 401, 403) },
      },
      post: {
        tags: ['Tokens'],
        operationId: 'createToken',
        summary: 'Create an API token',
        description: 'Creates a token and returns its secret — the only time it is ever shown. The name (1–40 characters) is the actor name on everything the token changes.',
        security: [{ firebaseIdToken: [] }],
        requestBody: body(
          {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 40, description: 'Shown as the author of its changes' },
              color: { type: 'string', enum: LABEL_COLORS, description: 'Avatar color; derived from the name by default' },
            },
          },
          { name: 'agen', color: 'blue' },
        ),
        responses: {
          201: ok(
            'The token and its secret',
            {
              type: 'object',
              required: ['token', 'secret'],
              properties: { token: ref('ApiToken'), secret: { type: 'string', pattern: '^fira_[0-9A-Za-z]{32}$', description: 'Shown once' } },
            },
            { token: { ...tokenExample, lastUsedAt: undefined, createdAt: '2026-10-19T08:00:00.000Z' }, secret: 'fira_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6' },
          ),
          ...errors(401, 403, 422),
        },
      },
    },
    '/tokens/{id}': {
      delete: {
        tags: ['Tokens'],
        operationId: 'revokeToken',
        summary: 'Revoke an API token',
        description: 'Marks the token revoked; requests with it fail with 401 from then on. Revoked tokens stay listed.',
        security: [{ firebaseIdToken: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, description: 'Token id', schema: { type: 'string' }, example: tokenExample.id }],
        responses: { 200: ok('The revoked token', ref('ApiToken'), { ...tokenExample, revoked: true }), ...errors(401, 403, 404) },
      },
    },

    // ------------------------------------------------------------ meta
    '/me': {
      get: {
        tags: ['Meta'],
        operationId: 'getMe',
        summary: 'Get the calling actor',
        description: 'The actor of the token you are calling with. A cheap way to check that a token works.',
        responses: { 200: ok('The token as an actor', ref('Actor'), agent), ...errors(401) },
        'x-codeSamples': [curl('curl', `curl ${BASE}/me -H "Authorization: Bearer $FIRA_TOKEN"`)],
      },
    },
    '/openapi.json': {
      get: {
        tags: ['Meta'],
        operationId: 'getOpenApi',
        summary: 'Get this OpenAPI document',
        description: `The OpenAPI 3.1 description of this API, without authentication. Rendered at [${DOCS}](${DOCS}).`,
        security: [],
        responses: { 200: ok('OpenAPI 3.1 document', { type: 'object' }) },
      },
    },
  },

  components: {
    securitySchemes: {
      bearerToken: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'fira_<32 base62>',
        description: 'A personal API token from Settings → API tokens: `Authorization: Bearer fira_…`',
      },
      firebaseIdToken: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: "The owner's Firebase ID token (only for /tokens; the Settings UI sends it)",
      },
    },
    parameters: {
      limit: {
        name: 'limit',
        in: 'query',
        required: false,
        description: 'Page size',
        schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
      cursor: { name: 'cursor', in: 'query', required: false, description: 'The `nextCursor` of the previous page (opaque)', schema: { type: 'string' } },
      cardKey: { name: 'key', in: 'path', required: true, description: 'Card key (case-insensitive)', schema: { type: 'string' }, example: 'NI-42' },
      pageId: { name: 'id', in: 'path', required: true, description: 'Page id', schema: { type: 'string' }, example: pageExample.id },
      threadId: { name: 'tid', in: 'path', required: true, description: 'Thread id', schema: { type: 'string' }, example: threadExample.id },
    },
    responses: {
      BadRequest: {
        description: 'Malformed request: invalid JSON, wrong types, unknown or missing fields, bad `limit`/`cursor`/`sort`',
        content: json(
          ref('Error'),
          errorExample(
            'bad_request',
            'Unknown field(s): label. Allowed: title, status, priority, dueDate, parent, fields, labels, addLabels, removeLabels, archived, description, descriptionVersion',
          ),
        ),
      },
      Unauthorized: {
        description: 'Missing, malformed or revoked credentials',
        content: json(ref('Error'), errorExample('unauthorized', 'Invalid or revoked API token')),
      },
      Forbidden: { description: 'Signed in, but not the owner', content: json(ref('Error'), errorExample('forbidden', 'Owner only')) },
      NotFound: {
        description: 'Unknown card, project, page, thread, attachment or token',
        content: json(ref('Error'), errorExample('not_found', 'Card NI-99 not found')),
      },
      Conflict: { description: 'The card already has a work page', content: json(ref('Error'), errorExample('conflict', 'NI-42 already has a work page (PgWk3Nq7Hd1Lm5Rx9Zc2)')) },
      TooLarge: { description: 'The file exceeds 4 MB', content: json(ref('Error'), errorExample('payload_too_large', 'File exceeds 4 MB')) },
      Unprocessable: {
        description:
          'Well-formed but invalid: unknown status or field, value not allowed by a field, broken hierarchy, empty text. An unknown status lists `validStatuses`.',
        content: jsonExamples(ref('Error'), {
          status: [
            'Unknown status',
            errorExample('unprocessable', `Unknown status "Doing" for project NI. Valid: ${columnNames.join(', ')}`, { validStatuses: columnNames }),
          ],
          field: ['Invalid field value', errorExample('unprocessable', 'fields.format must be one of: Short, Long-form')],
          hierarchy: ['Broken hierarchy', errorExample('unprocessable', 'The parent of a subtask must be a card (NI-7 is a epic)')],
        }),
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            additionalProperties: true,
            properties: {
              code: {
                type: 'string',
                enum: ['bad_request', 'unauthorized', 'forbidden', 'not_found', 'method_not_allowed', 'conflict', 'version_conflict', 'payload_too_large', 'unprocessable', 'internal'],
                description: 'Machine-readable error code',
              },
              message: { type: 'string', description: 'What went wrong and, where useful, the valid values' },
              validStatuses: { type: 'array', items: { type: 'string' }, description: 'For an unknown status: the column names of the project' },
            },
          },
        },
      },
      VersionConflict: {
        type: 'object',
        required: ['error'],
        description: '409 for a write based on a stale `descriptionVersion` (cards) or `version` (pages).',
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message', 'current'],
            properties: {
              code: { const: 'version_conflict' },
              message: { type: 'string' },
              current: { description: 'The resource as it is now (a Card or a Page): re-apply your edit to it and retry with its version', oneOf: [ref('Card'), ref('Page')] },
            },
          },
        },
      },
      Actor: {
        type: 'object',
        description: 'Who made a change: an API token or the owner in the app.',
        required: ['type', 'id', 'name'],
        properties: {
          type: { type: 'string', enum: ['user', 'token'], description: '`token`: an API token; `user`: the owner in the app' },
          id: { type: 'string', description: 'Token id or Firebase uid' },
          name: { type: 'string', description: 'Token name or display name' },
        },
        example: agent,
      },
      ApiToken: {
        type: 'object',
        required: ['id', 'name', 'color', 'prefix', 'createdAt', 'revoked'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string', description: 'Actor name of its changes' },
          color: { type: 'string', enum: LABEL_COLORS, description: 'Avatar color in the app' },
          prefix: { type: 'string', description: 'First 8 characters of the secret, to recognize it' },
          createdAt: timestampSchema(),
          lastUsedAt: { ...timestampSchema(), description: 'Updated at most every 5 minutes' },
          revoked: { type: 'boolean' },
        },
        example: tokenExample,
      },
      Column: {
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'string' }, name: { type: 'string', description: 'The status name cards are moved with' } },
        example: columns[3],
      },
      FieldDef: {
        type: 'object',
        description: 'A custom field of a project.',
        required: ['id', 'key', 'name', 'type'],
        properties: {
          id: { type: 'string' },
          key: { type: 'string', description: 'camelCase key in `Card.fields` and in `field.<key>` filters' },
          name: { type: 'string', description: 'Display name' },
          type: { type: 'string', enum: FIELD_TYPES },
          options: { type: 'array', items: { type: 'string' }, description: 'The allowed values of a select / multiselect field' },
        },
        example: projectExample.fields[0],
      },
      Project: {
        type: 'object',
        required: ['id', 'key', 'name', 'columns', 'fields', 'nextNumber', 'rank', 'createdAt'],
        properties: {
          id: { type: 'string' },
          key: { type: 'string', description: 'Uppercase key, prefix of its card keys', example: 'NI' },
          name: { type: 'string' },
          columns: { type: 'array', items: ref('Column'), description: 'Board order; the last column is the "done" column' },
          fields: { type: 'array', items: ref('FieldDef'), description: 'Custom fields of its cards' },
          nextNumber: { type: 'integer', description: 'Number of the next card' },
          pageTemplateId: { type: 'string', description: 'Default template of work pages' },
          pageParentId: { type: 'string', description: 'Where work pages are created' },
          rank: { type: 'string', description: 'Sidebar order' },
          createdAt: timestampSchema(),
        },
      },
      Label: {
        type: 'object',
        required: ['id', 'name', 'color'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string', description: 'Unique, case-insensitive' },
          color: { type: 'string', enum: LABEL_COLORS },
        },
        example: labelExamples[0],
      },
      FieldValue: {
        description: 'A custom field value: string (text, url, select), number, boolean (checkbox), string[] (multiselect) or `YYYY-MM-DD` string (date).',
        oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'array', items: { type: 'string' } }],
      },
      Card: {
        type: 'object',
        required: [
          'id', 'projectId', 'key', 'number', 'type', 'title', 'description', 'descriptionVersion', 'status', 'statusId', 'project', 'parent',
          'rank', 'priority', 'labels', 'fields', 'archived', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
        ],
        properties: {
          id: { type: 'string', description: 'Internal id (cards are addressed by `key`)' },
          projectId: { type: 'string' },
          project: { type: 'string', description: 'Project key' },
          key: { type: 'string', description: '`<project key>-<number>`', example: 'NI-42' },
          number: { type: 'integer' },
          type: { type: 'string', enum: CARD_TYPES },
          parentId: { type: 'string' },
          parent: { type: ['string', 'null'], description: 'Parent card key (the epic of a card, the card of a subtask)' },
          title: { type: 'string' },
          description: { type: 'string', description: 'Markdown' },
          descriptionVersion: { type: 'integer', description: 'Starts at 1, +1 per description change; send it back with description edits' },
          status: { type: 'string', description: 'Column name' },
          statusId: { type: 'string', description: 'Column id' },
          rank: { type: 'string', description: 'Position within the column (fractional index; compare as plain strings, not locale-aware)' },
          priority: { type: 'string', enum: PRIORITIES },
          labels: { type: 'array', items: { type: 'string' }, description: 'Label names' },
          dueDate: { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' },
          fields: { type: 'object', additionalProperties: ref('FieldValue'), description: 'Custom field values by field key' },
          pageId: { type: 'string', description: 'The linked work page' },
          archived: { type: 'boolean' },
          createdAt: timestampSchema(),
          updatedAt: timestampSchema(),
          createdBy: ref('Actor'),
          updatedBy: ref('Actor'),
        },
      },
      CardCreate: {
        type: 'object',
        required: ['project', 'title'],
        additionalProperties: false,
        properties: {
          project: { type: 'string', description: 'Project key', example: 'NI' },
          title: { type: 'string', minLength: 1, maxLength: 500 },
          description: { type: 'string', description: 'Markdown', default: '' },
          status: { type: 'string', description: 'Column name (case-insensitive) or id; default: the first column' },
          type: { type: 'string', enum: CARD_TYPES, default: 'card' },
          parent: { type: ['string', 'null'], description: 'Parent card key: an epic for a card (optional), a card for a subtask (required)' },
          priority: { type: 'string', enum: PRIORITIES, default: 'none' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Label names; unknown ones are created' },
          dueDate: { type: ['string', 'null'], format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' },
          fields: { type: 'object', additionalProperties: ref('FieldValue'), description: "Custom field values by key, validated against the project's fields" },
        },
      },
      CardPatch: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 500 },
          status: { type: 'string', description: 'Column name (case-insensitive) or id; moves the card to the bottom of that column' },
          priority: { type: 'string', enum: PRIORITIES },
          dueDate: { type: ['string', 'null'], format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD, or null to clear' },
          parent: { type: ['string', 'null'], description: 'Parent card key, or null to detach' },
          fields: {
            type: 'object',
            additionalProperties: { oneOf: [ref('FieldValue'), { type: 'null' }] },
            description: 'Merged per key; null removes the value',
          },
          labels: { type: 'array', items: { type: 'string' }, description: 'Replaces the labels' },
          addLabels: { type: 'array', items: { type: 'string' }, description: 'Labels to add (after `labels`)' },
          removeLabels: { type: 'array', items: { type: 'string' }, description: 'Labels to remove (after `labels`, case-insensitive)' },
          archived: { type: 'boolean' },
          description: { type: 'string', description: 'Markdown; requires descriptionVersion' },
          descriptionVersion: { type: 'integer', description: 'The descriptionVersion your description edit is based on' },
        },
      },
      Activity: {
        type: 'object',
        description: [
          'One entry of a card timeline. `from`/`to` per kind:',
          '',
          '- `created`: none',
          '- `status`: column names',
          '- `title`, `priority`, `dueDate`, `archived`: the old and new value',
          '- `labels`: the old and new label lists',
          '- `field`: the old and new value of the custom field `field` (`null` when unset)',
          '- `parent`: parent card keys',
          '- `description`: the old and new `descriptionVersion` (the text itself is not logged)',
          '- `comment`: `to` = the comment id',
          '- `attachment`: `to` = the uploaded file name, or `from` = the deleted one',
          '- `page`: work page ids',
        ].join('\n'),
        required: ['id', 'at', 'actor', 'kind'],
        properties: {
          id: { type: 'string' },
          at: timestampSchema(),
          actor: ref('Actor'),
          kind: { type: 'string', enum: ACTIVITY_KINDS },
          field: { type: 'string', description: 'Field key, for kind `field`' },
          from: { $ref: '#/components/schemas/ActivityValue' },
          to: { $ref: '#/components/schemas/ActivityValue' },
        },
        example: activityExamples[2],
      },
      ActivityValue: {
        description: 'A JSON value of an activity entry',
        oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'array', items: { type: 'string' } }, { type: 'null' }],
      },
      Comment: {
        type: 'object',
        required: ['id', 'body', 'author', 'createdAt'],
        properties: {
          id: { type: 'string' },
          body: { type: 'string', description: 'Markdown' },
          author: ref('Actor'),
          createdAt: timestampSchema(),
          updatedAt: { ...timestampSchema(), description: 'Set when edited in the app' },
        },
      },
      AttachmentWithUrl: {
        type: 'object',
        required: ['id', 'name', 'size', 'contentType', 'storagePath', 'uploadedBy', 'createdAt', 'url', 'urlExpiresAt'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string', description: 'File name' },
          size: { type: 'integer', description: 'Bytes' },
          contentType: { type: 'string' },
          storagePath: { type: 'string', description: 'attachments/{cardId}/{attachmentId}/{name}' },
          uploadedBy: ref('Actor'),
          createdAt: timestampSchema(),
          url: { type: 'string', format: 'uri', description: 'Signed download URL; no token needed' },
          urlExpiresAt: { ...timestampSchema(), description: 'When `url` stops working (one hour after the request)' },
        },
      },
      Page: {
        type: 'object',
        required: ['id', 'title', 'parentId', 'rank', 'content', 'version', 'isTemplate', 'trashed', 'createdAt', 'updatedAt', 'updatedBy'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          icon: { type: 'string', description: 'Emoji' },
          parentId: { type: ['string', 'null'], description: 'Parent page id; null at the root' },
          rank: { type: 'string', description: 'Order among siblings' },
          content: { type: 'string', description: 'Markdown' },
          version: { type: 'integer', description: 'Starts at 1, +1 per title/content save; send it back with title/content edits' },
          isTemplate: { type: 'boolean' },
          cardId: { type: 'string', description: 'The card this is the work page of' },
          trashed: { type: 'boolean' },
          trashedAt: timestampSchema(),
          createdAt: timestampSchema(),
          updatedAt: { ...timestampSchema(), description: 'Last title/content save' },
          updatedBy: ref('Actor'),
        },
      },
      PageCreate: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', maxLength: 500, description: 'Required unless `template` is given' },
          parent: { type: ['string', 'null'], description: 'Parent page id (default: the root)' },
          content: { type: 'string', description: 'Markdown' },
          template: { type: 'string', description: 'Id of a page to copy content, icon and (default) title from' },
          isTemplate: { type: 'boolean', default: false, description: 'Create a template' },
          icon: { type: 'string', maxLength: 16, description: 'Emoji' },
        },
      },
      PagePatch: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', maxLength: 500, description: 'Requires version' },
          content: { type: 'string', description: 'Markdown; requires version' },
          version: { type: 'integer', description: 'Required with title/content: the version your edit is based on' },
          parent: { type: ['string', 'null'], description: 'Move under this page, or null for the root' },
          icon: { type: ['string', 'null'], maxLength: 16, description: 'Emoji, or null to clear' },
          trashed: { type: 'boolean', description: 'Trash (with descendants) or restore' },
          isTemplate: { type: 'boolean' },
        },
      },
      PageVersion: {
        type: 'object',
        required: ['id', 'version', 'title', 'content', 'savedAt', 'actor'],
        properties: {
          id: { type: 'string' },
          version: { type: 'integer' },
          title: { type: 'string' },
          content: { type: 'string', description: 'Markdown' },
          savedAt: timestampSchema(),
          actor: ref('Actor'),
        },
      },
      ThreadMessage: {
        type: 'object',
        required: ['id', 'body', 'author', 'createdAt'],
        properties: { id: { type: 'string' }, body: { type: 'string', description: 'Markdown' }, author: ref('Actor'), createdAt: timestampSchema() },
      },
      Thread: {
        type: 'object',
        required: ['id', 'quote', 'prefix', 'suffix', 'resolved', 'messages', 'createdAt'],
        properties: {
          id: { type: 'string' },
          quote: { type: 'string', description: 'The commented text' },
          prefix: { type: 'string', maxLength: 32, description: 'Text before the quote' },
          suffix: { type: 'string', maxLength: 32, description: 'Text after the quote' },
          resolved: { type: 'boolean' },
          resolvedAt: timestampSchema(),
          messages: { type: 'array', items: ref('ThreadMessage'), description: 'Oldest first' },
          createdAt: timestampSchema(),
        },
      },
    },
  },
};

function timestampSchema() {
  return { type: 'string', format: 'date-time', description: 'ISO 8601 (UTC)' };
}
