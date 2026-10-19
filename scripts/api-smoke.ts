/**
 * End-to-end test of every REST endpoint against the Firebase emulators.
 *
 *   npm run test:api
 *
 * which runs `firebase emulators:exec --only firestore,storage,auth --project demo-fira`
 * around this script. It refuses to run without FIRESTORE_EMULATOR_HOST, so it can
 * never touch a real project. The API is served by scripts/api-dev-server.ts.
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

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
process.env.OWNER_EMAIL = OWNER;
process.env.VITE_FIREBASE_STORAGE_BUCKET = BUCKET;

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
const activityOf = async (cardId: string) =>
  (await db.collection('cards').doc(cardId).collection('activity').orderBy('at').get()).docs.map((d) => d.data());
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- owner + seed data

/** Creates an emulator user and signs in, returning its Firebase ID token and uid. */
async function signInAs(email: string, displayName: string): Promise<{ idToken: string; uid: string }> {
  const host = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
  const password = 'smoke-password';
  const user = await adminAuth().createUser({ email, password, emailVerified: true, displayName });
  const res = await fetch(`${host}/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const { idToken } = (await res.json()) as { idToken: string };
  assert.ok(idToken && user.uid);
  return { idToken, uid: user.uid };
}

const projectRef = db.collection('projects').doc('proj-smk');
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
await db.collection('projects').doc('proj-oth').set({
  key: 'OTH',
  name: 'Other',
  columns: [{ id: 'o1', name: 'Backlog' }],
  fields: [],
  nextNumber: 1,
  rank: 'a1',
  createdAt: new Date(),
});
await db.collection('labels').doc('lbl-bug').set({ name: 'Bug', color: 'red' });

const { idToken, uid: ownerUid } = await signInAs(OWNER, 'Owner');
console.log(`API at ${BASE}\n`);

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
  expectStatus(await call('GET', '/tokens', { auth: null }), 401, 'unauthorized');
  expectStatus(await call('GET', '/tokens', { auth: 'garbage' }), 401, 'unauthorized');
  const res = await call('POST', '/tokens', { auth: idToken, body: { name: 'smoke' } });
  expectStatus(res, 201);
  assert.match(res.body.secret, /^fira_[0-9A-Za-z]{32}$/);
  assert.equal(res.body.token.name, 'smoke');
  assert.equal(res.body.token.hash, undefined);
  assert.equal(res.body.token.prefix, res.body.secret.slice(0, 8));
  secret = res.body.secret;
  expectStatus(await call('POST', '/tokens', { auth: idToken, body: { name: '' } }), 422, 'unprocessable');
  expectStatus(await call('POST', '/tokens', { auth: idToken, body: { name: 'x', color: 'neon' } }), 422, 'unprocessable');
  expectStatus(await call('GET', '/tokens', { auth: secret }), 401);
});

await test('GET /tokens lists; DELETE /tokens/{id} revokes (revoked token → 401)', async () => {
  const made = await call('POST', '/tokens', { auth: idToken, body: { name: 'temp', color: 'blue' } });
  expectStatus(made, 201);
  const list = await call('GET', '/tokens', { auth: idToken });
  expectStatus(list, 200);
  assert.equal(list.body.items.length, 2);
  assert.equal(list.body.nextCursor, null);
  expectStatus(await call('GET', '/me', { auth: made.body.secret }), 200);
  const revoked = await call('DELETE', `/tokens/${made.body.token.id}`, { auth: idToken });
  expectStatus(revoked, 200);
  assert.equal(revoked.body.revoked, true);
  expectStatus(await call('GET', '/me', { auth: made.body.secret }), 401, 'unauthorized');
  expectStatus(await call('DELETE', '/tokens/nope', { auth: idToken }), 404);
});

await test('GET /me returns the token actor', async () => {
  const res = await call('GET', '/me');
  expectStatus(res, 200);
  assert.equal(res.body.type, 'token');
  assert.equal(res.body.name, 'smoke');
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

  const backend = (await db.collection('labels').where('name', '==', 'Backend').get()).docs;
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
  assert.equal(up.body.storagePath, `attachments/${card.id}/${up.body.id}/v1.txt`);
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
  const versions = await db.collection('pages').doc(root.body.id).collection('versions').get();
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
  assert.equal(up.body.storagePath, `pages/${page.id}/${up.body.id}/slide-01-v2.png`);
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
  assert.equal((await db.collection('pages').doc(page.id).collection('versions').get()).size, 1);
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

// ---------------------------------------------------------------- members + per-member tokens

const { hashSecret } = await import('../api/_lib/auth.js');
const MEMBER = 'alice@example.com';
const alice = await signInAs('Alice@Example.com', 'Alice');
const stranger = await signInAs('mallory@example.com', 'Mallory');
const memberTokens: { secret: string; id: string } = { secret: '', id: '' };

await test('non-member Firebase user → 403 on token management', async () => {
  expectStatus(await call('GET', '/tokens', { auth: stranger.idToken }), 403, 'forbidden');
  expectStatus(await call('POST', '/tokens', { auth: stranger.idToken, body: { name: 'nope' } }), 403, 'forbidden');
  expectStatus(await call('GET', '/tokens', { auth: alice.idToken }), 403, 'forbidden');
});

await test('member creates a token; its writes carry `via` the member', async () => {
  await db.collection('members').doc(MEMBER).set({ email: MEMBER, role: 'member', addedAt: new Date(), addedBy: OWNER });
  const res = await call('POST', '/tokens', { auth: alice.idToken, body: { name: 'CI bot' } });
  expectStatus(res, 201);
  assert.equal(res.body.token.userEmail, MEMBER);
  assert.equal(res.body.token.userId, alice.uid);
  assert.equal(res.body.token.userName, 'Alice');
  memberTokens.secret = res.body.secret;
  memberTokens.id = res.body.token.id;
  const me = await call('GET', '/me', { auth: memberTokens.secret });
  expectStatus(me, 200);
  assert.deepEqual(me.body, { type: 'token', id: memberTokens.id, name: 'CI bot', via: { id: alice.uid, name: 'Alice' } });
  const card = await call('POST', '/cards', { auth: memberTokens.secret, body: { project: 'OTH', title: 'From CI' } });
  expectStatus(card, 201);
  assert.deepEqual(card.body.createdBy.via, { id: alice.uid, name: 'Alice' });
  const acts = await activityOf(card.body.id);
  assert.deepEqual(acts[0].actor.via, { id: alice.uid, name: 'Alice' });
});

await test("member lists only their own tokens; owner lists everyone's; members can't revoke others'", async () => {
  const mine = await call('GET', '/tokens', { auth: alice.idToken });
  expectStatus(mine, 200);
  assert.deepEqual(
    mine.body.items.map((t: { id: string }) => t.id),
    [memberTokens.id],
  );
  const all = await call('GET', '/tokens', { auth: idToken });
  expectStatus(all, 200);
  assert.ok(all.body.items.length >= 3);
  assert.ok(all.body.items.some((t: { id: string; userEmail?: string }) => t.id === memberTokens.id && t.userEmail === MEMBER));
  const times = all.body.items.map((t: { createdAt: string }) => t.createdAt);
  assert.deepEqual(times, [...times].sort().reverse(), 'newest first');
  const ownerToken = all.body.items.find((t: { userEmail?: string }) => t.userEmail === OWNER);
  expectStatus(await call('DELETE', `/tokens/${ownerToken.id}`, { auth: alice.idToken }), 404, 'not_found');
});

await test('legacy token without a creator works (no `via`)', async () => {
  const legacy = `fira_${'L'.repeat(32)}`;
  await db.collection('tokens').doc('legacy').set({ name: 'old', color: 'gray', hash: hashSecret(legacy), prefix: legacy.slice(0, 8), createdAt: new Date(), revoked: false });
  const me = await call('GET', '/me', { auth: legacy });
  expectStatus(me, 200);
  assert.deepEqual(me.body, { type: 'token', id: 'legacy', name: 'old' });
});

await test("removing a member makes their token 401 and their ID token 403", async () => {
  await db.collection('members').doc(MEMBER).delete();
  expectStatus(await call('GET', '/me', { auth: memberTokens.secret }), 401, 'unauthorized');
  expectStatus(await call('GET', '/cards?project=OTH', { auth: memberTokens.secret }), 401, 'unauthorized');
  expectStatus(await call('GET', '/tokens', { auth: alice.idToken }), 403, 'forbidden');
  // The owner's own tokens are unaffected; re-inviting restores the member's token.
  expectStatus(await call('GET', '/me'), 200);
  await db.collection('members').doc(MEMBER).set({ email: MEMBER, role: 'member', addedAt: new Date(), addedBy: OWNER });
  expectStatus(await call('GET', '/me', { auth: memberTokens.secret }), 200);
});

// ---------------------------------------------------------------- done

server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  for (const f of failed) console.error(`\nFAIL ${f.name}\n`, f.error);
  process.exit(1);
}
process.exit(0);
