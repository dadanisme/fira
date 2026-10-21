/**
 * End-to-end test of every REST endpoint against the Firebase emulators.
 *
 *   npm run test:api
 *
 * which runs `firebase emulators:exec --only firestore,storage,auth --project demo-fira`
 * around this script. It refuses to run without FIRESTORE_EMULATOR_HOST, so it can
 * never touch a real project. The API is served by scripts/api-dev-server.ts; invite emails go to a
 * local Resend stub (RESEND_API_URL) that records them and can be told to fail.
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { Timestamp } from 'firebase-admin/firestore';

for (const v of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!process.env[v]) {
    console.error(`${v} is not set: run via \`npm run test:api\` (firebase emulators:exec).`);
    process.exit(1);
  }
}

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-fira';
const OWNER = 'owner@example.com';
const BUCKET = `${PROJECT_ID}.appspot.com`;
// A throwaway service account: the emulators ignore credentials, but signed URLs need a key to sign with.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: PROJECT_ID,
  client_email: `smoke@${PROJECT_ID}.iam.gserviceaccount.com`,
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
});
process.env.VITE_FIREBASE_STORAGE_BUCKET = BUCKET;

// ---------------------------------------------------------------- Resend stub

interface SentEmail {
  path: string | undefined;
  auth: string | undefined;
  body: { from: string; to: string[]; subject: string; html: string; text: string };
}
const sentEmails: SentEmail[] = [];
let resendFails = false;
const resendStub = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  sentEmails.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') });
  res.writeHead(resendFails ? 500 : 200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(resendFails ? { name: 'application_error', message: 'stub failure' } : { id: 'em_smoke' }));
});
await new Promise<void>((resolve) => resendStub.listen(0, '127.0.0.1', resolve));
const stubAddress = resendStub.address();
process.env.RESEND_API_URL = `http://127.0.0.1:${typeof stubAddress === 'object' && stubAddress ? stubAddress.port : 0}`;
const RESEND_KEY = 're_smoke_key';
process.env.RESEND_API_KEY = RESEND_KEY;
process.env.INVITE_FROM = 'Fira <invites@mail.example.com>';
process.env.APP_URL = 'https://fira.test/';

const { startServer } = await import('./api-dev-server.js');
const { firestore, adminAuth, bucket } = await import('../api/_lib/admin.js');
const { cardPatchActivity } = await import('../shared/activity.js');

// ---------------------------------------------------------------- harness

interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

const { server, url: BASE } = await startServer();
let secret = '';

async function call<T = any>(method: string, path: string, opts: { body?: unknown; auth?: string | null; form?: FormData } = {}): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  const auth = opts.auth === undefined ? secret : opts.auth;
  if (auth) headers.Authorization = `Bearer ${auth}`;
  let body: FormData | string | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    // keep text
  }
  return { status: res.status, body: parsed as T, headers: res.headers };
}

function expectStatus(res: Res, status: number, code?: string) {
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  if (code) {
    assert.equal(res.body?.error?.code, code);
    assert.equal(typeof res.body.error.message, 'string');
  }
}

const results: { name: string; ok: boolean; error?: unknown }[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  FAIL  ${name}\n        ${(error as Error).message.split('\n').join('\n        ')}`);
  }
}

const db = firestore();
const wsDoc = (wid: string) => db.collection('workspaces').doc(wid);
/** `/workspaces/{wid}` + rest. */
const W = (wid: string, rest = '') => `/workspaces/${wid}${rest}`;
const enc = encodeURIComponent;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- owner + seed data

const PASSWORD = 'smoke-password';

/** Signs an existing emulator user in (a fresh ID token, with the current profile claims). */
async function signIn(email: string): Promise<string> {
  const host = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
  const res = await fetch(`${host}/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const { idToken } = (await res.json()) as { idToken: string };
  assert.ok(idToken);
  return idToken;
}

interface User {
  idToken: string;
  uid: string;
  email: string;
}

/** Creates an emulator user and signs in, returning its Firebase ID token and uid. */
async function signInAs(email: string, displayName: string, emailVerified = true): Promise<User> {
  const user = await adminAuth().createUser({ email, password: PASSWORD, emailVerified, displayName });
  return { idToken: await signIn(email), uid: user.uid, email: email.toLowerCase() };
}

const { idToken, uid: ownerUid } = await signInAs(OWNER, 'Owner');
console.log(`API at ${BASE}\n`);

// Workspace A ("acme"), created through the API; the content tests run inside it.
const createdA = await call('POST', '/workspaces', { auth: idToken, body: { name: 'Acme', slug: 'acme' } });
assert.equal(createdA.status, 201, JSON.stringify(createdA.body));
const widA: string = createdA.body.id;
const wsA = wsDoc(widA);
const activityOf = async (cardId: string) =>
  (await wsA.collection('cards').doc(cardId).collection('activity').orderBy('at').get()).docs.map((d) => d.data());

const projectRef = wsA.collection('projects').doc('proj-smk');
const columns = [
  { id: 'col-todo', name: 'To Do' },
  { id: 'col-doing', name: 'In Progress' },
  { id: 'col-done', name: 'Done' },
];
await projectRef.set({
  key: 'SMK',
  name: 'Smoke',
  columns,
  fields: [
    { id: 'f1', key: 'notes', name: 'Notes', type: 'text' },
    { id: 'f2', key: 'points', name: 'Points', type: 'number' },
    { id: 'f3', key: 'env', name: 'Env', type: 'select', options: ['prod', 'staging'] },
    { id: 'f4', key: 'tags', name: 'Tags', type: 'multiselect', options: ['a', 'b', 'c'] },
    { id: 'f5', key: 'deadline', name: 'Deadline', type: 'date' },
    { id: 'f6', key: 'blocked', name: 'Blocked', type: 'checkbox' },
    { id: 'f7', key: 'link', name: 'Link', type: 'url' },
  ],
  nextNumber: 1,
  rank: 'a0',
  createdAt: new Date(),
});
await wsA.collection('projects').doc('proj-oth').set({
  key: 'OTH',
  name: 'Other',
  columns: [{ id: 'o1', name: 'Backlog' }],
  fields: [],
  nextNumber: 1,
  rank: 'a1',
  createdAt: new Date(),
});
await wsA.collection('labels').doc('lbl-bug').set({ name: 'Bug', color: 'red' });

// ---------------------------------------------------------------- meta + auth

await test('GET /openapi.json is public and lists every route', async () => {
  const res = await call('GET', '/openapi.json', { auth: null });
  expectStatus(res, 200);
  assert.equal(res.body.openapi, '3.1.0');
  const { routes } = await import('../api/_routes/index.js');
  for (const r of routes) {
    const path = '/' + r.segments.map((s) => (s.startsWith(':') ? `{${s.slice(1)}}` : s)).join('/');
    assert.ok(res.body.paths[path]?.[r.method.toLowerCase()], `openapi missing ${r.method} ${path}`);
  }
  for (const [path, ops] of Object.entries<Record<string, unknown>>(res.body.paths)) {
    for (const method of Object.keys(ops)) {
      if (method === 'parameters') continue;
      const exists = routes.some(
        (r) => r.method.toLowerCase() === method && '/' + r.segments.map((s) => (s.startsWith(':') ? `{${s.slice(1)}}` : s)).join('/') === path,
      );
      assert.ok(exists, `openapi documents a route that does not exist: ${method} ${path}`);
    }
  }
});

await test('unknown route → 404 JSON; wrong method → 405', async () => {
  expectStatus(await call('GET', '/nope', { auth: null }), 404, 'not_found');
  const res = await call('PUT', '/me', { auth: null });
  expectStatus(res, 405, 'method_not_allowed');
  assert.equal(res.headers.get('allow'), 'GET');
});

await test('token routes reject API tokens / no auth; owner ID token works', async () => {
  const T = W(widA, '/tokens');
  expectStatus(await call('GET', T, { auth: null }), 401, 'unauthorized');
  expectStatus(await call('GET', T, { auth: 'garbage' }), 401, 'unauthorized');
  const res = await call('POST', T, { auth: idToken, body: { name: 'smoke' } });
  expectStatus(res, 201);
  assert.match(res.body.secret, /^fira_[0-9A-Za-z]{32}$/);
  assert.equal(res.body.token.name, 'smoke');
  assert.equal(res.body.token.hash, undefined);
  assert.equal(res.body.token.prefix, res.body.secret.slice(0, 8));
  assert.equal(res.body.token.workspaceId, widA);
  assert.deepEqual([res.body.token.userId, res.body.token.userEmail, res.body.token.userName], [ownerUid, OWNER, 'Owner']);
  secret = res.body.secret;
  expectStatus(await call('POST', T, { auth: idToken, body: { name: '' } }), 422, 'unprocessable');
  expectStatus(await call('POST', T, { auth: idToken, body: { name: 'x', color: 'neon' } }), 422, 'unprocessable');
  expectStatus(await call('GET', T, { auth: secret }), 401);
  expectStatus(await call('GET', '/tokens', { auth: idToken }), 404, 'not_found');
});

await test('GET tokens lists; DELETE tokens/{tid} revokes (revoked token → 401)', async () => {
  const made = await call('POST', W(widA, '/tokens'), { auth: idToken, body: { name: 'temp', color: 'blue' } });
  expectStatus(made, 201);
  const list = await call('GET', W(widA, '/tokens'), { auth: idToken });
  expectStatus(list, 200);
  assert.equal(list.body.items.length, 2);
  assert.equal(list.body.nextCursor, null);
  expectStatus(await call('GET', '/me', { auth: made.body.secret }), 200);
  const revoked = await call('DELETE', W(widA, `/tokens/${made.body.token.id}`), { auth: idToken });
  expectStatus(revoked, 200);
  assert.equal(revoked.body.revoked, true);
  expectStatus(await call('GET', '/me', { auth: made.body.secret }), 401, 'unauthorized');
  expectStatus(await call('DELETE', W(widA, '/tokens/nope'), { auth: idToken }), 404);
});

await test('GET /me returns the token actor and its workspace', async () => {
  const res = await call('GET', '/me');
  expectStatus(res, 200);
  assert.equal(res.body.type, 'token');
  assert.equal(res.body.name, 'smoke');
  assert.deepEqual(res.body.via, { id: ownerUid, name: 'Owner' });
  assert.deepEqual(res.body.workspace, { id: widA, name: 'Acme', slug: 'acme' });
  expectStatus(await call('GET', '/me', { auth: null }), 401, 'unauthorized');
});

// ---------------------------------------------------------------- projects + labels

await test('GET /projects, /projects/{key}, /labels', async () => {
  const list = await call('GET', '/projects');
  expectStatus(list, 200);
  assert.deepEqual(
    list.body.items.map((p: any) => p.key),
    ['SMK', 'OTH'],
  );
  assert.equal(list.body.items[0].columns.length, 3);
  assert.equal(list.body.items[0].fields.length, 7);
  assert.match(list.body.items[0].createdAt, /^\d{4}-\d\d-\d\dT/);
  const one = await call('GET', '/projects/smk');
  expectStatus(one, 200);
  assert.equal(one.body.key, 'SMK');
  assert.equal(one.body.id, 'proj-smk');
  expectStatus(await call('GET', '/projects/NOPE'), 404, 'not_found');
  const labels = await call('GET', '/labels');
  expectStatus(labels, 200);
  assert.deepEqual(labels.body.items, [{ id: 'lbl-bug', name: 'Bug', color: 'red' }]);
});

// ---------------------------------------------------------------- cards

const keys: Record<string, string> = {};

await test('POST /cards validates input', async () => {
  expectStatus(await call('POST', '/cards', { body: { title: 'x' } }), 400, 'bad_request');
  expectStatus(await call('POST', '/cards', { body: { project: 'SMK' } }), 400, 'bad_request');
  expectStatus(await call('POST', '/cards', { body: { project: 'NOPE', title: 'x' } }), 404, 'not_found');
  expectStatus(await call('POST', '/cards', { body: { project: 'SMK', title: 'x', bogus: 1 } }), 400, 'bad_request');
  expectStatus(await call('POST', '/cards', { body: '{not json' }), 400, 'bad_request');
  const badStatus = await call('POST', '/cards', { body: { project: 'SMK', title: 'x', status: 'Nope' } });
  expectStatus(badStatus, 422, 'unprocessable');
  assert.deepEqual(badStatus.body.error.validStatuses, ['To Do', 'In Progress', 'Done']);
  expectStatus(await call('POST', '/cards', { body: { project: 'SMK', title: 'x', type: 'subtask' } }), 422);
  expectStatus(await call('POST', '/cards', { body: { project: 'SMK', title: 'x', priority: 'meh' } }), 422);
  expectStatus(await call('POST', '/cards', { body: { project: 'SMK', title: 'x', dueDate: '2026-02-30' } }), 422);
  expectStatus(await call('POST', '/cards', { body: { project: 'SMK', title: 'x', fields: { env: 'dev' } } }), 422);
  expectStatus(await call('POST', '/cards', { body: { project: 'SMK', title: 'x', fields: { nope: 1 } } }), 422);
  expectStatus(await call('POST', '/cards', { body: { project: 'SMK', title: 'x', parent: 'SMK-99' } }), 422);
  const snap = await projectRef.get();
  assert.equal(snap.get('nextNumber'), 1, 'failed creates must not consume numbers');
});

await test('POST /cards creates an epic, cards and a subtask (numbers, defaults, rank, labels, fields)', async () => {
  const epic = await call('POST', '/cards', { body: { project: 'smk', title: '  Epic one  ', type: 'epic' } });
  expectStatus(epic, 201);
  assert.equal(epic.body.key, 'SMK-1');
  assert.equal(epic.body.title, 'Epic one');
  assert.equal(epic.body.status, 'To Do');
  assert.equal(epic.body.statusId, 'col-todo');
  assert.equal(epic.body.project, 'SMK');
  assert.equal(epic.body.parent, null);
  assert.equal(epic.body.descriptionVersion, 1);
  assert.equal(epic.body.priority, 'none');
  assert.deepEqual(epic.body.labels, []);
  assert.deepEqual(epic.body.fields, {});
  assert.equal(epic.body.archived, false);
  assert.deepEqual(epic.body.createdBy, { type: 'token', id: epic.body.createdBy.id, name: 'smoke', via: { id: ownerUid, name: 'Owner' } });
  assert.deepEqual(epic.body.updatedBy, epic.body.createdBy);
  assert.match(epic.body.createdAt, /Z$/);
  keys.epic = epic.body.key;

  const card = await call('POST', '/cards', {
    body: {
      project: 'SMK',
      title: 'Login fails',
      description: 'Steps **here**',
      status: 'in progress',
      parent: 'smk-1',
      priority: 'high',
      labels: ['bug', 'Backend', 'backend'],
      dueDate: '2026-11-01',
      fields: { notes: 'n', points: '3', env: 'PROD', tags: ['b', 'a', 'b'], deadline: '2026-12-01', blocked: 'true', link: 'https://x.dev' },
    },
  });
  expectStatus(card, 201);
  assert.equal(card.body.key, 'SMK-2');
  assert.equal(card.body.status, 'In Progress');
  assert.equal(card.body.parent, 'SMK-1');
  assert.equal(card.body.parentId, epic.body.id);
  assert.deepEqual(card.body.labels, ['Bug', 'Backend']);
  assert.deepEqual(card.body.fields, { notes: 'n', points: 3, env: 'prod', tags: ['b', 'a'], deadline: '2026-12-01', blocked: true, link: 'https://x.dev' });
  assert.equal(card.body.dueDate, '2026-11-01');
  keys.card = card.body.key;

  const backend = (await wsA.collection('labels').where('name', '==', 'Backend').get()).docs;
  assert.equal(backend.length, 1, 'new label doc created once');
  assert.ok(['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'].includes(backend[0].get('color')));

  const second = await call('POST', '/cards', { body: { project: 'SMK', title: 'Second in progress', status: 'col-doing', labels: ['Bug'] } });
  expectStatus(second, 201);
  assert.ok(second.body.rank > card.body.rank, 'appended at end of column');
  keys.second = second.body.key;

  const sub = await call('POST', '/cards', { body: { project: 'SMK', title: 'Sub', type: 'subtask', parent: keys.card } });
  expectStatus(sub, 201);
  assert.equal(sub.body.parent, keys.card);
  keys.sub = sub.body.key;
  expectStatus(await call('POST', '/cards', { body: { project: 'SMK', title: 'x', type: 'subtask', parent: keys.epic } }), 422);
  expectStatus(await call('POST', '/cards', { body: { project: 'SMK', title: 'x', type: 'epic', parent: keys.epic } }), 422);
  expectStatus(await call('POST', '/cards', { body: { project: 'SMK', title: 'x', parent: keys.card } }), 422);

  const other = await call('POST', '/cards', { body: { project: 'OTH', title: 'Other project card' } });
  expectStatus(other, 201);
  assert.equal(other.body.key, 'OTH-1');
  assert.equal(other.body.status, 'Backlog');
  keys.other = other.body.key;

  assert.equal((await projectRef.get()).get('nextNumber'), 5);
  const acts = await activityOf(card.body.id);
  assert.equal(acts.length, 1);
  assert.equal(acts[0].kind, 'created');
  assert.equal(acts[0].actor.name, 'smoke');
});

await test('POST /cards allocates unique numbers under concurrency', async () => {
  const made = await Promise.all([1, 2, 3, 4].map((i) => call('POST', '/cards', { body: { project: 'SMK', title: `Parallel ${i}` } })));
  made.forEach((r) => expectStatus(r, 201));
  const nums = made.map((r) => r.body.number).sort((a, b) => a - b);
  assert.deepEqual(nums, [5, 6, 7, 8]);
  assert.equal(new Set(made.map((r) => r.body.rank)).size, 4, 'distinct ranks');
});

await test('GET /cards/{key} (case-insensitive) and 404', async () => {
  const res = await call('GET', `/cards/${keys.card.toLowerCase()}`);
  expectStatus(res, 200);
  assert.equal(res.body.key, keys.card);
  assert.equal(res.body.parent, keys.epic);
  expectStatus(await call('GET', '/cards/SMK-999'), 404, 'not_found');
  expectStatus(await call('GET', '/cards/garbage'), 404, 'not_found');
});

await test('GET /cards searches with filters, sort and cursor pagination', async () => {
  const all = await call('GET', '/cards?project=SMK');
  expectStatus(all, 200);
  assert.equal(all.body.items.length, 8);
  assert.equal(all.body.nextCursor, null);
  // Default sort = board order: columns, then rank.
  assert.deepEqual(
    all.body.items.map((c: any) => c.status),
    ['To Do', 'To Do', 'To Do', 'To Do', 'To Do', 'To Do', 'In Progress', 'In Progress'],
  );
  const everywhere = await call('GET', '/cards');
  assert.equal(everywhere.body.items.length, 9);

  const statusOr = await call('GET', '/cards?project=SMK&status=In%20Progress&status=done');
  assert.deepEqual(statusOr.body.items.map((c: any) => c.key), [keys.card, keys.second]);
  expectStatus(await call('GET', '/cards?project=SMK&status=Nope'), 422, 'unprocessable');
  const byStatusNoProject = await call('GET', '/cards?status=backlog');
  assert.deepEqual(byStatusNoProject.body.items.map((c: any) => c.key), [keys.other]);

  const labelAnd = await call('GET', '/cards?project=SMK&label=bug&label=nothing&status=In Progress');
  assert.equal(labelAnd.body.items.length, 2);
  const label = await call('GET', '/cards?project=SMK&label=backend');
  assert.deepEqual(label.body.items.map((c: any) => c.key), [keys.card]);

  assert.deepEqual((await call('GET', '/cards?project=SMK&type=epic')).body.items.map((c: any) => c.key), [keys.epic]);
  assert.deepEqual((await call('GET', `/cards?project=SMK&parent=${keys.epic}`)).body.items.map((c: any) => c.key), [keys.card]);
  assert.deepEqual((await call('GET', `/cards?parent=${keys.card}`)).body.items.map((c: any) => c.key), [keys.sub]);
  assert.deepEqual((await call('GET', '/cards?project=SMK&priority=high')).body.items.map((c: any) => c.key), [keys.card]);
  assert.deepEqual((await call('GET', '/cards?project=SMK&q=STEPS')).body.items.map((c: any) => c.key), [keys.card]);
  assert.deepEqual((await call('GET', '/cards?project=SMK&q=login')).body.items.map((c: any) => c.key), [keys.card]);
  assert.deepEqual((await call('GET', '/cards?project=SMK&field.env=prod')).body.items.map((c: any) => c.key), [keys.card]);
  assert.deepEqual((await call('GET', '/cards?project=SMK&field.tags=a&field.points=3')).body.items.map((c: any) => c.key), [keys.card]);
  assert.deepEqual((await call('GET', '/cards?project=SMK&field.blocked=true')).body.items.map((c: any) => c.key), [keys.card]);
  expectStatus(await call('GET', '/cards?project=SMK&field.nope=1'), 422);
  expectStatus(await call('GET', '/cards?project=SMK&type=bogus'), 422);
  expectStatus(await call('GET', '/cards?project=SMK&sort=bogus'), 400);
  expectStatus(await call('GET', '/cards?project=SMK&archived=maybe'), 400);
  expectStatus(await call('GET', '/cards?project=NOPE'), 404);

  const created = await call('GET', '/cards?project=SMK&sort=created');
  assert.deepEqual(created.body.items.map((c: any) => c.number), [1, 2, 3, 4, 5, 6, 7, 8]);
  const newest = await call('GET', '/cards?project=SMK&sort=-created&limit=3');
  assert.deepEqual(newest.body.items.map((c: any) => c.number).slice(0, 1), [8]);
  assert.ok(newest.body.nextCursor);
  const seen: number[] = [];
  let cursor: string | null = null;
  do {
    const page: Res = await call('GET', `/cards?project=SMK&sort=created&limit=3${cursor ? `&cursor=${cursor}` : ''}`);
    expectStatus(page, 200);
    assert.ok(page.body.items.length <= 3);
    seen.push(...page.body.items.map((c: any) => c.number));
    cursor = page.body.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8]);
  expectStatus(await call('GET', '/cards?cursor=zzz'), 400);
  expectStatus(await call('GET', '/cards?limit=500'), 400);
  expectStatus(await call('GET', '/cards?limit=0'), 400);
});

await test('PATCH /cards/{key} writes fields + matching activity (status by name, labels, fields, parent)', async () => {
  const before = (await call('GET', `/cards/${keys.card}`)).body;
  const actsBefore = (await activityOf(before.id)).length;
  const patch = {
    title: 'Login fails on Safari',
    status: 'DONE',
    priority: 'urgent',
    dueDate: null,
    addLabels: ['Frontend', 'bug'],
    removeLabels: ['BACKEND'],
    fields: { points: 5, env: null, tags: 'c', notes: 'n' },
    parent: null,
  };
  const res = await call('PATCH', `/cards/${keys.card}`, { body: patch });
  expectStatus(res, 200);
  const after = res.body;
  assert.equal(after.title, 'Login fails on Safari');
  assert.equal(after.status, 'Done');
  assert.equal(after.statusId, 'col-done');
  assert.equal(after.priority, 'urgent');
  assert.equal(after.dueDate, undefined);
  assert.deepEqual(after.labels, ['Bug', 'Frontend']);
  assert.equal(after.fields.points, 5);
  assert.equal('env' in after.fields, false);
  assert.deepEqual(after.fields.tags, ['c']);
  assert.equal(after.parent, null);
  assert.equal(after.parentId, undefined);
  assert.ok(after.updatedAt > before.updatedAt);
  assert.ok(after.rank, 'rank set for new column');

  const acts = (await activityOf(before.id)).slice(actsBefore);
  const expected = cardPatchActivity(
    { ...before, status: before.statusId },
    {
      title: patch.title,
      status: 'col-done',
      priority: 'urgent',
      dueDate: null,
      labels: ['Bug', 'Frontend'],
      fields: { points: 5, env: null, tags: ['c'], notes: 'n' },
      parentId: null,
    },
    { columns, cardKey: (id) => (id === before.parentId ? keys.epic : undefined) },
  );
  const strip = (a: any) => ({ kind: a.kind, field: a.field, from: a.from, to: a.to });
  assert.deepEqual(
    acts.map(strip).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    expected.map(strip).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
  const status = acts.find((a) => a.kind === 'status')!;
  assert.deepEqual([status.from, status.to], ['In Progress', 'Done']);
  assert.deepEqual(acts.find((a) => a.kind === 'parent')!.from, keys.epic);
  assert.equal(acts.find((a) => a.kind === 'parent')!.to, null);
  assert.ok(acts.every((a) => a.actor.type === 'token'));
  assert.equal(acts.some((a) => a.field === 'notes'), false, 'unchanged field → no entry');

  await call('PATCH', `/cards/${keys.card}`, { body: { parent: keys.epic } });
  assert.equal((await call('GET', `/cards/${keys.card}`)).body.parent, keys.epic);
});

await test('PATCH /cards/{key} labels replace, archived, no-op writes nothing', async () => {
  const card = (await call('GET', `/cards/${keys.second}`)).body;
  const replaced = await call('PATCH', `/cards/${keys.second}`, { body: { labels: ['brand new', 'Bug'] } });
  expectStatus(replaced, 200);
  assert.deepEqual(replaced.body.labels, ['brand new', 'Bug']);
  const count = (await activityOf(card.id)).length;
  const noop = await call('PATCH', `/cards/${keys.second}`, { body: { labels: ['bug', 'Brand New'], title: card.title } });
  expectStatus(noop, 200);
  assert.equal((await activityOf(card.id)).length, count, 'no-op patch logs nothing');
  assert.equal(noop.body.updatedAt, replaced.body.updatedAt);
  const archived = await call('PATCH', `/cards/${keys.second}`, { body: { archived: true } });
  assert.equal(archived.body.archived, true);
  const last = (await activityOf(card.id)).at(-1)!;
  assert.deepEqual([last.kind, last.from, last.to], ['archived', false, true]);
  const visible = await call('GET', '/cards?project=SMK');
  assert.equal(visible.body.items.some((c: any) => c.key === keys.second), false);
  const onlyArchived = await call('GET', '/cards?project=SMK&archived=true');
  assert.deepEqual(onlyArchived.body.items.map((c: any) => c.key), [keys.second]);
  assert.equal((await call('GET', '/cards?project=SMK&archived=all')).body.items.length, 8);
});

await test('PATCH /cards/{key} validation errors', async () => {
  const k = `/cards/${keys.card}`;
  expectStatus(await call('PATCH', k, { body: { status: 'Nope' } }), 422, 'unprocessable');
  expectStatus(await call('PATCH', k, { body: { title: '' } }), 422);
  expectStatus(await call('PATCH', k, { body: { title: 5 } }), 400);
  expectStatus(await call('PATCH', k, { body: { fields: { points: 'many' } } }), 422);
  expectStatus(await call('PATCH', k, { body: { fields: { link: 'ftp://x' } } }), 422);
  expectStatus(await call('PATCH', k, { body: { fields: { tags: ['z'] } } }), 422);
  expectStatus(await call('PATCH', k, { body: { labels: 'Bug' } }), 400);
  expectStatus(await call('PATCH', k, { body: { parent: keys.card } }), 422);
  expectStatus(await call('PATCH', `/cards/${keys.sub}`, { body: { parent: null } }), 422);
  expectStatus(await call('PATCH', k, { body: { status: 'Backlog' } }), 422);
  expectStatus(await call('PATCH', k, { body: { type: 'epic' } }), 400);
  expectStatus(await call('PATCH', '/cards/SMK-404', { body: { title: 'x' } }), 404);
});

await test('PATCH description requires descriptionVersion; stale → 409 version_conflict with current', async () => {
  const k = `/cards/${keys.card}`;
  const before = (await call('GET', k)).body;
  expectStatus(await call('PATCH', k, { body: { description: 'new' } }), 400, 'bad_request');
  const ok = await call('PATCH', k, { body: { description: 'new text', descriptionVersion: before.descriptionVersion } });
  expectStatus(ok, 200);
  assert.equal(ok.body.description, 'new text');
  assert.equal(ok.body.descriptionVersion, before.descriptionVersion + 1);
  const last = (await activityOf(before.id)).at(-1)!;
  assert.deepEqual([last.kind, last.from, last.to], ['description', before.descriptionVersion, before.descriptionVersion + 1]);
  const stale = await call('PATCH', k, { body: { description: 'lost', descriptionVersion: before.descriptionVersion, title: 'ignored' } });
  expectStatus(stale, 409, 'version_conflict');
  assert.equal(stale.body.error.current.description, 'new text');
  assert.equal(stale.body.error.current.descriptionVersion, before.descriptionVersion + 1);
  assert.equal(stale.body.error.current.key, keys.card);
  assert.notEqual((await call('GET', k)).body.title, 'ignored', 'conflicting patch is not applied');
});

// ---------------------------------------------------------------- comments + activity

await test('POST/GET /cards/{key}/comments (+ comment activity)', async () => {
  const k = `/cards/${keys.card}/comments`;
  expectStatus(await call('POST', k, { body: {} }), 400);
  expectStatus(await call('POST', k, { body: { body: '   ' } }), 422);
  const a = await call('POST', k, { body: { body: 'First **comment**' } });
  expectStatus(a, 201);
  assert.equal(a.body.body, 'First **comment**');
  assert.equal(a.body.author.name, 'smoke');
  assert.match(a.body.createdAt, /Z$/);
  await call('POST', k, { body: { body: 'Second' } });
  const list = await call('GET', k);
  expectStatus(list, 200);
  assert.deepEqual(list.body.items.map((c: any) => c.body), ['First **comment**', 'Second']);
  const card = (await call('GET', `/cards/${keys.card}`)).body;
  const entry = (await activityOf(card.id)).find((x) => x.kind === 'comment' && x.to === a.body.id);
  assert.ok(entry, 'comment activity (to = comment id)');
  expectStatus(await call('GET', '/cards/SMK-404/comments'), 404);
});

await test('GET /cards/{key}/activity with kind and since filters', async () => {
  const k = `/cards/${keys.card}/activity`;
  const all = await call('GET', k);
  expectStatus(all, 200);
  assert.equal(all.body.items[0].kind, 'created');
  assert.ok(all.body.items.every((a: any, i: number, arr: any[]) => i === 0 || arr[i - 1].at <= a.at), 'oldest first');
  assert.ok(all.body.items[0].id && all.body.items[0].actor);
  const comments = await call('GET', `${k}?kind=comment`);
  assert.equal(comments.body.items.length, 2);
  const two = await call('GET', `${k}?kind=comment,status`);
  assert.equal(two.body.items.length, 3);
  const repeated = await call('GET', `${k}?kind=comment&kind=status`);
  assert.equal(repeated.body.items.length, 3);
  const lastAt = all.body.items.at(-1).at;
  const since = await call('GET', `${k}?since=${encodeURIComponent(lastAt)}`);
  assert.equal(since.body.items.length, 0);
  const sinceEarlier = await call('GET', `${k}?since=${encodeURIComponent(all.body.items[0].at)}`);
  assert.equal(sinceEarlier.body.items.length, all.body.items.length - 1);
  expectStatus(await call('GET', `${k}?kind=bogus`), 422);
  expectStatus(await call('GET', `${k}?since=yesterday`), 400);
});

// ---------------------------------------------------------------- attachments

await test('attachments: upload (multipart), list with signed URL, download, delete (+ activity)', async () => {
  const k = `/cards/${keys.card}/attachments`;
  const card = (await call('GET', `/cards/${keys.card}`)).body;
  const content = 'hello attachment\n'.repeat(100);
  const form = new FormData();
  form.append('note', 'ignored field');
  form.append('file', new Blob([content], { type: 'text/plain' }), 'notes/v1.txt');
  const up = await call('POST', k, { form });
  expectStatus(up, 201);
  assert.equal(up.body.name, 'v1.txt');
  assert.equal(up.body.size, content.length);
  assert.equal(up.body.contentType, 'text/plain');
  assert.equal(up.body.storagePath, `workspaces/${widA}/cards/${card.id}/${up.body.id}/v1.txt`);
  assert.equal(up.body.uploadedBy.name, 'smoke');
  assert.ok(up.body.url);
  const [exists] = await bucket().file(up.body.storagePath).exists();
  assert.ok(exists, 'stored in the default bucket');
  const [stored] = await bucket().file(up.body.storagePath).download();
  assert.equal(stored.toString(), content);

  const list = await call('GET', k);
  expectStatus(list, 200);
  assert.equal(list.body.items.length, 1);
  const item = list.body.items[0];
  assert.match(item.url, /X-Goog-Signature|Signature=/);
  const ttl = Date.parse(item.urlExpiresAt) - Date.now();
  assert.ok(ttl > 59 * 60 * 1000 && ttl <= 60 * 60 * 1000, 'URL valid for 1 hour');
  const dl = await fetch(item.url);
  assert.equal(dl.status, 200, `download via signed URL: ${dl.status}`);
  assert.equal(await dl.text(), content);

  const acts = await activityOf(card.id);
  assert.deepEqual(
    acts.filter((a) => a.kind === 'attachment').map((a) => a.to),
    ['v1.txt'],
  );

  const big = new FormData();
  big.append('file', new Blob([Buffer.alloc(4 * 1024 * 1024 + 1)]), 'big.bin');
  expectStatus(await call('POST', k, { form: big }), 413, 'payload_too_large');
  const empty = new FormData();
  empty.append('other', 'x');
  expectStatus(await call('POST', k, { form: empty }), 400, 'bad_request');
  expectStatus(await call('POST', k, { body: { file: 'x' } }), 400, 'bad_request');
  assert.equal((await call('GET', k)).body.items.length, 1, 'rejected uploads store nothing');

  expectStatus(await call('DELETE', `${k}/${up.body.id}`), 204);
  expectStatus(await call('DELETE', `${k}/${up.body.id}`), 404);
  assert.equal((await call('GET', k)).body.items.length, 0);
  const [still] = await bucket().file(up.body.storagePath).exists();
  assert.equal(still, false, 'stored file deleted');
  const removed = (await activityOf(card.id)).filter((a) => a.kind === 'attachment').at(-1)!;
  assert.deepEqual([removed.from, removed.to], ['v1.txt', null]);
});

// ---------------------------------------------------------------- pages

const pages: Record<string, any> = {};

await test('POST /pages (plain, child, template, from template) + validation', async () => {
  expectStatus(await call('POST', '/pages', { body: {} }), 400);
  expectStatus(await call('POST', '/pages', { body: { title: 'x', parent: 'nope' } }), 422);
  expectStatus(await call('POST', '/pages', { body: { title: 'x', template: 'nope' } }), 422);
  expectStatus(await call('POST', '/pages', { body: { title: 'x', extra: 1 } }), 400);

  const root = await call('POST', '/pages', { body: { title: 'Engineering', content: '# Eng', icon: '🛠️' } });
  expectStatus(root, 201);
  assert.equal(root.body.version, 1);
  assert.equal(root.body.parentId, null);
  assert.equal(root.body.isTemplate, false);
  assert.equal(root.body.trashed, false);
  assert.equal(root.body.icon, '🛠️');
  assert.equal(root.body.updatedBy.name, 'smoke');
  pages.root = root.body;
  const versions = await wsA.collection('pages').doc(root.body.id).collection('versions').get();
  assert.equal(versions.size, 1, 'initial version snapshot');
  assert.equal(versions.docs[0].get('version'), 1);

  const child = await call('POST', '/pages', { body: { title: 'Child', parent: root.body.id } });
  expectStatus(child, 201);
  assert.equal(child.body.parentId, root.body.id);
  pages.child = child.body;
  const grandchild = await call('POST', '/pages', { body: { title: 'Grandchild', parent: child.body.id } });
  pages.grandchild = grandchild.body;
  const child2 = await call('POST', '/pages', { body: { title: 'Child 2', parent: root.body.id } });
  assert.ok(child2.body.rank > child.body.rank);
  pages.child2 = child2.body;

  const tpl = await call('POST', '/pages', { body: { title: 'Work template', content: '## Goal\n\n## Notes', isTemplate: true, icon: '📋' } });
  expectStatus(tpl, 201);
  assert.equal(tpl.body.isTemplate, true);
  pages.tpl = tpl.body;
  const fromTpl = await call('POST', '/pages', { body: { template: tpl.body.id } });
  expectStatus(fromTpl, 201);
  assert.equal(fromTpl.body.title, 'Work template');
  assert.equal(fromTpl.body.content, '## Goal\n\n## Notes');
  assert.equal(fromTpl.body.icon, '📋');
  assert.equal(fromTpl.body.isTemplate, false);
  pages.fromTpl = fromTpl.body;
});

await test('GET /pages filters (parent, root, template, q, trashed) and GET /pages/{id}', async () => {
  const all = await call('GET', '/pages');
  expectStatus(all, 200);
  assert.equal(all.body.items.length, 6);
  const children = await call('GET', `/pages?parent=${pages.root.id}`);
  assert.deepEqual(children.body.items.map((p: any) => p.title), ['Child', 'Child 2']);
  const roots = await call('GET', '/pages?parent=root');
  assert.equal(roots.body.items.length, 3);
  assert.deepEqual((await call('GET', '/pages?template=true')).body.items.map((p: any) => p.id), [pages.tpl.id]);
  assert.equal((await call('GET', '/pages?template=false')).body.items.length, 5);
  assert.deepEqual((await call('GET', '/pages?q=%23%20eng')).body.items.map((p: any) => p.id), [pages.root.id]);
  assert.equal((await call('GET', '/pages?trashed=true')).body.items.length, 0);
  const one = await call('GET', `/pages/${pages.root.id}`);
  expectStatus(one, 200);
  assert.equal(one.body.content, '# Eng');
  expectStatus(await call('GET', '/pages/nope'), 404, 'not_found');
});

await test('PATCH /pages/{id}: versioned save, 409 on stale version, always snapshots', async () => {
  const k = `/pages/${pages.root.id}`;
  expectStatus(await call('PATCH', k, { body: { content: 'x' } }), 400, 'bad_request');
  const saved = await call('PATCH', k, { body: { content: '# Eng v2', version: 1 } });
  expectStatus(saved, 200);
  assert.equal(saved.body.version, 2);
  assert.equal(saved.body.content, '# Eng v2');
  assert.equal(saved.body.title, 'Engineering');
  const again = await call('PATCH', k, { body: { title: 'Engineering!', version: 2 } });
  assert.equal(again.body.version, 3);
  const stale = await call('PATCH', k, { body: { content: 'lost', version: 2 } });
  expectStatus(stale, 409, 'version_conflict');
  assert.equal(stale.body.error.current.version, 3);
  assert.equal(stale.body.error.current.content, '# Eng v2');

  const versions = await call('GET', `${k}/versions`);
  expectStatus(versions, 200);
  assert.deepEqual(versions.body.items.map((v: any) => v.version), [3, 2, 1], 'newest first, one per API save');
  assert.equal(versions.body.items[0].title, 'Engineering!');
  assert.equal(versions.body.items[0].content, '# Eng v2');
  assert.equal(versions.body.items[0].actor.name, 'smoke');
  expectStatus(await call('GET', '/pages/nope/versions'), 404);
});

await test('PATCH /pages/{id}: icon, move (cycle check), isTemplate — metadata does not bump version', async () => {
  const k = `/pages/${pages.child2.id}`;
  const icon = await call('PATCH', k, { body: { icon: '🚀' } });
  expectStatus(icon, 200);
  assert.equal(icon.body.icon, '🚀');
  assert.equal(icon.body.version, 1);
  const cleared = await call('PATCH', k, { body: { icon: null } });
  assert.equal(cleared.body.icon, undefined);
  const moved = await call('PATCH', k, { body: { parent: pages.child.id } });
  expectStatus(moved, 200);
  assert.equal(moved.body.parentId, pages.child.id);
  assert.ok(moved.body.rank > pages.grandchild.rank, 'appended to new siblings');
  expectStatus(await call('PATCH', `/pages/${pages.root.id}`, { body: { parent: pages.grandchild.id } }), 422);
  expectStatus(await call('PATCH', `/pages/${pages.root.id}`, { body: { parent: pages.root.id } }), 422);
  expectStatus(await call('PATCH', k, { body: { parent: 'nope' } }), 422);
  const tpl = await call('PATCH', k, { body: { isTemplate: true } });
  assert.equal(tpl.body.isTemplate, true);
  assert.equal((await call('PATCH', k, { body: { isTemplate: false } })).body.version, 1);
  const toRoot = await call('PATCH', k, { body: { parent: null } });
  assert.equal(toRoot.body.parentId, null);
  expectStatus(await call('PATCH', k, { body: { trashed: 'yes' } }), 400);
  expectStatus(await call('PATCH', '/pages/nope', { body: { icon: '🙂' } }), 404);
});

await test('PATCH /pages/{id} trashed: trashes the subtree; restore brings it back', async () => {
  const trashed = await call('PATCH', `/pages/${pages.root.id}`, { body: { trashed: true } });
  expectStatus(trashed, 200);
  assert.equal(trashed.body.trashed, true);
  assert.ok(trashed.body.trashedAt);
  const child = (await call('GET', `/pages/${pages.child.id}`)).body;
  const grandchild = (await call('GET', `/pages/${pages.grandchild.id}`)).body;
  assert.equal(child.trashed, true);
  assert.equal(grandchild.trashed, true);
  assert.equal(child.trashedAt, trashed.body.trashedAt);
  assert.equal(grandchild.trashedAt, trashed.body.trashedAt);
  const inTrash = await call('GET', '/pages?trashed=true');
  assert.equal(inTrash.body.items.length, 3);
  assert.equal((await call('GET', '/pages')).body.items.some((p: any) => p.id === pages.child.id), false);
  expectStatus(await call('POST', '/pages', { body: { title: 'x', parent: pages.root.id } }), 422);

  const restored = await call('PATCH', `/pages/${pages.root.id}`, { body: { trashed: false } });
  expectStatus(restored, 200);
  assert.equal(restored.body.trashed, false);
  assert.equal(restored.body.trashedAt, undefined);
  assert.equal((await call('GET', `/pages/${pages.grandchild.id}`)).body.trashed, false);

  // Restoring a page whose parent is still trashed moves it to the root.
  await call('PATCH', `/pages/${pages.child.id}`, { body: { trashed: true } });
  await delay(5);
  await call('PATCH', `/pages/${pages.root.id}`, { body: { trashed: true } });
  const orphan = await call('PATCH', `/pages/${pages.child.id}`, { body: { trashed: false } });
  assert.equal(orphan.body.parentId, null);
  assert.equal((await call('GET', `/pages/${pages.grandchild.id}`)).body.trashed, false);
  await call('PATCH', `/pages/${pages.root.id}`, { body: { trashed: false } });
  await call('PATCH', `/pages/${pages.child.id}`, { body: { parent: pages.root.id } });
});

await test('threads: create, list (resolved filter), reply, resolve/unresolve', async () => {
  const k = `/pages/${pages.root.id}/threads`;
  expectStatus(await call('POST', k, { body: { body: 'x' } }), 400);
  expectStatus(await call('POST', k, { body: { quote: 'Eng' } }), 400);
  expectStatus(await call('POST', '/pages/nope/threads', { body: { quote: 'Eng', body: 'x' } }), 404);
  const t = await call('POST', k, { body: { quote: 'Eng', prefix: 'x'.repeat(40) + '# ', suffix: ' v2' + 'y'.repeat(40), body: 'Is this right?' } });
  expectStatus(t, 201);
  assert.equal(t.body.quote, 'Eng');
  assert.equal(t.body.prefix.length, 32);
  assert.ok(t.body.prefix.endsWith('# '));
  assert.equal(t.body.suffix.length, 32);
  assert.ok(t.body.suffix.startsWith(' v2'));
  assert.equal(t.body.resolved, false);
  assert.equal(t.body.messages.length, 1);
  assert.equal(t.body.messages[0].author.name, 'smoke');
  assert.ok(t.body.messages[0].id && t.body.messages[0].createdAt);

  const reply = await call('POST', `${k}/${t.body.id}/messages`, { body: { body: 'Yes' } });
  expectStatus(reply, 201);
  assert.deepEqual(reply.body.messages.map((m: any) => m.body), ['Is this right?', 'Yes']);
  expectStatus(await call('POST', `${k}/nope/messages`, { body: { body: 'x' } }), 404);
  expectStatus(await call('POST', `${k}/${t.body.id}/messages`, { body: {} }), 400);

  assert.equal((await call('GET', k)).body.items.length, 1);
  const resolved = await call('PATCH', `${k}/${t.body.id}`, { body: { resolved: true } });
  expectStatus(resolved, 200);
  assert.equal(resolved.body.resolved, true);
  assert.ok(resolved.body.resolvedAt);
  assert.equal((await call('GET', k)).body.items.length, 0, 'default resolved=false');
  assert.equal((await call('GET', `${k}?resolved=true`)).body.items.length, 1);
  assert.equal((await call('GET', `${k}?resolved=all`)).body.items.length, 1);
  const reopened = await call('PATCH', `${k}/${t.body.id}`, { body: { resolved: false } });
  assert.equal(reopened.body.resolved, false);
  assert.equal(reopened.body.resolvedAt, undefined);
  expectStatus(await call('PATCH', `${k}/${t.body.id}`, { body: {} }), 400);
  expectStatus(await call('PATCH', `${k}/nope`, { body: { resolved: true } }), 404);
});

// ---------------------------------------------------------------- page attachments

await test('page attachments: upload → permanent token URL, embed in content, re-upload is a new URL, delete', async () => {
  const page = (await call('POST', '/pages', { body: { title: 'Slides', content: '## Visual' } })).body;
  const k = `/pages/${page.id}/attachments`;
  // A 1×1 PNG plus padding, so the bytes compare is meaningful.
  const png = Buffer.concat([
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
    Buffer.alloc(2048, 7),
  ]);
  const upload = (name: string) => {
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), name);
    return call('POST', k, { form });
  };

  const up = await upload('slide-01-v2.png');
  expectStatus(up, 201);
  assert.equal(up.body.name, 'slide-01-v2.png');
  assert.equal(up.body.size, png.length);
  assert.equal(up.body.contentType, 'image/png');
  assert.equal(up.body.storagePath, `workspaces/${widA}/pages/${page.id}/${up.body.id}/slide-01-v2.png`);
  assert.equal(up.body.uploadedBy.name, 'smoke');
  assert.ok(up.body.createdAt);
  const url = new URL(up.body.url);
  assert.equal(url.pathname, `/v0/b/${BUCKET}/o/${encodeURIComponent(up.body.storagePath)}`);
  assert.equal(url.searchParams.get('alt'), 'media');
  assert.match(url.searchParams.get('token') ?? '', /^[0-9a-f-]{36}$/);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['alt', 'token'], 'no expiry/signature params');
  assert.doesNotMatch(up.body.url, /expires/i);

  // The token URL serves the bytes without any auth; without the token, Storage rules apply.
  const dl = await fetch(up.body.url);
  assert.equal(dl.status, 200, `download via token URL: ${dl.status}`);
  assert.ok(Buffer.from(await dl.arrayBuffer()).equals(png), 'same bytes');
  const noToken = new URL(up.body.url);
  noToken.searchParams.delete('token');
  assert.ok([401, 403].includes((await fetch(noToken)).status), 'rules still guard the object without the token');

  const list = await call('GET', k);
  expectStatus(list, 200);
  assert.deepEqual(list.body.items, [up.body]);

  const again = await upload('slide-01-v2.png');
  expectStatus(again, 201);
  assert.notEqual(again.body.id, up.body.id, 're-upload: new id');
  assert.notEqual(again.body.url, up.body.url, 're-upload: new URL');
  assert.equal((await fetch(up.body.url)).status, 200, 'the first URL keeps working');
  assert.deepEqual((await call('GET', k)).body.items.map((a: any) => a.id), [up.body.id, again.body.id]);

  // Embed in the page; the API stores the Markdown byte-for-byte.
  const content = `## Visual\n\n![Slide 1](${up.body.url})\n\n![Slide 1 v2](${again.body.url})`;
  expectStatus(await call('PATCH', `/pages/${page.id}`, { body: { content, version: page.version } }), 200);
  assert.equal((await call('GET', `/pages/${page.id}`)).body.content, content);

  // Names with spaces and parentheses stay safe inside ![alt](url).
  const odd = await upload('slide (1) final.png');
  expectStatus(odd, 201);
  assert.doesNotMatch(odd.body.url, /[()\s]/);
  assert.equal((await fetch(odd.body.url)).status, 200);

  // Errors
  expectStatus(await call('GET', '/pages/nope/attachments'), 404, 'not_found');
  const form = new FormData();
  form.append('file', new Blob([png]), 'x.png');
  expectStatus(await call('POST', '/pages/nope/attachments', { form }), 404, 'not_found');
  const big = new FormData();
  big.append('file', new Blob([Buffer.alloc(4 * 1024 * 1024 + 1)]), 'big.bin');
  expectStatus(await call('POST', k, { form: big }), 413, 'payload_too_large');
  expectStatus(await call('POST', k, { body: { file: 'x' } }), 400, 'bad_request');
  assert.equal((await call('GET', k)).body.items.length, 3, 'rejected uploads store nothing');

  // A trashed page still accepts uploads.
  await call('PATCH', `/pages/${page.id}`, { body: { trashed: true } });
  const trashed = await upload('late.png');
  expectStatus(trashed, 201);
  await call('PATCH', `/pages/${page.id}`, { body: { trashed: false } });

  // Delete: the URL stops working and the attachment leaves the list.
  expectStatus(await call('DELETE', `${k}/${up.body.id}`), 204);
  expectStatus(await call('DELETE', `${k}/${up.body.id}`), 404, 'not_found');
  expectStatus(await call('DELETE', `/pages/nope/attachments/${again.body.id}`), 404, 'not_found');
  assert.ok([403, 404].includes((await fetch(up.body.url)).status), 'deleted URL no longer fetchable');
  const [still] = await bucket().file(up.body.storagePath).exists();
  assert.equal(still, false, 'stored file deleted');
  assert.deepEqual((await call('GET', k)).body.items.map((a: any) => a.id), [again.body.id, odd.body.id, trashed.body.id]);
  assert.equal((await fetch(again.body.url)).status, 200, 'other attachments unaffected');
});

// ---------------------------------------------------------------- work page

await test('POST /cards/{key}/page creates the page from the project template, links both ways, 409 when linked', async () => {
  await projectRef.update({ pageTemplateId: pages.tpl.id, pageParentId: pages.root.id });
  const card = (await call('GET', `/cards/${keys.card}`)).body;
  const res = await call('POST', `/cards/${keys.card}/page`, { body: {} });
  expectStatus(res, 201);
  const page = res.body.page;
  assert.equal(page.title, `${keys.card} ${card.title}`);
  assert.equal(page.content, pages.tpl.content);
  assert.equal(page.icon, pages.tpl.icon);
  assert.equal(page.parentId, pages.root.id);
  assert.equal(page.cardId, card.id);
  assert.equal(page.version, 1);
  assert.equal(page.isTemplate, false);
  assert.equal(res.body.card.pageId, page.id);
  assert.equal((await call('GET', `/cards/${keys.card}`)).body.pageId, page.id);
  const last = (await activityOf(card.id)).at(-1)!;
  assert.deepEqual([last.kind, last.from, last.to], ['page', null, page.id]);
  assert.equal((await wsA.collection('pages').doc(page.id).collection('versions').get()).size, 1);
  expectStatus(await call('POST', `/cards/${keys.card}/page`, { body: {} }), 409, 'conflict');

  // Explicit template, project without parent → root level; an explicit unknown template → 422.
  expectStatus(await call('POST', `/cards/${keys.other}/page`, { body: { template: 'nope' } }), 422);
  const other = await call('POST', `/cards/${keys.other}/page`, { body: { template: pages.fromTpl.id } });
  expectStatus(other, 201);
  assert.equal(other.body.page.parentId, null);
  assert.equal(other.body.page.content, pages.fromTpl.content);
  // No template at all → empty page.
  await projectRef.update({ pageTemplateId: 'deleted-page' });
  const plain = await call('POST', `/cards/${keys.epic}/page`);
  expectStatus(plain, 201);
  assert.equal(plain.body.page.content, '');
  expectStatus(await call('POST', '/cards/SMK-404/page', { body: {} }), 404);
});

// ---------------------------------------------------------------- workspaces

const { hashSecret } = await import('../api/_lib/auth.js');
const ada = await signInAs('Ada@Example.com', 'Ada');
const mia = await signInAs('mia@example.com', 'Mia');
const sam = await signInAs('sam@example.com', 'Sam');
const bea = await signInAs('bea@example.com', 'Bea');
const xan = await signInAs('xan@example.com', 'Xan');
const ids: Record<string, string> = {};

/** Invites `user` to `wid` (by `inviter`) and accepts as them. */
async function join(wid: string, inviter: string, user: User, role: 'admin' | 'member' = 'member') {
  expectStatus(await call('POST', W(wid, '/invites'), { auth: inviter, body: { email: user.email, role } }), 201);
  expectStatus(await call('POST', W(wid, `/invites/${enc(user.email)}/accept`), { auth: user.idToken }), 200);
}

const memberDoc = async (wid: string, uid: string) => (await wsDoc(wid).collection('members').doc(uid).get()).data();
const inviteDoc = (wid: string, email: string) => wsDoc(wid).collection('invites').doc(email).get();

await test('POST /workspaces creates the workspace, its slug and the owner membership', async () => {
  assert.equal(createdA.body.name, 'Acme');
  assert.equal(createdA.body.slug, 'acme');
  assert.equal(createdA.body.ownerUid, ownerUid);
  assert.equal(createdA.body.createdBy, ownerUid);
  assert.match(createdA.body.createdAt, /Z$/);
  assert.equal((await db.collection('slugs').doc('acme').get()).get('workspaceId'), widA);
  const owner = await memberDoc(widA, ownerUid);
  assert.equal(owner?.role, 'owner');
  assert.equal(owner?.email, OWNER);
  assert.equal(owner?.name, 'Owner');
  assert.equal(owner?.uid, ownerUid);
  assert.deepEqual([owner?.workspaceName, owner?.workspaceSlug], ['Acme', 'acme']);
  assert.ok(owner?.joinedAt instanceof Timestamp && owner?.lastSignInAt instanceof Timestamp);
});

await test('POST /workspaces validation: auth, name, slug, reserved, taken', async () => {
  const body = { name: 'Beta', slug: 'beta-x' };
  expectStatus(await call('POST', '/workspaces', { auth: null, body }), 401, 'unauthorized');
  expectStatus(await call('POST', '/workspaces', { auth: secret, body }), 401, 'unauthorized');
  const unverified = await signInAs('unverified@example.com', 'Unverified', false);
  expectStatus(await call('POST', '/workspaces', { auth: unverified.idToken, body }), 403, 'forbidden');
  const as = (b: unknown) => call('POST', '/workspaces', { auth: bea.idToken, body: b });
  expectStatus(await as({ name: 'Beta' }), 400, 'bad_request');
  expectStatus(await as({ ...body, extra: 1 }), 400, 'bad_request');
  expectStatus(await as({ name: '  ', slug: 'beta-x' }), 422, 'unprocessable');
  expectStatus(await as({ name: 'x'.repeat(61), slug: 'beta-x' }), 422, 'unprocessable');
  for (const slug of ['ab', 'a b', '1abc', 'abc-', 'a--bc', 'x'.repeat(33), 'api', 'workspaces', 'settings']) {
    expectStatus(await as({ name: 'Beta', slug }), 422, 'unprocessable');
  }
  expectStatus(await as({ name: 'Beta', slug: 'acme' }), 409, 'slug_taken');
  expectStatus(await as({ name: 'Beta', slug: ' ACME ' }), 409, 'slug_taken');
  assert.equal((await db.collection('workspaces').where('ownerUid', '==', bea.uid).get()).size, 0, 'nothing created');
});

await test('a user owns at most 3 workspaces (422 workspace_limit)', async () => {
  const two = await call('POST', '/workspaces', { auth: idToken, body: { name: 'Acme Two', slug: 'acme-two' } });
  expectStatus(two, 201);
  ids.two = two.body.id;
  const three = await call('POST', '/workspaces', { auth: idToken, body: { name: 'Acme Three', slug: 'acme-three' } });
  expectStatus(three, 201);
  ids.three = three.body.id;
  expectStatus(await call('POST', '/workspaces', { auth: idToken, body: { name: 'Four', slug: 'acme-four' } }), 422, 'workspace_limit');
  assert.equal((await db.collection('slugs').doc('acme-four').get()).exists, false);
});

// ---------------------------------------------------------------- invites

await test('POST invites stores the invite and emails it through Resend', async () => {
  const before = sentEmails.length;
  const res = await call('POST', W(widA, '/invites'), { auth: idToken, body: { email: ' Ada@Example.com ', role: 'admin' } });
  expectStatus(res, 201);
  assert.equal(res.body.emailSent, true);
  assert.equal(res.body.emailError, undefined);
  const invite = res.body.invite;
  assert.equal(invite.id, 'ada@example.com');
  assert.equal(invite.email, 'ada@example.com');
  assert.equal(invite.role, 'admin');
  assert.equal(invite.emailStatus, 'sent');
  assert.deepEqual(invite.invitedBy, { uid: ownerUid, name: 'Owner', email: OWNER });
  assert.deepEqual([invite.workspaceId, invite.workspaceName], [widA, 'Acme']);
  assert.ok(invite.createdAt && invite.lastSentAt);

  assert.equal(sentEmails.length, before + 1);
  const email = sentEmails.at(-1)!;
  assert.equal(email.path, '/emails');
  assert.equal(email.auth, `Bearer ${RESEND_KEY}`);
  assert.equal(email.body.from, 'Fira <invites@mail.example.com>');
  assert.deepEqual(email.body.to, ['ada@example.com']);
  assert.equal(email.body.subject, 'Owner invited you to Acme on fira');
  assert.ok(email.body.html.includes('href="https://fira.test/workspaces"'), email.body.html);
  assert.ok(email.body.text.includes('https://fira.test/workspaces'));
  assert.ok(email.body.text.includes('Sign in with Google as ada@example.com'));
  const stored = (await inviteDoc(widA, 'ada@example.com')).data();
  assert.equal(stored?.emailStatus, 'sent');
  assert.equal('emailError' in (stored ?? {}), false);
});

await test('a failed email keeps the invite with emailStatus failed (provider error, or no key)', async () => {
  resendFails = true;
  const failed = await call('POST', W(widA, '/invites'), { auth: idToken, body: { email: mia.email } });
  resendFails = false;
  expectStatus(failed, 201);
  assert.equal(failed.body.emailSent, false);
  assert.match(failed.body.emailError, /500.*stub failure/);
  assert.equal(failed.body.invite.role, 'member', 'default role');
  assert.equal(failed.body.invite.emailStatus, 'failed');
  assert.equal((await inviteDoc(widA, mia.email)).get('emailStatus'), 'failed');
  assert.match((await inviteDoc(widA, mia.email)).get('emailError'), /stub failure/);

  delete process.env.RESEND_API_KEY;
  const before = sentEmails.length;
  const unconfigured = await call('POST', W(widA, '/invites'), { auth: idToken, body: { email: xan.email } });
  process.env.RESEND_API_KEY = RESEND_KEY;
  expectStatus(unconfigured, 201);
  assert.equal(unconfigured.body.emailSent, false);
  assert.equal(unconfigured.body.emailError, 'Email is not configured');
  assert.equal((await inviteDoc(widA, xan.email)).get('emailStatus'), 'failed');
  assert.equal(sentEmails.length, before, 'nothing sent without a key');
});

await test('invite conflicts and validation', async () => {
  const I = W(widA, '/invites');
  expectStatus(await call('POST', I, { auth: idToken, body: { email: 'ADA@example.com' } }), 409, 'already_invited');
  expectStatus(await call('POST', I, { auth: idToken, body: { email: OWNER } }), 409, 'already_member');
  expectStatus(await call('POST', I, { auth: idToken, body: { email: 'nope' } }), 422, 'unprocessable');
  expectStatus(await call('POST', I, { auth: idToken, body: { email: 'z@example.com', role: 'owner' } }), 422, 'unprocessable');
  expectStatus(await call('POST', I, { auth: idToken, body: {} }), 400, 'bad_request');
  expectStatus(await call('POST', I, { auth: idToken, body: { email: 'z@example.com', extra: 1 } }), 400, 'bad_request');
  expectStatus(await call('POST', I, { auth: sam.idToken, body: { email: 'z@example.com' } }), 404, 'not_found');
  expectStatus(await call('POST', I, { auth: secret, body: { email: 'z@example.com' } }), 401, 'unauthorized');
  expectStatus(await call('POST', W('nope', '/invites'), { auth: idToken, body: { email: 'z@example.com' } }), 404, 'not_found');
});

await test('resend: 429 within a minute; after the cooldown it sends again', async () => {
  const R = W(widA, `/invites/${enc(mia.email)}/resend`);
  expectStatus(await call('POST', R, { auth: idToken }), 429, 'too_many_requests');
  await wsDoc(widA).collection('invites').doc(mia.email).update({ lastSentAt: Timestamp.fromMillis(Date.now() - 61_000) });
  const before = sentEmails.length;
  const res = await call('POST', R, { auth: idToken });
  expectStatus(res, 200);
  assert.equal(res.body.emailSent, true);
  assert.equal(res.body.invite.emailStatus, 'sent');
  assert.equal(res.body.invite.emailError, undefined, 'previous error cleared');
  assert.equal(sentEmails.length, before + 1);
  assert.deepEqual(sentEmails.at(-1)!.body.to, [mia.email]);
  expectStatus(await call('POST', R, { auth: idToken }), 429, 'too_many_requests');
  expectStatus(await call('POST', W(widA, '/invites/nobody%40example.com/resend'), { auth: idToken }), 404, 'not_found');
});

await test('accept: only the invitee; joins with the invite role; the invite is deleted', async () => {
  const A = W(widA, `/invites/${enc('ada@example.com')}/accept`);
  expectStatus(await call('POST', A, { auth: mia.idToken }), 404, 'not_found');
  expectStatus(await call('POST', A, { auth: sam.idToken }), 404, 'not_found');
  expectStatus(await call('POST', A, { auth: null }), 401, 'unauthorized');
  const res = await call('POST', W(widA, `/invites/${enc('ADA@EXAMPLE.COM')}/accept`), { auth: ada.idToken });
  expectStatus(res, 200);
  assert.equal(res.body.workspace.id, widA);
  assert.equal(res.body.workspace.slug, 'acme');
  const m = res.body.member;
  assert.deepEqual([m.id, m.uid, m.email, m.name, m.role], [ada.uid, ada.uid, 'ada@example.com', 'Ada', 'admin']);
  assert.equal(m.invitedBy, ownerUid);
  assert.deepEqual([m.workspaceName, m.workspaceSlug], ['Acme', 'acme']);
  assert.ok(m.joinedAt && m.lastSignInAt);
  assert.equal((await inviteDoc(widA, 'ada@example.com')).exists, false);
  expectStatus(await call('POST', A, { auth: ada.idToken }), 404, 'not_found');

  const joined = await call('POST', W(widA, `/invites/${enc(mia.email)}/accept`), { auth: mia.idToken });
  expectStatus(joined, 200);
  assert.equal(joined.body.member.role, 'member');
});

await test('decline (invitee) and revoke (admins only)', async () => {
  const X = W(widA, `/invites/${enc(xan.email)}`);
  expectStatus(await call('DELETE', X, { auth: xan.idToken }), 204);
  assert.equal((await inviteDoc(widA, xan.email)).exists, false);
  expectStatus(await call('DELETE', X, { auth: xan.idToken }), 404, 'not_found');

  expectStatus(await call('POST', W(widA, '/invites'), { auth: mia.idToken, body: { email: 'yan@example.com' } }), 403, 'forbidden');
  expectStatus(await call('POST', W(widA, '/invites'), { auth: idToken, body: { email: 'yan@example.com' } }), 201);
  const Y = W(widA, `/invites/${enc('yan@example.com')}`);
  expectStatus(await call('DELETE', Y, { auth: mia.idToken }), 403, 'forbidden');
  expectStatus(await call('DELETE', Y, { auth: sam.idToken }), 404, 'not_found');
  expectStatus(await call('DELETE', Y, { auth: ada.idToken }), 204);
  assert.equal((await inviteDoc(widA, 'yan@example.com')).exists, false);
  expectStatus(await call('DELETE', Y, { auth: ada.idToken }), 404, 'not_found');
});

await test('seat limit: 50 seats, pending invites included (422 seat_limit)', async () => {
  const created = await call('POST', '/workspaces', { auth: sam.idToken, body: { name: 'Seats', slug: 'seats' } });
  expectStatus(created, 201);
  ids.seats = created.body.id;
  const batch = db.batch();
  for (let i = 0; i < 48; i++) {
    const email = `seat${i}@example.com`;
    batch.set(wsDoc(ids.seats).collection('invites').doc(email), {
      email,
      role: 'member',
      invitedBy: { uid: sam.uid, name: 'Sam', email: sam.email },
      createdAt: new Date(),
      emailStatus: 'sent',
      workspaceId: ids.seats,
      workspaceName: 'Seats',
    });
  }
  await batch.commit();
  // 1 member + 48 invites = 49 seats: one more fits, then it is full.
  expectStatus(await call('POST', W(ids.seats, '/invites'), { auth: sam.idToken, body: { email: 'seat49@example.com' } }), 201);
  expectStatus(await call('POST', W(ids.seats, '/invites'), { auth: sam.idToken, body: { email: 'seat50@example.com' } }), 422, 'seat_limit');
  expectStatus(await call('DELETE', W(ids.seats, `/invites/${enc('seat0@example.com')}`), { auth: sam.idToken }), 204);
  expectStatus(await call('POST', W(ids.seats, '/invites'), { auth: sam.idToken, body: { email: 'seat50@example.com' } }), 201);
});

// ---------------------------------------------------------------- rename

await test('rename: owner only; slug reservation swapped; members and invites updated', async () => {
  const P = W(widA);
  expectStatus(await call('PATCH', P, { auth: ada.idToken, body: { name: 'Nope' } }), 403, 'forbidden');
  expectStatus(await call('PATCH', P, { auth: mia.idToken, body: { name: 'Nope' } }), 403, 'forbidden');
  expectStatus(await call('PATCH', P, { auth: sam.idToken, body: { name: 'Nope' } }), 404, 'not_found');
  expectStatus(await call('PATCH', P, { auth: idToken, body: { slug: 'Not valid' } }), 422, 'unprocessable');
  expectStatus(await call('PATCH', P, { auth: idToken, body: { name: '' } }), 422, 'unprocessable');
  expectStatus(await call('PATCH', P, { auth: idToken, body: { slug: 'acme-two' } }), 409, 'slug_taken');
  expectStatus(await call('PATCH', P, { auth: idToken, body: { owner: 'x' } }), 400, 'bad_request');
  expectStatus(await call('POST', W(widA, '/invites'), { auth: idToken, body: { email: 'zed@example.com' } }), 201);

  const res = await call('PATCH', P, { auth: idToken, body: { name: 'Acme Corp', slug: 'acme-corp' } });
  expectStatus(res, 200);
  assert.deepEqual([res.body.id, res.body.name, res.body.slug], [widA, 'Acme Corp', 'acme-corp']);
  assert.equal((await db.collection('slugs').doc('acme').get()).exists, false, 'old slug released');
  assert.equal((await db.collection('slugs').doc('acme-corp').get()).get('workspaceId'), widA);
  const members = (await wsDoc(widA).collection('members').get()).docs;
  assert.equal(members.length, 3);
  for (const m of members) assert.deepEqual([m.get('workspaceName'), m.get('workspaceSlug')], ['Acme Corp', 'acme-corp']);
  assert.equal((await inviteDoc(widA, 'zed@example.com')).get('workspaceName'), 'Acme Corp');
  const same = await call('PATCH', P, { auth: idToken, body: { name: 'Acme Corp' } });
  expectStatus(same, 200);
  assert.equal(same.body.slug, 'acme-corp');
  // The released slug is free for others.
  const reuse = await call('POST', '/workspaces', { auth: bea.idToken, body: { name: 'Beta', slug: 'acme' } });
  expectStatus(reuse, 201);
  ids.beta = reuse.body.id;
});

// ---------------------------------------------------------------- roles

await test('roles: admins change non-owners (admins included); nobody changes the owner', async () => {
  const M = (uid: string) => W(widA, `/members/${uid}`);
  const promoted = await call('PATCH', M(mia.uid), { auth: ada.idToken, body: { role: 'admin' } });
  expectStatus(promoted, 200);
  assert.equal(promoted.body.role, 'admin');
  assert.equal(promoted.body.uid, mia.uid);
  const demoted = await call('PATCH', M(mia.uid), { auth: ada.idToken, body: { role: 'member' } });
  expectStatus(demoted, 200);
  assert.equal(demoted.body.role, 'member');
  expectStatus(await call('PATCH', M(ownerUid), { auth: ada.idToken, body: { role: 'member' } }), 403, 'forbidden');
  expectStatus(await call('PATCH', M(ownerUid), { auth: idToken, body: { role: 'admin' } }), 403, 'forbidden');
  expectStatus(await call('PATCH', M(ada.uid), { auth: mia.idToken, body: { role: 'member' } }), 403, 'forbidden');
  expectStatus(await call('PATCH', M(mia.uid), { auth: idToken, body: { role: 'owner' } }), 422, 'unprocessable');
  expectStatus(await call('PATCH', M(mia.uid), { auth: idToken, body: {} }), 400, 'bad_request');
  expectStatus(await call('PATCH', M('nobody'), { auth: idToken, body: { role: 'admin' } }), 404, 'not_found');
  expectStatus(await call('PATCH', M(mia.uid), { auth: sam.idToken, body: { role: 'admin' } }), 404, 'not_found');
  assert.equal((await memberDoc(widA, ownerUid))?.role, 'owner');
});

// ---------------------------------------------------------------- tokens per workspace

const miaTokens: Record<string, { id: string; secret: string }> = {};

await test('tokens are per workspace: members see their own, admins see and revoke all', async () => {
  const T = W(widA, '/tokens');
  for (const name of ['mia bot', 'mia temp']) {
    const res = await call('POST', T, { auth: mia.idToken, body: { name } });
    expectStatus(res, 201);
    assert.equal(res.body.token.workspaceId, widA);
    assert.deepEqual([res.body.token.userId, res.body.token.userEmail, res.body.token.userName], [mia.uid, mia.email, 'Mia']);
    miaTokens[name] = { id: res.body.token.id, secret: res.body.secret };
  }
  const mine = await call('GET', T, { auth: mia.idToken });
  expectStatus(mine, 200);
  assert.deepEqual(mine.body.items.map((t: any) => t.id), [miaTokens['mia temp'].id, miaTokens['mia bot'].id], 'own only, newest first');
  const all = await call('GET', T, { auth: ada.idToken });
  expectStatus(all, 200);
  assert.ok(all.body.items.some((t: any) => t.userId === ownerUid));
  assert.ok(all.body.items.some((t: any) => t.id === miaTokens['mia bot'].id));
  assert.ok(all.body.items.every((t: any) => t.workspaceId === widA && t.hash === undefined));
  const ownerToken = all.body.items.find((t: any) => t.userId === ownerUid);
  expectStatus(await call('DELETE', W(widA, `/tokens/${ownerToken.id}`), { auth: mia.idToken }), 404, 'not_found');
  const revoked = await call('DELETE', W(widA, `/tokens/${miaTokens['mia temp'].id}`), { auth: ada.idToken });
  expectStatus(revoked, 200);
  assert.equal(revoked.body.revoked, true);
  // A token is invisible from another workspace, even to its owner.
  expectStatus(await call('DELETE', W(ids.two, `/tokens/${ownerToken.id}`), { auth: idToken }), 404, 'not_found');
  expectStatus(await call('GET', W(ids.two, '/tokens'), { auth: mia.idToken }), 404, 'not_found');

  const me = await call('GET', '/me', { auth: miaTokens['mia bot'].secret });
  expectStatus(me, 200);
  assert.deepEqual(me.body, {
    type: 'token',
    id: miaTokens['mia bot'].id,
    name: 'mia bot',
    via: { id: mia.uid, name: 'Mia' },
    workspace: { id: widA, name: 'Acme Corp', slug: 'acme-corp' },
  });
  const card = await call('POST', '/cards', { auth: miaTokens['mia bot'].secret, body: { project: 'OTH', title: 'From Mia' } });
  expectStatus(card, 201);
  assert.deepEqual(card.body.createdBy.via, { id: mia.uid, name: 'Mia' });
  assert.deepEqual((await activityOf(card.body.id))[0].actor.via, { id: mia.uid, name: 'Mia' });
});

await test('a token without a workspace or creator is rejected', async () => {
  const legacy = `fira_${'L'.repeat(32)}`;
  await db.collection('tokens').doc('legacy').set({ name: 'old', color: 'gray', hash: hashSecret(legacy), prefix: legacy.slice(0, 8), createdAt: new Date(), revoked: false });
  expectStatus(await call('GET', '/me', { auth: legacy }), 401, 'unauthorized');
  await db.collection('tokens').doc('legacy').update({ workspaceId: widA });
  expectStatus(await call('GET', '/me', { auth: legacy }), 401, 'unauthorized');
});

// ---------------------------------------------------------------- remove + leave

await test('removing a member revokes their tokens there and cuts access', async () => {
  expectStatus(await call('DELETE', W(widA, `/members/${ada.uid}`), { auth: mia.idToken }), 403, 'forbidden');
  expectStatus(await call('DELETE', W(widA, `/members/${ownerUid}`), { auth: ada.idToken }), 403, 'forbidden');
  expectStatus(await call('DELETE', W(widA, '/members/nobody'), { auth: ada.idToken }), 404, 'not_found');
  expectStatus(await call('DELETE', W(widA, `/members/${mia.uid}`), { auth: ada.idToken }), 204);
  assert.equal(await memberDoc(widA, mia.uid), undefined);
  expectStatus(await call('GET', '/me', { auth: miaTokens['mia bot'].secret }), 401, 'unauthorized');
  expectStatus(await call('GET', '/cards?project=OTH', { auth: miaTokens['mia bot'].secret }), 401, 'unauthorized');
  assert.equal((await db.collection('tokens').doc(miaTokens['mia bot'].id).get()).get('revoked'), true, 'marked revoked');
  expectStatus(await call('GET', W(widA, '/tokens'), { auth: mia.idToken }), 404, 'not_found');
  // Other members' tokens keep working; a re-invite does not revive revoked tokens.
  expectStatus(await call('GET', '/me'), 200);
  await join(widA, idToken, mia);
  expectStatus(await call('GET', '/me', { auth: miaTokens['mia bot'].secret }), 401, 'unauthorized');
});

await test('leave: members and admins can leave; the owner must transfer first', async () => {
  const miaToken = await call('POST', W(widA, '/tokens'), { auth: mia.idToken, body: { name: 'leaving' } });
  expectStatus(miaToken, 201);
  expectStatus(await call('DELETE', W(widA, `/members/${mia.uid}`), { auth: mia.idToken }), 204);
  assert.equal(await memberDoc(widA, mia.uid), undefined);
  expectStatus(await call('GET', '/me', { auth: miaToken.body.secret }), 401, 'unauthorized');
  expectStatus(await call('DELETE', W(widA, `/members/${mia.uid}`), { auth: mia.idToken }), 404, 'not_found');
  expectStatus(await call('DELETE', W(widA, `/members/${ownerUid}`), { auth: idToken }), 403, 'forbidden');
  assert.equal((await memberDoc(widA, ownerUid))?.role, 'owner');
});

// ---------------------------------------------------------------- transfer

await test('transfer: the target becomes owner and the old owner an admin; limits and permissions', async () => {
  const X = W(widA, '/transfer');
  expectStatus(await call('POST', X, { auth: ada.idToken, body: { uid: ada.uid } }), 403, 'forbidden');
  expectStatus(await call('POST', X, { auth: idToken, body: { uid: ownerUid } }), 422, 'unprocessable');
  expectStatus(await call('POST', X, { auth: idToken, body: { uid: mia.uid } }), 404, 'not_found');
  expectStatus(await call('POST', X, { auth: idToken, body: {} }), 400, 'bad_request');

  const res = await call('POST', X, { auth: idToken, body: { uid: ada.uid } });
  expectStatus(res, 200);
  assert.equal(res.body.ownerUid, ada.uid);
  assert.equal((await memberDoc(widA, ada.uid))?.role, 'owner');
  assert.equal((await memberDoc(widA, ownerUid))?.role, 'admin');
  // The old owner is now an admin: owner-only actions are refused, admin ones still work.
  expectStatus(await call('PATCH', W(widA), { auth: idToken, body: { name: 'Mine' } }), 403, 'forbidden');
  expectStatus(await call('DELETE', W(widA, `/members/${ada.uid}`), { auth: idToken }), 403, 'forbidden');
  // And back: the owner then owns 3 again.
  expectStatus(await call('POST', X, { auth: ada.idToken, body: { uid: ownerUid } }), 200);
  assert.equal((await memberDoc(widA, ada.uid))?.role, 'admin');
  assert.equal((await wsDoc(widA).get()).get('ownerUid'), ownerUid);

  // Bea's workspace "acme" (the released slug): the owner joins it but already owns 3.
  await join(ids.beta, bea.idToken, { idToken, uid: ownerUid, email: OWNER });
  expectStatus(await call('POST', W(ids.beta, '/transfer'), { auth: bea.idToken, body: { uid: ownerUid } }), 422, 'workspace_limit');
  assert.equal((await wsDoc(ids.beta).get()).get('ownerUid'), bea.uid);
});

// ---------------------------------------------------------------- isolation

await test('workspaces are isolated: same keys, own labels, pages and projects', async () => {
  await wsDoc(ids.beta).collection('projects').doc('proj-b').set({
    key: 'SMK',
    name: 'Smoke B',
    columns: [{ id: 'b1', name: 'Todo' }],
    fields: [],
    nextNumber: 1,
    rank: 'a0',
    createdAt: new Date(),
  });
  const made = await call('POST', W(ids.beta, '/tokens'), { auth: bea.idToken, body: { name: 'bea bot' } });
  expectStatus(made, 201);
  const b = made.body.secret;
  expectStatus(await call('GET', '/labels', { auth: b }), 200);
  assert.deepEqual((await call('GET', '/labels', { auth: b })).body.items, []);
  const card = await call('POST', '/cards', { auth: b, body: { project: 'smk', title: 'B card', labels: ['Bug'] } });
  expectStatus(card, 201);
  assert.equal(card.body.key, 'SMK-1');
  assert.equal(card.body.status, 'Todo');
  const inA = await call('GET', '/cards/SMK-1');
  const inB = await call('GET', '/cards/SMK-1', { auth: b });
  assert.equal(inA.body.title, 'Epic one');
  assert.equal(inB.body.title, 'B card');
  assert.notEqual(inA.body.id, inB.body.id);
  const labelsB = (await call('GET', '/labels', { auth: b })).body.items;
  assert.equal(labelsB.length, 1);
  assert.equal(labelsB[0].name, 'Bug');
  assert.notEqual(labelsB[0].id, 'lbl-bug');
  assert.deepEqual((await call('GET', '/projects', { auth: b })).body.items.map((p: any) => p.id), ['proj-b']);
  assert.equal((await call('GET', '/cards', { auth: b })).body.items.length, 1);
  expectStatus(await call('GET', `/pages/${pages.root.id}`, { auth: b }), 404, 'not_found');
  expectStatus(await call('GET', `/cards/${keys.card}`, { auth: b }), 404, 'not_found');
  expectStatus(await call('PATCH', `/pages/${pages.root.id}`, { auth: b, body: { icon: '🙂' } }), 404, 'not_found');
  assert.equal((await call('GET', '/pages', { auth: b })).body.items.length, 0);
  const me = await call('GET', '/me', { auth: b });
  assert.deepEqual(me.body.workspace, { id: ids.beta, name: 'Beta', slug: 'acme' });
  // API tokens never work on management routes.
  expectStatus(await call('GET', W(ids.beta, '/tokens'), { auth: b }), 401, 'unauthorized');
});

// ---------------------------------------------------------------- account sync

await test('POST /account/sync refreshes name, photo and last sign-in on every membership', async () => {
  expectStatus(await call('POST', '/account/sync', { auth: secret }), 401, 'unauthorized');
  await adminAuth().updateUser(ownerUid, { displayName: 'Owner Two', photoURL: 'https://example.com/owner.png' });
  const fresh = await signIn(OWNER);
  expectStatus(await call('POST', '/account/sync', { auth: fresh }), 204);
  for (const wid of [widA, ids.two, ids.three, ids.beta]) {
    const m = await memberDoc(wid, ownerUid);
    assert.equal(m?.name, 'Owner Two', wid);
    assert.equal(m?.photoURL, 'https://example.com/owner.png');
    assert.ok(m?.lastSignInAt instanceof Timestamp);
  }
  assert.equal((await memberDoc(widA, ada.uid))?.name, 'Ada', "others' memberships untouched");
  await adminAuth().updateUser(ownerUid, { displayName: 'Owner', photoURL: null });
  expectStatus(await call('POST', '/account/sync', { auth: await signIn(OWNER) }), 204);
  const reset = await memberDoc(widA, ownerUid);
  assert.equal(reset?.name, 'Owner');
  assert.equal('photoURL' in (reset ?? {}), false, 'removed photo is cleared');
});

// ---------------------------------------------------------------- delete

await test('DELETE workspace: owner + typed slug; hard-deletes content, files, members, invites, tokens, slug', async () => {
  const wid = ids.three;
  const ws = wsDoc(wid);
  await join(wid, idToken, ada);
  expectStatus(await call('POST', W(wid, '/invites'), { auth: idToken, body: { email: 'pending@example.com' } }), 201);
  await ws.collection('projects').doc('p3').set({ key: 'DEL', name: 'Doomed', columns: [{ id: 'd1', name: 'Todo' }], fields: [], nextNumber: 1, rank: 'a0', createdAt: new Date() });
  const t = await call('POST', W(wid, '/tokens'), { auth: idToken, body: { name: 'doomed' } });
  expectStatus(t, 201);
  const token = t.body.secret;
  const adaToken = (await call('POST', W(wid, '/tokens'), { auth: ada.idToken, body: { name: 'ada doomed' } })).body.secret;
  const card = await call('POST', '/cards', { auth: token, body: { project: 'DEL', title: 'Doomed card' } });
  expectStatus(card, 201);
  expectStatus(await call('POST', `/cards/${card.body.key}/comments`, { auth: token, body: { body: 'bye' } }), 201);
  const form = new FormData();
  form.append('file', new Blob(['doomed']), 'doomed.txt');
  expectStatus(await call('POST', `/cards/${card.body.key}/attachments`, { auth: token, form }), 201);
  const page = await call('POST', '/pages', { auth: token, body: { title: 'Doomed page' } });
  const pform = new FormData();
  pform.append('file', new Blob(['img']), 'doomed.png');
  expectStatus(await call('POST', `/pages/${page.body.id}/attachments`, { auth: token, form: pform }), 201);
  const [filesBefore] = await bucket().getFiles({ prefix: `workspaces/${wid}/` });
  assert.equal(filesBefore.length, 2);

  expectStatus(await call('DELETE', W(wid), { auth: ada.idToken, body: { confirm: 'acme-three' } }), 403, 'forbidden');
  expectStatus(await call('DELETE', W(wid), { auth: idToken, body: { confirm: 'acme' } }), 422, 'unprocessable');
  expectStatus(await call('DELETE', W(wid), { auth: idToken }), 422, 'unprocessable');
  expectStatus(await call('DELETE', W(wid), { auth: sam.idToken, body: { confirm: 'acme-three' } }), 404, 'not_found');
  expectStatus(await call('DELETE', W(wid), { auth: idToken, body: { confirm: 'acme-three' } }), 204);

  assert.equal((await ws.get()).exists, false, 'workspace doc gone');
  assert.deepEqual(await ws.listCollections(), [], 'nothing left under the workspace');
  assert.equal((await db.collection('slugs').doc('acme-three').get()).exists, false, 'slug released');
  assert.equal((await db.collection('tokens').where('workspaceId', '==', wid).get()).size, 0, 'tokens deleted');
  const [filesAfter] = await bucket().getFiles({ prefix: `workspaces/${wid}/` });
  assert.equal(filesAfter.length, 0, 'storage prefix emptied');
  expectStatus(await call('GET', '/me', { auth: token }), 401, 'unauthorized');
  expectStatus(await call('GET', '/me', { auth: adaToken }), 401, 'unauthorized');
  const adaMemberships = (await db.collectionGroup('members').where('uid', '==', ada.uid).get()).docs.map((d) => d.ref.parent.parent!.id);
  assert.deepEqual(adaMemberships, [widA]);
  expectStatus(await call('DELETE', W(wid), { auth: idToken, body: { confirm: 'acme-three' } }), 404, 'not_found');

  // Other workspaces are untouched.
  expectStatus(await call('GET', '/cards/SMK-1'), 200);
  assert.ok((await wsDoc(ids.beta).get()).exists);
  const [filesA] = await bucket().getFiles({ prefix: `workspaces/${widA}/` });
  assert.ok(filesA.length > 0, "A's files remain");
  // The slot is free again: the owner can create a third workspace.
  expectStatus(await call('POST', '/workspaces', { auth: idToken, body: { name: 'Acme Three', slug: 'acme-three' } }), 201);
});

// ---------------------------------------------------------------- done

server.close();
resendStub.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  for (const f of failed) console.error(`\nFAIL ${f.name}\n`, f.error);
  process.exit(1);
}
process.exit(0);
