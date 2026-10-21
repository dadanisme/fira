/**
 * Emulator test of the one-time workspace migration (scripts/migrate-workspaces.ts).
 *
 *   npm run test:migrate
 *
 * which runs `firebase emulators:exec --only firestore,storage,auth --project demo-fira` around
 * this script. Seeds the old single-space layout, then: copy → verify passes → copy again makes
 * no changes → source changes converge, extras are kept unless --prune → copy refuses (writing
 * nothing) when the workspace changed after the last copy or was renamed → rewritten URLs answer
 * 200 → verify --lock → copy refuses (also with --prune / --dry-run) → post-lock edits still
 * verify → cleanup refuses without confirmation → cleanup deletes the old data and keeps the new.
 * Refuses to run without the emulator env vars.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Timestamp } from 'firebase-admin/firestore';
import { cleanup, connect, copy, copyChanges, verify, type CopyResult } from './migrate-workspaces.js';

const ENV = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'];
for (const v of ENV) {
  if (!process.env[v]) {
    console.error(`${v} is not set: run via \`npm run test:migrate\` (firebase emulators:exec).`);
    process.exit(1);
  }
}

const OWNER = 'owner@example.com';
process.env.OWNER_EMAIL = OWNER;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = join(ROOT, 'node_modules/.bin/tsx');
const SCRIPT = join(ROOT, 'scripts/migrate-workspaces.ts');

const t = connect();
const { db, bucket } = t;
const quiet = () => {};
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST!;
const origin = /^https?:\/\//.test(storageHost) ? storageHost : `http://${storageHost}`;

const fullEncode = (p: string) => encodeURIComponent(p).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
/** As the API built it (parentheses encoded). */
const apiUrl = (path: string, token: string) => `${origin}/v0/b/${bucket.name}/o/${fullEncode(path)}?alt=media&token=${token}`;
/** As the client SDK's getDownloadURL built it (parentheses left as is). */
const sdkUrl = (path: string, token: string) => `${origin}/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

// ---------------------------------------------------------------- harness

const results: { name: string; ok: boolean; error?: unknown }[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  FAIL ${name}\n       ${error instanceof Error ? error.message.split('\n').join('\n       ') : String(error)}`);
  }
}

function cli(args: string[], opts: { input?: string; env?: Record<string, string | undefined> } = {}) {
  const env = { ...process.env, ...opts.env };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  const r = spawnSync(TSX, [SCRIPT, ...args], { cwd: ROOT, env, input: opts.input ?? '', encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// ---------------------------------------------------------------- seed (old layout)

const at = (iso: string) => Timestamp.fromDate(new Date(iso));
const ownerActor = { type: 'user', id: 'u-owner', name: 'Owner' };

const IMG = 'pages/pg1/pa1/image (1).png';
const LEGACY_IMG = 'pages/pg2/f1-old.png';
const CARD_FILE = 'attachments/c1/att1/report (final).pdf';
const TOK1 = 'tok-11111111';
const TOK2 = 'tok-22222222';

async function seed() {
  await bucket.file(IMG).save(Buffer.from('png-bytes-1'), { contentType: 'image/png', resumable: false, metadata: { metadata: { firebaseStorageDownloadTokens: TOK1 } } });
  await bucket.file(LEGACY_IMG).save(Buffer.from('png-bytes-2'), { contentType: 'image/png', resumable: false, metadata: { metadata: { firebaseStorageDownloadTokens: TOK2 } } });
  await bucket.file(CARD_FILE).save(Buffer.from('%PDF-1.4'), { contentType: 'application/pdf', resumable: false });

  const b = db.batch();
  b.set(db.doc(`members/${OWNER}`), { email: OWNER, role: 'owner', addedAt: at('2026-01-01T00:00:00Z'), addedBy: OWNER, uid: 'u-owner', name: 'Owner', photoURL: 'https://example.com/o.png', lastSignInAt: at('2026-10-01T00:00:00Z') });
  b.set(db.doc('members/alice@example.com'), { email: 'alice@example.com', role: 'member', addedAt: at('2026-02-01T00:00:00Z'), addedBy: OWNER, uid: 'u-alice', name: 'Alice', lastSignInAt: at('2026-10-02T00:00:00Z') });
  b.set(db.doc('members/bob@example.com'), { email: 'bob@example.com', role: 'member', addedAt: at('2026-03-01T00:00:00Z'), addedBy: OWNER });

  b.set(db.doc('projects/p1'), { key: 'NI', name: 'Nine', columns: [{ id: 'todo', name: 'To Do' }], fields: [], nextNumber: 2, rank: 'a0', createdAt: at('2026-01-02T00:00:00Z') });
  b.set(db.doc('labels/l1'), { name: 'bug', color: 'red' });
  b.set(db.doc('cards/c1'), {
    projectId: 'p1',
    key: 'NI-1',
    title: 'First',
    description: [
      `See [the doc](/d/pg1) and [card](/p/NI/NI-1), plus the [trash](/trash).`,
      `Absolute: https://fira-six.vercel.app/p/NI/NI-1 and <https://fira-six.vercel.app/d/pg2>.`,
      `![shot](${sdkUrl(IMG, TOK1)})`,
      `Not a link: the path /p/NI stays, and /docs/p/ too.`,
    ].join('\n'),
    createdAt: at('2026-01-03T00:00:00Z'),
    createdBy: ownerActor,
    updatedBy: ownerActor,
    labels: ['bug'],
    fields: { size: 3 },
  });
  b.set(db.doc('cards/c1/comments/m1'), { body: 'Done, see [NI-1](/p/NI/NI-1)', author: ownerActor, createdAt: at('2026-01-04T00:00:00Z') });
  b.set(db.doc('cards/c1/activity/a1'), { kind: 'created', actor: ownerActor, at: at('2026-01-03T00:00:00Z') });
  b.set(db.doc('cards/c1/attachments/att1'), { name: 'report (final).pdf', size: 8, contentType: 'application/pdf', storagePath: CARD_FILE, uploadedBy: ownerActor, createdAt: at('2026-01-05T00:00:00Z') });
  // A comment under a card document that no longer exists (phantom parent).
  b.set(db.doc('cards/ghost/comments/m2'), { body: 'orphan', author: ownerActor, createdAt: at('2026-01-06T00:00:00Z') });

  b.set(db.doc('pages/pg1'), {
    title: 'Doc',
    parentId: null,
    rank: 'a0',
    content: `# Doc\n\n![img](${sdkUrl(IMG, TOK1)})\n\n![same, API encoding](${apiUrl(IMG, TOK1)})\n\n[Other](/d/pg2) and [ref]\n\n[ref]: /p/NI\n`,
    version: 3,
    isTemplate: false,
    trashed: false,
    createdAt: at('2026-01-07T00:00:00Z'),
    updatedAt: at('2026-01-08T00:00:00Z'),
    updatedBy: ownerActor,
  });
  b.set(db.doc('pages/pg1/versions/v1'), { version: 2, title: 'Doc', content: `![img](${apiUrl(IMG, TOK1)})`, savedAt: at('2026-01-07T00:00:00Z'), actor: ownerActor });
  b.set(db.doc('pages/pg1/threads/t1'), { quote: 'Doc', prefix: '', suffix: '', resolved: false, createdAt: at('2026-01-08T00:00:00Z'), messages: [{ id: 'x', body: 'Look at [this](/d/pg2)', author: ownerActor, createdAt: at('2026-01-08T00:00:00Z') }] });
  b.set(db.doc('pages/pg1/attachments/pa1'), { name: 'image (1).png', size: 11, contentType: 'image/png', storagePath: IMG, url: apiUrl(IMG, TOK1), uploadedBy: ownerActor, createdAt: at('2026-01-07T00:00:00Z') });
  b.set(db.doc('pages/pg1/presence/u-owner'), { name: 'Owner', at: at('2026-10-01T00:00:00Z') });
  b.set(db.doc('pages/pg2'), {
    title: 'Legacy',
    parentId: 'pg1',
    rank: 'a1',
    content: `![old](${sdkUrl(LEGACY_IMG, TOK2)})`,
    version: 1,
    isTemplate: false,
    trashed: false,
    createdAt: at('2026-01-09T00:00:00Z'),
    updatedAt: at('2026-01-09T00:00:00Z'),
    updatedBy: ownerActor,
  });

  b.set(db.doc('tokens/t-legacy'), { name: 'legacy', color: 'gray', hash: 'h1', prefix: 'fira_aaa', createdAt: at('2026-01-10T00:00:00Z'), revoked: false });
  b.set(db.doc('tokens/t-alice'), { name: 'alice bot', color: 'blue', hash: 'h2', prefix: 'fira_bbb', createdAt: at('2026-02-10T00:00:00Z'), revoked: false, userEmail: 'alice@example.com', userId: 'u-alice', userName: 'Alice' });
  b.set(db.doc('tokens/t-gone'), { name: 'former', color: 'pink', hash: 'h3', prefix: 'fira_ccc', createdAt: at('2026-02-11T00:00:00Z'), revoked: false, userEmail: 'gone@example.com', userId: 'u-gone', userName: 'Gone' });
  await b.commit();
}

// ---------------------------------------------------------------- run

console.log('migrate-check: seeding the old layout');
await seed();
let wid = '';
let first: CopyResult | undefined;
const W = (path: string) => db.doc(`workspaces/${wid}/${path}`);

await test('CLI refuses without --project off the emulators, with partial emulator env, or a mismatched project', async () => {
  const off = cli(['verify'], { env: Object.fromEntries(ENV.map((v) => [v, undefined])) });
  assert.notEqual(off.code, 0);
  assert.match(off.out, /--project/);
  const partial = cli(['verify'], { env: { FIREBASE_AUTH_EMULATOR_HOST: undefined } });
  assert.notEqual(partial.code, 0);
  assert.match(partial.out, /all of .* or none/);
  const wrong = cli(['verify', '--project', 'fira-dadanisme']);
  assert.notEqual(wrong.code, 0);
  assert.match(wrong.out, /does not match the emulator project/);
  const prune = cli(['verify', '--prune']);
  assert.notEqual(prune.code, 0);
  assert.match(prune.out, /--prune applies to copy only/);
});

await test('copy refuses a slug owned by a non-migrated workspace', async () => {
  await db.doc('workspaces/real').set({ name: 'Real', slug: 'ramdan', ownerUid: 'someone' });
  await db.doc('slugs/ramdan').set({ workspaceId: 'real' });
  await assert.rejects(copy({ target: t, log: quiet }), /not created by this migration/);
  await db.doc('slugs/ramdan').delete();
  await db.doc('workspaces/real').delete();
});

await test('dry run on a fresh project writes nothing', async () => {
  const r = await copy({ target: t, dryRun: true, log: quiet });
  assert.ok(copyChanges(r) > 0);
  assert.equal((await db.doc('slugs/ramdan').get()).exists, false);
  assert.equal((await db.collection('workspaces').get()).size, 0);
});

await test('copy creates the workspace, members, invites, content, files and token mapping', async () => {
  first = await copy({ target: t });
  wid = first.workspaceId;
  assert.ok(first.createdWorkspace);
  const ws = (await db.doc(`workspaces/${wid}`).get()).data()!;
  assert.equal(ws.name, 'Ramdan');
  assert.equal(ws.slug, 'ramdan');
  assert.equal(ws.ownerUid, 'u-owner');
  assert.ok(ws.createdAt.isEqual(at('2026-01-01T00:00:00Z')));
  assert.equal((await db.doc('slugs/ramdan').get()).get('workspaceId'), wid);
  assert.ok(ws.migration.copiedAt instanceof Timestamp, 'copiedAt is recorded when the copy finishes');

  const owner = (await W('members/u-owner').get()).data()!;
  assert.equal(owner.role, 'owner');
  assert.equal(owner.invitedBy, undefined);
  assert.equal(owner.workspaceSlug, 'ramdan');
  assert.equal(owner.photoURL, 'https://example.com/o.png');
  const alice = (await W('members/u-alice').get()).data()!;
  assert.deepEqual([alice.role, alice.email, alice.invitedBy, alice.workspaceName], ['member', 'alice@example.com', 'u-owner', 'Ramdan']);
  assert.ok(alice.joinedAt.isEqual(at('2026-02-01T00:00:00Z')));
  const bob = (await W('invites/bob@example.com').get()).data()!;
  assert.deepEqual([bob.role, bob.emailStatus, bob.emailError, bob.workspaceId, bob.lastSentAt], ['member', 'failed', 'Not emailed (migrated)', wid, undefined]);
  assert.deepEqual(bob.invitedBy, { uid: 'u-owner', name: 'Owner', email: OWNER });
  assert.equal((await db.collection(`workspaces/${wid}/members`).get()).size, 2);

  const card = (await W('cards/c1').get()).data()!;
  const newImg = `workspaces/${wid}/pages/pg1/pa1/image (1).png`;
  assert.ok(card.description.includes('[the doc](/w/ramdan/d/pg1)'));
  assert.ok(card.description.includes('[card](/w/ramdan/p/NI/NI-1)'));
  assert.ok(card.description.includes('[trash](/w/ramdan/trash)'));
  assert.ok(card.description.includes('https://fira-six.vercel.app/w/ramdan/p/NI/NI-1 '));
  assert.ok(card.description.includes('<https://fira-six.vercel.app/w/ramdan/d/pg2>'));
  assert.ok(card.description.includes(`![shot](${apiUrl(newImg, TOK1)})`), card.description);
  assert.ok(card.description.includes('the path /p/NI stays, and /docs/p/ too'));
  assert.ok(card.createdAt.isEqual(at('2026-01-03T00:00:00Z')));
  assert.deepEqual(card.fields, { size: 3 });
  assert.equal((await W('cards/c1/comments/m1').get()).get('body'), 'Done, see [NI-1](/w/ramdan/p/NI/NI-1)');
  assert.equal((await W('cards/c1/attachments/att1').get()).get('storagePath'), `workspaces/${wid}/cards/c1/att1/report (final).pdf`);
  assert.equal((await W('cards/ghost/comments/m2').get()).get('body'), 'orphan');
  assert.equal((await W('cards/c1/activity/a1').get()).get('kind'), 'created');

  const page = (await W('pages/pg1').get()).data()!;
  assert.equal(page.content.split(apiUrl(newImg, TOK1)).length, 3, page.content);
  assert.ok(page.content.includes('[Other](/w/ramdan/d/pg2)'));
  assert.ok(page.content.includes('[ref]: /w/ramdan/p/NI'));
  assert.equal(page.version, 3);
  assert.ok((await W('pages/pg1/versions/v1').get()).get('content').includes(apiUrl(newImg, TOK1)));
  assert.equal((await W('pages/pg1/threads/t1').get()).get('messages')[0].body, 'Look at [this](/w/ramdan/d/pg2)');
  const pa = (await W('pages/pg1/attachments/pa1').get()).data()!;
  assert.equal(pa.storagePath, newImg);
  assert.equal(pa.url, apiUrl(newImg, TOK1));
  assert.equal((await W('pages/pg1/presence/u-owner').get()).exists, false);
  assert.ok((await W('pages/pg2').get()).get('content').includes(apiUrl(`workspaces/${wid}/pages/pg2/f1-old.png`, TOK2)));
  assert.equal((await W('projects/p1').get()).get('key'), 'NI');
  assert.equal((await W('labels/l1').get()).get('name'), 'bug');

  const [meta] = await bucket.file(newImg).getMetadata();
  assert.equal(meta.metadata?.firebaseStorageDownloadTokens, TOK1);
  assert.equal(meta.contentType, 'image/png');
  assert.equal((await bucket.file(`workspaces/${wid}/cards/c1/att1/report (final).pdf`).exists())[0], true);

  const legacy = (await db.doc('tokens/t-legacy').get()).data()!;
  assert.deepEqual([legacy.workspaceId, legacy.userId, legacy.userEmail, legacy.userName, legacy.hash], [wid, 'u-owner', OWNER, 'Owner', 'h1']);
  const tAlice = (await db.doc('tokens/t-alice').get()).data()!;
  assert.deepEqual([tAlice.workspaceId, tAlice.userId, tAlice.revoked], [wid, 'u-alice', false]);
  const gone = (await db.doc('tokens/t-gone').get()).data()!;
  assert.deepEqual([gone.workspaceId, gone.revoked], [wid, true]);
  assert.equal(first.tokens.toOwner, 1);
  assert.equal(first.tokens.revoked, 1);
});

await test('verify passes after copy', async () => {
  const v = await verify({ target: t, log: quiet });
  assert.deepEqual(v.failures, []);
  assert.ok(v.ok);
  assert.ok(v.counts['download URLs checked'].new >= 2);
});

await test('copy again makes no changes (idempotent)', async () => {
  const again = await copy({ target: t, log: quiet });
  assert.equal(again.workspaceId, wid);
  assert.equal(copyChanges(again), 0, JSON.stringify(again));
  assert.equal(again.storage.unchanged, 3);
});

await test('a changed source converges; a deleted source leaves extras that only --prune deletes', async () => {
  // Extra old data, copied, then deleted from the old layout (a straggler cleaned up at the source).
  const TMP = 'pages/pg9/tmp.png';
  await db.doc('labels/l2').set({ name: 'temp', color: 'gray' });
  await db.doc('members/carol@example.com').set({ email: 'carol@example.com', role: 'member', addedAt: at('2026-04-01T00:00:00Z'), addedBy: OWNER });
  await bucket.file(TMP).save(Buffer.from('tmp'), { contentType: 'image/png', resumable: false });
  assert.equal(copyChanges(await copy({ target: t, log: quiet })), 3);
  assert.ok((await verify({ target: t, skipUrls: true, log: quiet })).ok);
  await db.doc('labels/l2').delete();
  await db.doc('members/carol@example.com').delete();
  await bucket.file(TMP).delete();
  await db.doc('labels/l1').update({ color: 'blue' });

  // Without --prune: the change converges, the extras stay, so verify (and the lock) fail.
  const kept = await copy({ target: t, log: quiet });
  assert.equal(copyChanges(kept), 1);
  assert.deepEqual([kept.docs.labels.written, kept.docs.labels.extra, kept.docs.labels.deleted], [1, 1, 0]);
  assert.deepEqual([kept.members.extra, kept.members.deleted, kept.storage.extra, kept.storage.deleted], [1, 0, 1, 0]);
  assert.equal((await W('labels/l1').get()).get('color'), 'blue');
  assert.equal((await W('labels/l2').get()).exists, true);
  assert.equal((await W('invites/carol@example.com').get()).exists, true);
  assert.equal((await bucket.file(`workspaces/${wid}/pages/pg9/tmp.png`).exists())[0], true);
  const failing = await verify({ target: t, lock: true, skipUrls: true, log: quiet });
  assert.equal(failing.ok, false);
  assert.equal(failing.locked, false);
  assert.equal((await db.doc(`workspaces/${wid}`).get()).get('migration.lockedAt'), undefined, 'a failing verify must not lock');

  // --prune --dry-run reports the deletions without making them; --prune makes them.
  const dry = await copy({ target: t, prune: true, dryRun: true, log: quiet });
  assert.deepEqual([dry.docs.labels.deleted, dry.members.deleted, dry.storage.deleted], [1, 1, 1]);
  assert.equal((await W('labels/l2').get()).exists, true);
  const pruned = cli(['copy', '--prune']);
  assert.equal(pruned.code, 0, pruned.out);
  assert.match(pruned.out, /deleted 1 extras/);
  assert.equal((await W('labels/l2').get()).exists, false);
  assert.equal((await W('invites/carol@example.com').get()).exists, false);
  assert.equal((await bucket.file(`workspaces/${wid}/pages/pg9/tmp.png`).exists())[0], false);
  assert.ok((await verify({ target: t, skipUrls: true, log: quiet })).ok);
  assert.equal(copyChanges(await copy({ target: t, prune: true, log: quiet })), 0);
});

await test('copy refuses, writing nothing, when the workspace changed after the last copy (with or without --prune)', async () => {
  const live = /change\(s\) since the last copy/;
  const refuses = async (what: string) => {
    for (const o of [{}, { prune: true }, { dryRun: true }, { prune: true, dryRun: true }]) {
      await assert.rejects(copy({ target: t, ...o, log: quiet }), live, `${what} ${JSON.stringify(o)}`);
    }
  };
  const copiedAt = async () => (await db.doc(`workspaces/${wid}`).get()).get('migration.copiedAt') as Timestamp;
  let before = await copiedAt();

  // An edited doc (the app wrote it after the copy) is not overwritten.
  await W('cards/c1').update({ title: 'Live edit' });
  await refuses('edited card');
  const r = cli(['copy', '--prune']);
  assert.notEqual(r.code, 0);
  assert.match(r.out, live);
  assert.match(r.out, /cards\/c1 \(edited\)/);
  assert.equal((await W('cards/c1').get()).get('title'), 'Live edit');
  assert.ok(before.isEqual(await copiedAt()), 'a refused copy does not record copiedAt');
  // Rewritten to exactly what copy would write (e.g. by an interrupted copy): harmless, allowed.
  await W('cards/c1').update({ title: 'First' });
  assert.equal(copyChanges(await copy({ target: t, log: quiet })), 0);
  before = await copiedAt();

  // A new doc, member, signed-in member, file or token in the workspace: refused, nothing deleted.
  await W('labels/live').set({ name: 'live', color: 'green' });
  await refuses('new label');
  assert.equal((await W('labels/live').get()).exists, true);
  await W('labels/live').delete();

  await W('members/u-new').set({ uid: 'u-new', email: 'new@example.com', role: 'member', joinedAt: Timestamp.now() });
  await refuses('new member');
  assert.equal((await W('members/u-new').get()).exists, true);
  await W('members/u-new').delete();

  const alice = (await W('members/u-alice').get()).data()!;
  await W('members/u-alice').update({ lastSignInAt: Timestamp.now() });
  await refuses('member signed in');
  await W('members/u-alice').set(alice);

  const LIVE_FILE = `workspaces/${wid}/cards/c1/live/upload.txt`;
  await bucket.file(LIVE_FILE).save(Buffer.from('new'), { contentType: 'text/plain', resumable: false });
  await refuses('new file');
  assert.equal((await bucket.file(LIVE_FILE).exists())[0], true);
  await bucket.file(LIVE_FILE).delete();

  await db.doc('tokens/t-live').set({ name: 'live bot', hash: 'h9', prefix: 'fira_zzz', revoked: false, workspaceId: wid, userId: 'u-new', userEmail: 'new@example.com', userName: 'New', createdAt: Timestamp.now() });
  await refuses('new token');
  assert.equal((await db.doc('tokens/t-live').get()).get('revoked'), false);
  await db.doc('tokens/t-live').delete();

  // Refusals wrote nothing: copiedAt is unchanged, and the next copy is a no-op.
  assert.ok(before.isEqual(await copiedAt()));
  assert.equal(copyChanges(await copy({ target: t, prune: true, log: quiet })), 0);
  assert.ok((await verify({ target: t, skipUrls: true, log: quiet })).ok);
});

await test('a renamed workspace is refused, not re-created', async () => {
  const ref = db.doc(`workspaces/${wid}`);
  await ref.update({ name: 'Renamed' });
  await assert.rejects(copy({ target: t, log: quiet }), /renamed/);
  await ref.update({ name: 'Ramdan' });

  await db.doc('slugs/ramdan').delete();
  await db.doc('slugs/ramdan2').set({ workspaceId: wid });
  await ref.update({ slug: 'ramdan2' });
  await assert.rejects(copy({ target: t, dryRun: true, log: quiet }), /does not point to it/);
  await assert.rejects(copy({ target: t, log: quiet }), /does not point to it/);
  assert.equal((await db.collection('workspaces').get()).size, 1);
  await db.doc('slugs/ramdan2').delete();
  await db.doc('slugs/ramdan').set({ workspaceId: wid });
  await ref.update({ slug: 'ramdan' });
  assert.equal(copyChanges(await copy({ target: t, log: quiet })), 0);
});

await test('rewritten download URLs answer 200 from the Storage emulator', async () => {
  const pa = (await W('pages/pg1/attachments/pa1').get()).data()!;
  const res = await fetch(pa.url);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'png-bytes-1');
  const content = (await W('pages/pg2').get()).get('content') as string;
  const url = content.slice(content.indexOf('(') + 1, -1);
  const res2 = await fetch(url);
  assert.equal(res2.status, 200);
  assert.equal(await res2.text(), 'png-bytes-2');
});

await test('verify --lock right after copy + verify locks; copy then refuses, even with --prune or --dry-run', async () => {
  assert.equal(copyChanges(await copy({ target: t, log: quiet })), 0);
  const r0 = cli(['verify', '--lock']);
  assert.equal(r0.code, 0, r0.out);
  assert.match(r0.out, /locked workspaces\//);
  const ws = (await db.doc(`workspaces/${wid}`).get()).data()!;
  assert.ok(ws.migration.lockedAt instanceof Timestamp);
  const again = await verify({ target: t, lock: true, skipUrls: true, log: quiet });
  assert.ok(again.ok && again.locked);
  for (const o of [{}, { prune: true }, { dryRun: true }]) await assert.rejects(copy({ target: t, ...o, log: quiet }), /locked/);
  for (const args of [['copy'], ['copy', '--prune'], ['copy', '--dry-run', '--prune']]) {
    const r = cli(args);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /locked/);
  }
  assert.ok(ws.migration.lockedAt.isEqual((await db.doc(`workspaces/${wid}`).get()).get('migration.lockedAt')));
});

await test('after the lock, live edits still verify (structural checks only)', async () => {
  await W('cards/c1').update({ title: 'Edited after cutover' });
  await W('cards/c2').set({ key: 'NI-2', title: 'New after cutover', description: '' });
  const v = await verify({ target: t, skipUrls: true, log: quiet });
  assert.deepEqual(v.failures, []);
  assert.ok(v.info.some((i) => i.includes('1 docs edited') && i.includes('1 new')), v.info.join('; '));
  // An old URL reintroduced in the new data still fails.
  await W('cards/c2').update({ description: `![x](${apiUrl(IMG, TOK1)})` });
  assert.equal((await verify({ target: t, skipUrls: true, log: quiet })).ok, false);
  await W('cards/c2').update({ description: '' });
});

await test('cleanup refuses without --confirm ramdan or a matching stdin answer', async () => {
  await assert.rejects(cleanup({ target: t, log: quiet }), /--confirm ramdan/);
  await assert.rejects(cleanup({ target: t, confirm: 'yes', log: quiet }), /--confirm ramdan/);
  await assert.rejects(cleanup({ target: t, confirm: 'ramdan', ask: async () => 'nope', log: quiet }), /did not match/);
  const noConfirm = cli(['cleanup']);
  assert.notEqual(noConfirm.code, 0);
  const wrongAnswer = cli(['cleanup', '--confirm', 'ramdan'], { input: 'no\n' });
  assert.notEqual(wrongAnswer.code, 0);
  assert.match(wrongAnswer.out, /did not match/);
  assert.equal((await db.collection('cards').get()).size, 1);
  assert.equal((await bucket.getFiles({ prefix: 'pages/' }))[0].length, 2);
});

await test('cleanup --confirm ramdan (slug piped on stdin) deletes the old data and keeps the new', async () => {
  const r = cli(['cleanup', '--confirm', 'ramdan'], { input: 'ramdan\n' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /cleanup will permanently delete/);
  for (const c of ['projects', 'labels', 'cards', 'pages', 'members']) {
    assert.equal((await db.collection(c).listDocuments()).length, 0, `${c} still has docs`);
  }
  assert.equal((await db.doc('cards/ghost/comments/m2').get()).exists, false);
  assert.equal((await db.doc('pages/pg1/presence/u-owner').get()).exists, false);
  assert.equal((await bucket.getFiles({ prefix: 'attachments/' }))[0].length, 0);
  assert.equal((await bucket.getFiles({ prefix: 'pages/' }))[0].length, 0);

  const ws = (await db.doc(`workspaces/${wid}`).get()).data()!;
  assert.equal(ws.migration, undefined);
  assert.equal((await W('cards/c1').get()).get('title'), 'Edited after cutover');
  assert.equal((await W('members/u-owner').get()).get('role'), 'owner');
  assert.equal((await W('invites/bob@example.com').get()).exists, true);
  assert.equal((await db.collection('tokens').get()).size, 3);
  assert.equal((await bucket.getFiles({ prefix: `workspaces/${wid}/` }))[0].length, 3);
  const pa = (await W('pages/pg1/attachments/pa1').get()).data()!;
  assert.equal((await fetch(pa.url)).status, 200);
  // The workspace is no longer a migration target.
  await assert.rejects(copy({ target: t, log: quiet }), /not created by this migration|already cleaned up/);
});

await t.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nmigrate-check: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
