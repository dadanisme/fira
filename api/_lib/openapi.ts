import { ACTIVITY_KINDS, CARD_TYPES, FIELD_TYPES, LABEL_COLORS, PRIORITIES } from '../../shared/types.js';

/**
 * Hand-written OpenAPI 3.1 description of the REST API, served at
 * `GET /api/v1/openapi.json`. Keep in sync with api/_routes (the smoke test checks
 * that every route is documented and every documented route exists).
 */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown, example?: unknown) => ({
  'application/json': example === undefined ? { schema } : { schema, example },
});
const ok = (description: string, schema: unknown, example?: unknown) => ({ description, content: json(schema, example) });
const pageOf = (item: string) => ({
  type: 'object',
  required: ['items', 'nextCursor'],
  properties: { items: { type: 'array', items: ref(item) }, nextCursor: { type: ['string', 'null'] } },
});
const err = (description: string) => ({ $ref: `#/components/responses/${description}` });
const errors = (...codes: (400 | 401 | 404 | 409 | 413 | 422)[]) =>
  Object.fromEntries(
    codes.map((c) => [
      String(c),
      err({ 400: 'BadRequest', 401: 'Unauthorized', 404: 'NotFound', 409: 'Conflict', 413: 'TooLarge', 422: 'Unprocessable' }[c]),
    ]),
  );
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

const actorExample = { type: 'token', id: 'Xq3k9LmP0aZt', name: 'agen' };
const cardExample = {
  id: 'h3J8sK2lQ9wE',
  projectId: 'p1A2b3C4d5E6',
  key: 'NI-12',
  number: 12,
  type: 'card',
  parentId: 'e9F8g7H6i5J4',
  title: 'Fix login on Safari',
  description: 'Steps to reproduce…',
  descriptionVersion: 3,
  status: 'In Progress',
  statusId: 'k2L3m4N5',
  project: 'NI',
  parent: 'NI-3',
  rank: 'a1',
  priority: 'high',
  labels: ['Bug', 'Frontend'],
  dueDate: '2026-11-01',
  fields: { points: 3, env: 'prod' },
  pageId: 'pg7H8j9K0l1M',
  archived: false,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-19T08:30:00.000Z',
  createdBy: { type: 'user', id: 'uid123', name: 'Owner' },
  updatedBy: actorExample,
};
const pageExample = {
  id: 'pg7H8j9K0l1M',
  title: 'NI-12 Fix login on Safari',
  icon: '📋',
  parentId: 'pgParent0001',
  rank: 'a0',
  content: '## Goal\n\n## Notes',
  version: 2,
  isTemplate: false,
  cardId: 'h3J8sK2lQ9wE',
  trashed: false,
  createdAt: '2026-10-19T08:00:00.000Z',
  updatedAt: '2026-10-19T08:30:00.000Z',
  updatedBy: actorExample,
};

const timestamp = { type: 'string', format: 'date-time', description: 'ISO 8601' };
const date = { type: 'string', format: 'date', description: 'YYYY-MM-DD', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const fieldValue = {
  description: 'text/url/select: string, number: number, checkbox: boolean, multiselect: string[], date: YYYY-MM-DD',
  oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'array', items: { type: 'string' } }],
};
const activityValue = {
  oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'array', items: { type: 'string' } }, { type: 'null' }],
};

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'fira REST API',
    version: '1.0.0',
    description: [
      'REST API of fira (personal Jira + Confluence) for automation agents.',
      '',
      '- Auth: `Authorization: Bearer fira_…` (a personal API token). `/tokens` endpoints instead take the owner\'s Firebase ID token.',
      '- JSON in/out. Timestamps are ISO 8601 strings. Errors: `{ "error": { "code", "message", … } }`.',
      '- Cards are addressed by key (`NI-12`, case-insensitive). Statuses are accepted by column name (case-insensitive) or column id; card responses include both `status` (name) and `statusId`.',
      '- Lists return `{ items, nextCursor }`; pass `cursor=<nextCursor>` for the next page (`limit` 1–200, default 50).',
      '- Every card mutation writes activity entries; page title/content saves bump `version` and write a version snapshot.',
      '- Optimistic concurrency: card `description` edits need `descriptionVersion`, page `title`/`content` edits need `version`; a stale value returns 409 `version_conflict` with `error.current` (the resource as it is now).',
    ].join('\n'),
  },
  servers: [{ url: '/api/v1' }],
  security: [{ bearerToken: [] }],
  tags: [
    { name: 'meta' },
    { name: 'tokens', description: 'Owner only (Firebase ID token). Used by Settings → API tokens.' },
    { name: 'projects' },
    { name: 'cards' },
    { name: 'pages' },
  ],
  paths: {
    '/openapi.json': {
      get: {
        tags: ['meta'],
        summary: 'This OpenAPI document',
        security: [],
        responses: { 200: ok('OpenAPI 3.1 document', { type: 'object' }) },
      },
    },
    '/me': {
      get: {
        tags: ['meta'],
        summary: 'The calling actor (the API token)',
        responses: { 200: ok('Actor', ref('Actor'), actorExample), ...errors(401) },
      },
    },

    // ------------------------------------------------------------ tokens
    '/tokens': {
      get: {
        tags: ['tokens'],
        summary: 'List API tokens (newest first)',
        security: [{ firebaseIdToken: [] }],
        parameters: [param('limit'), param('cursor')],
        responses: { 200: ok('Tokens', pageOf('ApiToken')), ...errors(400, 401), 403: err('Forbidden') },
      },
      post: {
        tags: ['tokens'],
        summary: 'Create an API token; the secret is returned once',
        security: [{ firebaseIdToken: [] }],
        requestBody: body(
          {
            type: 'object',
            required: ['name'],
            additionalProperties: false,
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 40 },
              color: { type: 'string', enum: LABEL_COLORS, description: 'Defaults to a color derived from the name' },
            },
          },
          { name: 'agen' },
        ),
        responses: {
          201: ok(
            'Created',
            {
              type: 'object',
              required: ['token', 'secret'],
              properties: { token: ref('ApiToken'), secret: { type: 'string', pattern: '^fira_[0-9A-Za-z]{32}$' } },
            },
            {
              token: { id: 'Xq3k9LmP0aZt', name: 'agen', color: 'blue', prefix: 'fira_a1b', createdAt: '2026-10-19T08:00:00.000Z', revoked: false },
              secret: 'fira_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
            },
          ),
          ...errors(401, 422),
          403: err('Forbidden'),
        },
      },
    },
    '/tokens/{id}': {
      delete: {
        tags: ['tokens'],
        summary: 'Revoke an API token',
        security: [{ firebaseIdToken: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: ok('The revoked token', ref('ApiToken')), ...errors(401, 404), 403: err('Forbidden') },
      },
    },

    // ------------------------------------------------------------ projects
    '/projects': {
      get: {
        tags: ['projects'],
        summary: 'List projects (by rank) with their columns and custom fields',
        parameters: [param('limit'), param('cursor')],
        responses: { 200: ok('Projects', pageOf('Project')), ...errors(400, 401) },
      },
    },
    '/projects/{key}': {
      get: {
        tags: ['projects'],
        summary: 'Get a project by key (case-insensitive)',
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' }, example: 'NI' }],
        responses: { 200: ok('Project', ref('Project')), ...errors(401, 404) },
      },
    },
    '/labels': {
      get: {
        tags: ['projects'],
        summary: 'List labels (global, by name)',
        parameters: [param('limit'), param('cursor')],
        responses: { 200: ok('Labels', pageOf('Label')), ...errors(400, 401) },
      },
    },

    // ------------------------------------------------------------ cards
    '/cards': {
      get: {
        tags: ['cards'],
        summary: 'Search cards',
        description:
          'Filters in memory over the project\'s cards (all projects when `project` is omitted). `status` and `label` may repeat: OR within a param, AND across params. With `project`, unknown statuses or field keys are 422.',
        parameters: [
          query('project', { type: 'string' }, 'Project key', { example: 'NI' }),
          query('status', { type: 'array', items: { type: 'string' } }, 'Column name (case-insensitive) or id; repeatable', {
            style: 'form',
            explode: true,
          }),
          query('label', { type: 'array', items: { type: 'string' } }, 'Label name (case-insensitive); repeatable', {
            style: 'form',
            explode: true,
          }),
          query('type', { type: 'string', enum: CARD_TYPES }, 'Card type'),
          query('parent', { type: 'string' }, 'Parent card key (epic or card)', { example: 'NI-3' }),
          query('priority', { type: 'string', enum: PRIORITIES }, 'Priority'),
          query('q', { type: 'string' }, 'Case-insensitive substring of title or description'),
          {
            name: 'field.<key>',
            in: 'query',
            required: false,
            description:
              'Custom field filter, e.g. `field.env=prod`. Matches case-insensitively; multiselect fields match when they contain the value; repeat for OR.',
            schema: { type: 'string' },
          },
          query('archived', { type: 'string', enum: ['false', 'true', 'all'], default: 'false' }, '`false`: active cards only, `true`: archived only, `all`: both'),
          query(
            'sort',
            { type: 'string', enum: ['rank', 'created', '-created', 'updated', '-updated'], default: 'rank' },
            '`rank` is board order (project, column, rank); `-` means descending',
          ),
          param('limit'),
          param('cursor'),
        ],
        responses: {
          200: ok('Matching cards', pageOf('Card'), { items: [cardExample], nextCursor: null }),
          ...errors(400, 401, 404, 422),
        },
      },
      post: {
        tags: ['cards'],
        summary: 'Create a card',
        description:
          'Allocates the next number of the project in a transaction. Defaults: status = first column, type `card`, priority `none`. The card is appended at the end of its column. Unknown label names create labels. Hierarchy: epics have no parent; a card\'s parent is an epic; a subtask needs a parent card. Logs a `created` activity entry.',
        requestBody: body(ref('CardCreate'), {
          project: 'NI',
          title: 'Fix login on Safari',
          status: 'To Do',
          parent: 'NI-3',
          priority: 'high',
          labels: ['Bug'],
          fields: { points: 3 },
        }),
        responses: { 201: ok('Created card', ref('Card'), cardExample), ...errors(400, 401, 404, 422) },
      },
    },
    '/cards/{key}': {
      parameters: [param('cardKey')],
      get: {
        tags: ['cards'],
        summary: 'Get a card',
        responses: { 200: ok('Card', ref('Card'), cardExample), ...errors(401, 404) },
      },
      patch: {
        tags: ['cards'],
        summary: 'Update a card',
        description:
          'Applies the given changes in a transaction and logs one activity entry per changed value (status entries record column names, parent entries card keys). A status change moves the card to the end of the target column. `fields` merges per key (`null` removes a key) and is validated against the project\'s field definitions. `labels` replaces the list; `addLabels`/`removeLabels` are applied after it. A patch that changes nothing writes nothing.',
        requestBody: body(ref('CardPatch'), { status: 'done', addLabels: ['shipped'], fields: { points: 5 } }),
        responses: {
          200: ok('Updated card', ref('Card'), cardExample),
          409: {
            description: 'Stale `descriptionVersion`; nothing was applied',
            content: json(ref('VersionConflict'), {
              error: { code: 'version_conflict', message: 'Description is at version 4; your edit is based on 3', current: cardExample },
            }),
          },
          ...errors(400, 401, 404, 422),
        },
      },
    },
    '/cards/{key}/activity': {
      get: {
        tags: ['cards'],
        summary: 'Activity timeline of a card (oldest first)',
        parameters: [
          param('cardKey'),
          query('kind', { type: 'array', items: { type: 'string', enum: ACTIVITY_KINDS } }, 'Only these kinds; repeatable or comma-separated', {
            style: 'form',
            explode: true,
          }),
          query('since', timestamp, 'Only entries strictly after this time'),
          param('limit'),
          param('cursor'),
        ],
        responses: { 200: ok('Activity', pageOf('Activity')), ...errors(400, 401, 404, 422) },
      },
    },
    '/cards/{key}/comments': {
      parameters: [param('cardKey')],
      get: {
        tags: ['cards'],
        summary: 'Comments of a card (oldest first)',
        parameters: [param('limit'), param('cursor')],
        responses: { 200: ok('Comments', pageOf('Comment')), ...errors(400, 401, 404) },
      },
      post: {
        tags: ['cards'],
        summary: 'Add a comment (logs a `comment` activity entry, to = comment id)',
        requestBody: body(
          { type: 'object', required: ['body'], additionalProperties: false, properties: { body: { type: 'string', description: 'Markdown' } } },
          { body: 'Deployed to **staging**.' },
        ),
        responses: { 201: ok('Created comment', ref('Comment')), ...errors(400, 401, 404, 422) },
      },
    },
    '/cards/{key}/attachments': {
      parameters: [param('cardKey')],
      get: {
        tags: ['cards'],
        summary: 'Attachments of a card, with download URLs valid for 1 hour',
        parameters: [param('limit'), param('cursor')],
        responses: { 200: ok('Attachments', pageOf('AttachmentWithUrl')), ...errors(400, 401, 404) },
      },
      post: {
        tags: ['cards'],
        summary: 'Upload an attachment (≤ 4 MB; logs an `attachment` activity entry, to = file name)',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } },
            },
          },
        },
        responses: { 201: ok('Stored attachment', ref('AttachmentWithUrl')), ...errors(400, 401, 404, 413) },
      },
    },
    '/cards/{key}/attachments/{id}': {
      delete: {
        tags: ['cards'],
        summary: 'Delete an attachment and its file (logs an `attachment` activity entry, from = file name)',
        parameters: [param('cardKey'), { name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Deleted' }, ...errors(401, 404) },
      },
    },
    '/cards/{key}/page': {
      post: {
        tags: ['cards'],
        summary: 'Create and link the card\'s work page',
        description:
          'Creates a page titled `<key> <title>` with the content and icon of `template` (default: the project\'s page template), under the project\'s page parent (or at the root). Sets `card.pageId` and `page.cardId` and logs a `page` activity entry.',
        parameters: [param('cardKey')],
        requestBody: {
          required: false,
          content: json(
            { type: 'object', additionalProperties: false, properties: { template: { type: 'string', description: 'Page id to copy' } } },
            {},
          ),
        },
        responses: {
          201: ok(
            'The new page and the updated card',
            { type: 'object', required: ['page', 'card'], properties: { page: ref('Page'), card: ref('Card') } },
            { page: pageExample, card: cardExample },
          ),
          409: err('Conflict'),
          ...errors(400, 401, 404, 422),
        },
      },
    },

    // ------------------------------------------------------------ pages
    '/pages': {
      get: {
        tags: ['pages'],
        summary: 'List pages (by rank)',
        parameters: [
          query('parent', { type: 'string' }, 'Children of this page id; `root` for top-level pages'),
          query('q', { type: 'string' }, 'Case-insensitive substring of title or content'),
          query('template', { type: 'boolean' }, 'Only templates (`true`) or only non-templates (`false`); both when omitted'),
          query('trashed', { type: 'boolean', default: false }, 'Trashed pages instead of live ones'),
          param('limit'),
          param('cursor'),
        ],
        responses: { 200: ok('Pages', pageOf('Page'), { items: [pageExample], nextCursor: null }), ...errors(400, 401) },
      },
      post: {
        tags: ['pages'],
        summary: 'Create a page (version 1, with an initial version snapshot)',
        description:
          'With `template`, the template\'s content and icon (and title, when `title` is omitted) are copied; explicit `content`/`icon` win. The page is appended after its siblings.',
        requestBody: body(ref('PageCreate'), { title: 'Runbook', parent: 'pgParent0001', content: '# Runbook' }),
        responses: { 201: ok('Created page', ref('Page'), pageExample), ...errors(400, 401, 422) },
      },
    },
    '/pages/{id}': {
      parameters: [param('pageId')],
      get: {
        tags: ['pages'],
        summary: 'Get a page (trashed pages included)',
        responses: { 200: ok('Page', ref('Page'), pageExample), ...errors(401, 404) },
      },
      patch: {
        tags: ['pages'],
        summary: 'Update a page',
        description:
          '`title`/`content` saves require `version` (the version the edit is based on), bump it by one and always write a version snapshot. `parent` moves the page (appended after its new siblings; cycles are 422). `trashed: true` trashes the page and its live descendants; `trashed: false` restores it with the descendants trashed together with it (moving it to the root when its parent is still trashed). `icon: null` clears the icon.',
        requestBody: body(ref('PagePatch'), { content: '## Goal\n\nShip it', version: 2 }),
        responses: {
          200: ok('Updated page', ref('Page'), pageExample),
          409: {
            description: 'Stale `version`; nothing was applied',
            content: json(ref('VersionConflict'), {
              error: { code: 'version_conflict', message: 'Page is at version 3; your edit is based on 2', current: pageExample },
            }),
          },
          ...errors(400, 401, 404, 422),
        },
      },
    },
    '/pages/{id}/versions': {
      get: {
        tags: ['pages'],
        summary: 'Version snapshots of a page (newest first)',
        parameters: [param('pageId'), param('limit'), param('cursor')],
        responses: { 200: ok('Versions', pageOf('PageVersion')), ...errors(400, 401, 404) },
      },
    },
    '/pages/{id}/threads': {
      parameters: [param('pageId')],
      get: {
        tags: ['pages'],
        summary: 'Inline comment threads of a page (oldest first)',
        parameters: [
          query('resolved', { type: 'string', enum: ['false', 'true', 'all'], default: 'false' }, 'Open threads, resolved ones, or all'),
          param('limit'),
          param('cursor'),
        ],
        responses: { 200: ok('Threads', pageOf('Thread')), ...errors(400, 401, 404) },
      },
      post: {
        tags: ['pages'],
        summary: 'Start a thread on a quote with its first message',
        requestBody: body(
          {
            type: 'object',
            required: ['quote', 'body'],
            additionalProperties: false,
            properties: {
              quote: { type: 'string', description: 'The commented text, as it appears in the page' },
              prefix: { type: 'string', description: 'Text before the quote (last 32 chars kept), for re-anchoring' },
              suffix: { type: 'string', description: 'Text after the quote (first 32 chars kept)' },
              body: { type: 'string', description: 'Markdown' },
            },
          },
          { quote: 'rollout plan', prefix: 'See the ', suffix: ' below.', body: 'Who owns this?' },
        ),
        responses: { 201: ok('Created thread', ref('Thread')), ...errors(400, 401, 404, 422) },
      },
    },
    '/pages/{id}/threads/{tid}': {
      patch: {
        tags: ['pages'],
        summary: 'Resolve or reopen a thread',
        parameters: [param('pageId'), param('threadId')],
        requestBody: body(
          { type: 'object', required: ['resolved'], additionalProperties: false, properties: { resolved: { type: 'boolean' } } },
          { resolved: true },
        ),
        responses: { 200: ok('Updated thread', ref('Thread')), ...errors(400, 401, 404) },
      },
    },
    '/pages/{id}/threads/{tid}/messages': {
      post: {
        tags: ['pages'],
        summary: 'Reply to a thread',
        parameters: [param('pageId'), param('threadId')],
        requestBody: body(
          { type: 'object', required: ['body'], additionalProperties: false, properties: { body: { type: 'string', description: 'Markdown' } } },
          { body: 'I do.' },
        ),
        responses: { 201: ok('The thread with the new message', ref('Thread')), ...errors(400, 401, 404, 422) },
      },
    },
  },

  components: {
    securitySchemes: {
      bearerToken: { type: 'http', scheme: 'bearer', bearerFormat: 'fira_<32 base62>', description: 'Personal API token' },
      firebaseIdToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: "The owner's Firebase ID token" },
    },
    parameters: {
      limit: { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
      cursor: { name: 'cursor', in: 'query', required: false, description: 'Opaque `nextCursor` of the previous page', schema: { type: 'string' } },
      cardKey: { name: 'key', in: 'path', required: true, description: 'Card key (case-insensitive)', schema: { type: 'string' }, example: 'NI-12' },
      pageId: { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      threadId: { name: 'tid', in: 'path', required: true, schema: { type: 'string' } },
    },
    responses: {
      BadRequest: { description: 'Malformed request (wrong JSON types, unknown fields, missing required fields, bad cursor)', content: json(ref('Error')) },
      Unauthorized: {
        description: 'Missing, invalid or revoked credentials',
        content: json(ref('Error'), { error: { code: 'unauthorized', message: 'Invalid or revoked API token' } }),
      },
      Forbidden: { description: 'Not the owner', content: json(ref('Error')) },
      NotFound: { description: 'Unknown route or resource', content: json(ref('Error'), { error: { code: 'not_found', message: 'Card NI-99 not found' } }) },
      Conflict: { description: 'Conflict (e.g. the card already has a work page)', content: json(ref('Error')) },
      TooLarge: { description: 'File exceeds 4 MB', content: json(ref('Error'), { error: { code: 'payload_too_large', message: 'File exceeds 4 MB' } }) },
      Unprocessable: {
        description: 'Semantically invalid values (unknown status, invalid field value, bad hierarchy, …). Unknown statuses include `validStatuses`.',
        content: json(ref('Error'), {
          error: {
            code: 'unprocessable',
            message: 'Unknown status "Doing" for project NI. Valid: To Do, In Progress, Done',
            validStatuses: ['To Do', 'In Progress', 'Done'],
          },
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
              },
              message: { type: 'string' },
              validStatuses: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      VersionConflict: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message', 'current'],
            properties: {
              code: { const: 'version_conflict' },
              message: { type: 'string' },
              current: { description: 'The resource as it is now (Card or Page)', oneOf: [ref('Card'), ref('Page')] },
            },
          },
        },
      },
      Actor: {
        type: 'object',
        required: ['type', 'id', 'name'],
        properties: {
          type: { type: 'string', enum: ['user', 'token'] },
          id: { type: 'string', description: 'Firebase uid or token id' },
          name: { type: 'string' },
        },
      },
      ApiToken: {
        type: 'object',
        required: ['id', 'name', 'color', 'prefix', 'createdAt', 'revoked'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          color: { type: 'string', enum: LABEL_COLORS },
          prefix: { type: 'string', description: 'First 8 chars of the secret' },
          createdAt: timestamp,
          lastUsedAt: timestamp,
          revoked: { type: 'boolean' },
        },
      },
      Column: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string' }, name: { type: 'string' } } },
      FieldDef: {
        type: 'object',
        required: ['id', 'key', 'name', 'type'],
        properties: {
          id: { type: 'string' },
          key: { type: 'string', description: 'camelCase key in `Card.fields`' },
          name: { type: 'string' },
          type: { type: 'string', enum: FIELD_TYPES },
          options: { type: 'array', items: { type: 'string' }, description: 'For select / multiselect' },
        },
      },
      Project: {
        type: 'object',
        required: ['id', 'key', 'name', 'columns', 'fields', 'nextNumber', 'rank', 'createdAt'],
        properties: {
          id: { type: 'string' },
          key: { type: 'string', example: 'NI' },
          name: { type: 'string' },
          columns: { type: 'array', items: ref('Column'), description: 'Ordered; the last one is "done"' },
          fields: { type: 'array', items: ref('FieldDef') },
          nextNumber: { type: 'integer' },
          pageTemplateId: { type: 'string' },
          pageParentId: { type: 'string' },
          rank: { type: 'string' },
          createdAt: timestamp,
        },
      },
      Label: {
        type: 'object',
        required: ['id', 'name', 'color'],
        properties: { id: { type: 'string' }, name: { type: 'string' }, color: { type: 'string', enum: LABEL_COLORS } },
      },
      FieldValue: fieldValue,
      Card: {
        type: 'object',
        required: [
          'id', 'projectId', 'key', 'number', 'type', 'title', 'description', 'descriptionVersion', 'status', 'statusId', 'project', 'parent',
          'rank', 'priority', 'labels', 'fields', 'archived', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
        ],
        properties: {
          id: { type: 'string' },
          projectId: { type: 'string' },
          project: { type: 'string', description: 'Project key' },
          key: { type: 'string', example: 'NI-12' },
          number: { type: 'integer' },
          type: { type: 'string', enum: CARD_TYPES },
          parentId: { type: 'string' },
          parent: { type: ['string', 'null'], description: 'Parent card key' },
          title: { type: 'string' },
          description: { type: 'string', description: 'Markdown' },
          descriptionVersion: { type: 'integer', description: 'Starts at 1, +1 per description change' },
          status: { type: 'string', description: 'Column name' },
          statusId: { type: 'string', description: 'Column id' },
          rank: { type: 'string', description: 'Fractional index within the column' },
          priority: { type: 'string', enum: PRIORITIES },
          labels: { type: 'array', items: { type: 'string' }, description: 'Label names' },
          dueDate: date,
          fields: { type: 'object', additionalProperties: ref('FieldValue') },
          pageId: { type: 'string', description: 'Linked work page' },
          archived: { type: 'boolean' },
          createdAt: timestamp,
          updatedAt: timestamp,
          createdBy: ref('Actor'),
          updatedBy: ref('Actor'),
        },
      },
      CardCreate: {
        type: 'object',
        required: ['project', 'title'],
        additionalProperties: false,
        properties: {
          project: { type: 'string', description: 'Project key' },
          title: { type: 'string', minLength: 1, maxLength: 500 },
          description: { type: 'string', description: 'Markdown' },
          status: { type: 'string', description: 'Column name or id (default: first column)' },
          type: { type: 'string', enum: CARD_TYPES, default: 'card' },
          parent: { type: ['string', 'null'], description: 'Parent card key' },
          priority: { type: 'string', enum: PRIORITIES, default: 'none' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Label names; unknown ones are created' },
          dueDate: { ...date, type: ['string', 'null'] },
          fields: { type: 'object', additionalProperties: ref('FieldValue'), description: 'Validated against the project fields' },
        },
      },
      CardPatch: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 500 },
          status: { type: 'string', description: 'Column name (case-insensitive) or id' },
          priority: { type: 'string', enum: PRIORITIES },
          dueDate: { ...date, type: ['string', 'null'], description: 'YYYY-MM-DD, or null to clear' },
          parent: { type: ['string', 'null'], description: 'Parent card key, or null to detach' },
          fields: {
            type: 'object',
            additionalProperties: { oneOf: [ref('FieldValue'), { type: 'null' }] },
            description: 'Merged per key; null removes the value',
          },
          labels: { type: 'array', items: { type: 'string' }, description: 'Replaces the labels' },
          addLabels: { type: 'array', items: { type: 'string' } },
          removeLabels: { type: 'array', items: { type: 'string' } },
          archived: { type: 'boolean' },
          description: { type: 'string', description: 'Markdown; requires descriptionVersion' },
          descriptionVersion: { type: 'integer', description: 'The descriptionVersion your edit is based on' },
        },
      },
      Activity: {
        type: 'object',
        required: ['id', 'at', 'actor', 'kind'],
        properties: {
          id: { type: 'string' },
          at: timestamp,
          actor: ref('Actor'),
          kind: { type: 'string', enum: ACTIVITY_KINDS },
          field: { type: 'string', description: 'Field key for kind `field`' },
          from: activityValue,
          to: activityValue,
        },
        example: { id: 'a1', at: '2026-10-19T08:30:00.000Z', actor: actorExample, kind: 'status', from: 'To Do', to: 'In Progress' },
      },
      Comment: {
        type: 'object',
        required: ['id', 'body', 'author', 'createdAt'],
        properties: { id: { type: 'string' }, body: { type: 'string' }, author: ref('Actor'), createdAt: timestamp, updatedAt: timestamp },
      },
      AttachmentWithUrl: {
        type: 'object',
        required: ['id', 'name', 'size', 'contentType', 'storagePath', 'uploadedBy', 'createdAt', 'url', 'urlExpiresAt'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          size: { type: 'integer' },
          contentType: { type: 'string' },
          storagePath: { type: 'string', description: 'attachments/{cardId}/{attachmentId}/{name}' },
          uploadedBy: ref('Actor'),
          createdAt: timestamp,
          url: { type: 'string', format: 'uri', description: 'Signed download URL' },
          urlExpiresAt: timestamp,
        },
      },
      Page: {
        type: 'object',
        required: ['id', 'title', 'parentId', 'rank', 'content', 'version', 'isTemplate', 'trashed', 'createdAt', 'updatedAt', 'updatedBy'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          icon: { type: 'string', description: 'Emoji' },
          parentId: { type: ['string', 'null'] },
          rank: { type: 'string' },
          content: { type: 'string', description: 'Markdown' },
          version: { type: 'integer', description: 'Starts at 1, +1 per title/content save' },
          isTemplate: { type: 'boolean' },
          cardId: { type: 'string', description: 'Card this is the work page of' },
          trashed: { type: 'boolean' },
          trashedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
          updatedBy: ref('Actor'),
        },
      },
      PageCreate: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', maxLength: 500, description: 'Required unless template is given' },
          parent: { type: ['string', 'null'], description: 'Parent page id (default: root)' },
          content: { type: 'string', description: 'Markdown' },
          template: { type: 'string', description: 'Page id to copy content/icon/title from' },
          isTemplate: { type: 'boolean', default: false },
          icon: { type: 'string', description: 'Emoji' },
        },
      },
      PagePatch: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', maxLength: 500 },
          content: { type: 'string', description: 'Markdown' },
          version: { type: 'integer', description: 'Required with title/content: the version your edit is based on' },
          parent: { type: ['string', 'null'], description: 'Move under this page, or null for the root' },
          icon: { type: ['string', 'null'], description: 'Emoji, or null to clear' },
          trashed: { type: 'boolean' },
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
          content: { type: 'string' },
          savedAt: timestamp,
          actor: ref('Actor'),
        },
      },
      ThreadMessage: {
        type: 'object',
        required: ['id', 'body', 'author', 'createdAt'],
        properties: { id: { type: 'string' }, body: { type: 'string' }, author: ref('Actor'), createdAt: timestamp },
      },
      Thread: {
        type: 'object',
        required: ['id', 'quote', 'prefix', 'suffix', 'resolved', 'messages', 'createdAt'],
        properties: {
          id: { type: 'string' },
          quote: { type: 'string' },
          prefix: { type: 'string', maxLength: 32 },
          suffix: { type: 'string', maxLength: 32 },
          resolved: { type: 'boolean' },
          resolvedAt: timestamp,
          messages: { type: 'array', items: ref('ThreadMessage') },
          createdAt: timestamp,
        },
      },
    },
  },
} as const;
