/**
 * Conditional page saves (src/data/pageSave.ts) against the Firestore emulator, through
 * the real security rules, with the web SDK the SPA uses:
 *
 *   npm run test:docs
 *
 * (`firebase emulators:exec --only firestore` around this script). Refuses to run
 * without FIRESTORE_EMULATOR_HOST.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  terminate,
  updateDoc,
} from 'firebase/firestore';
import type { Actor } from '../shared/types.js';
import { savePageIfCurrent } from '../src/data/pageSave.js';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) {
  console.error('FIRESTORE_EMULATOR_HOST is not set: run via `npm run test:docs`.');
  process.exit(1);
}
const [hostname, port] = host.split(':');
// Sign in as the owner (hardcoded in firestore.rules), so the rules are exercised too.
const ownerEmail = /function ownerEmail\(\)\s*\{\s*return '([^']+)'/.exec(readFileSync('firestore.rules', 'utf8'))?.[1];
assert.ok(ownerEmail, 'owner email not found in firestore.rules');

const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-fira', apiKey: 'fake' });
const db = initializeFirestore(app, {});
connectFirestoreEmulator(db, hostname, Number(port), {
  mockUserToken: { user_id: 'alice', sub: 'alice', email: ownerEmail, email_verified: true },
});

const alice: Actor = { type: 'user', id: 'alice', name: 'Alice' };
const bob: Actor = { type: 'user', id: 'bob', name: 'Bob' };
const agent: Actor = { type: 'token', id: 'tok1', name: 'agen' };

const pageId = `p${Date.now()}`;
const pageRef = doc(db, 'pages', pageId);
const versions = () => getDocs(query(collection(db, 'pages', pageId, 'versions'), orderBy('savedAt', 'asc')));
const page = async () => (await getDoc(pageRef)).data()!;

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

// A page at version 1 with its initial snapshot (as createPage writes it).
await setDoc(pageRef, {
  title: 'Plan',
  content: 'v1',
  version: 1,
  parentId: null,
  rank: 'a0',
  isTemplate: false,
  trashed: false,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  updatedBy: alice,
});
await setDoc(doc(collection(db, 'pages', pageId, 'versions')), { version: 1, title: 'Plan', content: 'v1', savedAt: serverTimestamp(), actor: alice });

await check('save based on the current version succeeds (v1 -> v2)', async () => {
  const res = await savePageIfCurrent(db, pageId, 1, { title: 'Plan', content: 'alice v2' }, alice);
  assert.deepEqual(res, { ok: true, version: 2 });
  const p = await page();
  assert.equal(p.version, 2);
  assert.equal(p.content, 'alice v2');
  assert.deepEqual(p.updatedBy, alice);
  // Same actor within the session gap: no new snapshot.
  assert.equal((await versions()).size, 1);
});

await check('a concurrent write (e.g. the API) moves the page on: v2 -> v3', async () => {
  // What the API does: a versioned write + snapshot.
  await updateDoc(pageRef, { content: 'agent v3', version: 3, updatedAt: serverTimestamp(), updatedBy: agent });
  await setDoc(doc(collection(db, 'pages', pageId, 'versions')), { version: 3, title: 'Plan', content: 'agent v3', savedAt: serverTimestamp(), actor: agent });
});

await check('stale save (based on v2) is rejected and returns the current state, writing nothing', async () => {
  const res = await savePageIfCurrent(db, pageId, 2, { title: 'Plan', content: 'alice edit on v2' }, alice);
  assert.equal(res.ok, false);
  assert.ok(!res.ok);
  assert.equal(res.current.version, 3);
  assert.equal(res.current.content, 'agent v3');
  assert.deepEqual(res.current.updatedBy, agent);
  const p = await page();
  assert.equal(p.version, 3);
  assert.equal(p.content, 'agent v3');
  assert.equal((await versions()).size, 2);
});

await check('stale save whose content equals the current state is a no-op success', async () => {
  const res = await savePageIfCurrent(db, pageId, 2, { title: 'Plan', content: 'agent v3' }, alice);
  assert.deepEqual(res, { ok: true, version: 3 });
  assert.equal((await page()).version, 3);
});

await check('rebased save (based on v3) succeeds; new session snapshots it', async () => {
  const res = await savePageIfCurrent(db, pageId, 3, { title: 'Plan', content: 'alice v4' }, alice);
  assert.deepEqual(res, { ok: true, version: 4 });
  const v = (await versions()).docs.map((d) => d.data());
  // v3 already had a snapshot (agent), so only v4 is added (different actor -> new session).
  assert.deepEqual(v.map((x) => x.version), [1, 3, 4]);
  assert.deepEqual(v[2].actor, alice);
});

await check('two racing saves from the same base: exactly one wins', async () => {
  const [a, b] = await Promise.all([
    savePageIfCurrent(db, pageId, 4, { title: 'Plan', content: 'alice v5' }, alice),
    savePageIfCurrent(db, pageId, 4, { title: 'Plan', content: 'bob v5' }, bob),
  ]);
  assert.equal([a, b].filter((r) => r.ok).length, 1, JSON.stringify([a, b]));
  const p = await page();
  assert.equal(p.version, 5);
  assert.equal(p.content, a.ok ? 'alice v5' : 'bob v5');
});

await check('"keep mine" (snapshot: true) on top of an unsnapshotted edit keeps theirs in history', async () => {
  // Bob saves twice: the second save is in his session, so it has no snapshot.
  const v5 = (await page()).version as number;
  assert.ok((await savePageIfCurrent(db, pageId, v5, { title: 'Plan', content: 'bob a' }, bob)).ok);
  const theirs = v5 + 2;
  assert.deepEqual(await savePageIfCurrent(db, pageId, v5 + 1, { title: 'Plan', content: 'bob b' }, bob), { ok: true, version: theirs });
  assert.ok(!(await versions()).docs.some((d) => d.data().version === theirs), 'bob b is not snapshotted yet');
  // Alice was based on an older version: rejected, then keeps hers on top.
  const stale = await savePageIfCurrent(db, pageId, v5, { title: 'Plan', content: 'alice mine' }, alice);
  assert.ok(!stale.ok && stale.current.version === theirs && stale.current.content === 'bob b');
  const res = await savePageIfCurrent(db, pageId, theirs, { title: 'Plan', content: 'alice mine' }, alice, { snapshot: true });
  assert.deepEqual(res, { ok: true, version: theirs + 1 });
  const v = (await versions()).docs.map((d) => d.data());
  const snapTheirs = v.find((x) => x.version === theirs);
  assert.ok(snapTheirs, 'theirs was snapshotted');
  assert.equal(snapTheirs.content, 'bob b');
  assert.deepEqual(snapTheirs.actor, bob);
  assert.equal(v.at(-1)!.version, theirs + 1);
  assert.equal(v.at(-1)!.content, 'alice mine');
});

await check('title-only change is versioned the same way', async () => {
  const cur = (await page()).version as number;
  const stale = await savePageIfCurrent(db, pageId, cur - 1, { title: 'Renamed', content: 'alice mine' }, alice);
  assert.ok(!stale.ok);
  const res = await savePageIfCurrent(db, pageId, cur, { title: 'Renamed', content: 'alice mine' }, alice);
  assert.deepEqual(res, { ok: true, version: cur + 1 });
  assert.equal((await page()).title, 'Renamed');
});

await check('force (version restore) saves on top of whatever is current', async () => {
  const cur = (await page()).version as number;
  const res = await savePageIfCurrent(db, pageId, 1, { title: 'Plan', content: 'v1' }, alice, { force: true, snapshot: true });
  assert.deepEqual(res, { ok: true, version: cur + 1 });
  const v = (await versions()).docs.map((d) => d.data().version);
  assert.deepEqual(v.slice(-2), [cur, cur + 1]);
});

await check('missing page rejects', async () => {
  await assert.rejects(savePageIfCurrent(db, 'nope', 1, { title: '', content: '' }, alice), /not found/);
});

await terminate(db);
console.log(`\n${passed} checks passed`);
process.exit(0);
