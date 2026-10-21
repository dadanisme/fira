/**
 * Firestore + Storage security rules test against the Firebase emulators.
 *
 *   npm run test:rules
 *
 * which runs `firebase emulators:exec --only firestore,storage,auth --project demo-fira`
 * around this script. Seeds two workspaces with the Admin SDK (bypasses rules), then signs in
 * as emulator users with the client SDK (rules apply) to check the workspace access model:
 * content is open to members (a `workspaces/{wid}/members/{uid}` doc exists), workspaces,
 * members and invites are server-only writes, slugs and tokens have no client access, and the
 * "my workspaces" / "my invites" collection-group queries only return the caller's own docs.
 * Attachment records must name their own Storage object, and a workspace flagged `deleting`
 * takes no content writes.
 */
import assert from 'node:assert/strict';
import { deleteApp, initializeApp as initClient, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  query,
  setDoc,
  setLogLevel,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { connectStorageEmulator, deleteObject, getBytes, getStorage, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import { initializeApp as initAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';

for (const v of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!process.env[v]) {
    console.error(`${v} is not set: run via \`npm run test:rules\` (firebase emulators:exec).`);
    process.exit(1);
  }
}

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-fira';
const BUCKET = `${PROJECT_ID}.appspot.com`;
const PASSWORD = 'rules-password';

// Denied writes are expected; keep the SDK from logging each one.
setLogLevel('silent');

const admin = initAdmin({ projectId: PROJECT_ID, storageBucket: BUCKET });
const adminDb = getAdminFirestore(admin);
const adminAuth = getAdminAuth(admin);
const adminBucket = getAdminStorage(admin).bucket();

// ---------------------------------------------------------------- harness

interface Client {
  app: FirebaseApp;
  db: Firestore;
  storage: FirebaseStorage;
}

const clients: FirebaseApp[] = [];
async function signIn(uid: string, email: string, opts: { verified?: boolean } = {}): Promise<Client> {
  await adminAuth.createUser({ uid, email, password: PASSWORD, emailVerified: opts.verified ?? true, displayName: uid });
  const app = initClient({ apiKey: 'fake', projectId: PROJECT_ID, storageBucket: BUCKET }, email);
  clients.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const db = getFirestore(app);
  const [fsHost, fsPort] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  connectFirestoreEmulator(db, fsHost, Number(fsPort));
  const storage = getStorage(app);
  const [stHost, stPort] = process.env.FIREBASE_STORAGE_EMULATOR_HOST!.replace(/^https?:\/\//, '').split(':');
  connectStorageEmulator(storage, stHost, Number(stPort));
  await signInWithEmailAndPassword(auth, email, PASSWORD);
  return { app, db, storage };
}

async function allowed(what: string, op: () => Promise<unknown>) {
  try {
    await op();
  } catch (err) {
    assert.fail(`${what}: expected allowed, got ${(err as { code?: string }).code ?? err}`);
  }
}

async function denied(what: string, op: () => Promise<unknown>) {
  try {
    await op();
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    assert.ok(/permission-denied|unauthorized/.test(code), `${what}: expected permission denied, got ${code || err}`);
    return;
  }
  assert.fail(`${what}: expected denied, but it was allowed`);
}

const results: { name: string; ok: boolean }[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  FAIL  ${name}\n        ${(error as Error).message.split('\n').join('\n        ')}`);
  }
}

// ---------------------------------------------------------------- seed (Admin SDK, bypasses rules)

// Workspace A: owner o, admin a, member m, a pending invite for x@. Workspace B: member m2.
// Stranger s belongs to nothing; u is unverified and has an invite to A.
const A = 'wsA';
const B = 'wsB';
const workspace = (slug: string, ownerUid: string) => ({ name: slug.toUpperCase(), slug, ownerUid, createdBy: ownerUid, createdAt: new Date() });
const member = (wid: string, uid: string, role: 'owner' | 'admin' | 'member') => ({
  uid,
  email: `${uid}@example.com`,
  name: uid,
  role,
  joinedAt: new Date(),
  workspaceName: wid.toUpperCase(),
  workspaceSlug: wid.toLowerCase(),
});
const invite = (wid: string, email: string) => ({
  email,
  role: 'member',
  invitedBy: { uid: 'o', name: 'o', email: 'o@example.com' },
  createdAt: new Date(),
  emailStatus: 'sent',
  workspaceId: wid,
  workspaceName: wid.toUpperCase(),
});
await adminDb.doc(`workspaces/${A}`).set(workspace('wsa', 'o'));
await adminDb.doc(`workspaces/${B}`).set(workspace('wsb', 'm2'));
await adminDb.doc(`workspaces/${A}/members/o`).set(member(A, 'o', 'owner'));
await adminDb.doc(`workspaces/${A}/members/a`).set(member(A, 'a', 'admin'));
await adminDb.doc(`workspaces/${A}/members/m`).set(member(A, 'm', 'member'));
await adminDb.doc(`workspaces/${B}/members/m2`).set(member(B, 'm2', 'owner'));
await adminDb.doc(`workspaces/${A}/invites/x@example.com`).set(invite(A, 'x@example.com'));
await adminDb.doc(`workspaces/${A}/invites/u@example.com`).set(invite(A, 'u@example.com'));
await adminDb.doc(`workspaces/${B}/invites/y@example.com`).set(invite(B, 'y@example.com'));
await adminDb.doc('slugs/wsa').set({ workspaceId: A });
for (const w of [A, B]) {
  await adminDb.doc(`workspaces/${w}/cards/c1`).set({ title: 'Card', labels: [] });
  await adminDb.doc(`workspaces/${w}/pages/p1`).set({ title: 'Page', content: '', version: 1 });
  await adminDb.doc(`workspaces/${w}/projects/pr1`).set({ key: 'NI', name: 'Project' });
}
await adminDb.doc('tokens/t-m').set({ workspaceId: A, userId: 'm', name: 'bot', hash: 'x', prefix: 'fira_xxx', revoked: false, createdAt: new Date() });
const bytes = new TextEncoder().encode('hello');
await adminBucket.file(`workspaces/${B}/cards/c1/a1/b.txt`).save(Buffer.from(bytes));
await adminBucket.file('attachments/c1/a1/old.txt').save(Buffer.from(bytes));
await adminBucket.file('pages/p1/f1/old.png').save(Buffer.from(bytes));

const o = await signIn('o', 'o@example.com');
const a = await signIn('a', 'a@example.com');
const m = await signIn('m', 'M@Example.com'); // mixed case: rules never compare member emails
const s = await signIn('s', 's@example.com');
const x = await signIn('x', 'X@example.com'); // invite lookups compare the lowercased email
const u = await signIn('u', 'u@example.com', { verified: false });

const W = (wid: string, path = '') => `workspaces/${wid}${path && `/${path}`}`;
/** An attachment record; `storagePath` defaults to its own object. */
const attachment = (wid: string, coll: 'cards' | 'pages', id: string, aid: string, storagePath: unknown = `workspaces/${wid}/${coll}/${id}/${aid}/f.png`) => ({
  name: 'f.png',
  size: 1,
  contentType: 'image/png',
  storagePath,
  uploadedBy: { type: 'user', id: 'm', name: 'm' },
  createdAt: new Date(),
});

// ---------------------------------------------------------------- content

await test('member reads and writes content and every subcollection in their workspace', async () => {
  const { db } = m;
  await allowed('read workspace doc', () => getDocFromServer(doc(db, W(A))));
  await allowed('list members', () => getDocsFromServer(collection(db, W(A, 'members'))));
  await allowed('list invites', () => getDocsFromServer(collection(db, W(A, 'invites'))));
  await allowed('read card', () => getDocFromServer(doc(db, W(A, 'cards/c1'))));
  await allowed('list cards', () => getDocsFromServer(collection(db, W(A, 'cards'))));
  await allowed('create card', () => setDoc(doc(db, W(A, 'cards/c2')), { title: 'New', labels: [] }));
  await allowed('update card', () => updateDoc(doc(db, W(A, 'cards/c1')), { title: 'Edited' }));
  await allowed('delete card', () => deleteDoc(doc(db, W(A, 'cards/c2'))));
  await allowed('project', () => setDoc(doc(db, W(A, 'projects/pr2')), { key: 'XY', name: 'P2' }));
  await allowed('label', () => setDoc(doc(db, W(A, 'labels/l1')), { name: 'L', color: 'red' }));
  await allowed('update page', () => updateDoc(doc(db, W(A, 'pages/p1')), { content: 'x', version: 2 }));
  for (const sub of ['comments', 'activity', 'attachments']) {
    const data = sub === 'attachments' ? attachment(A, 'cards', 'c1', 's1') : { a: 1 };
    await allowed(`card ${sub} write`, () => setDoc(doc(db, W(A, `cards/c1/${sub}/s1`)), data));
    await allowed(`card ${sub} read`, () => getDocsFromServer(collection(db, W(A, `cards/c1/${sub}`))));
  }
  for (const sub of ['versions', 'presence', 'threads', 'attachments']) {
    const data = sub === 'attachments' ? attachment(A, 'pages', 'p1', 's1') : { a: 1 };
    await allowed(`page ${sub} write`, () => setDoc(doc(db, W(A, `pages/p1/${sub}/s1`)), data));
    await allowed(`page ${sub} read`, () => getDocsFromServer(collection(db, W(A, `pages/p1/${sub}`))));
    await allowed(`page ${sub} delete`, () => deleteDoc(doc(db, W(A, `pages/p1/${sub}/s1`))));
  }
});

await test("member is denied another workspace's content", async () => {
  const { db } = m;
  await denied('read workspace B', () => getDocFromServer(doc(db, W(B))));
  await denied('read B card', () => getDocFromServer(doc(db, W(B, 'cards/c1'))));
  await denied('list B cards', () => getDocsFromServer(collection(db, W(B, 'cards'))));
  await denied('write B card', () => setDoc(doc(db, W(B, 'cards/c9')), { title: 'x' }));
  await denied('B comment', () => setDoc(doc(db, W(B, 'cards/c1/comments/x')), { body: 'x' }));
  await denied('list B members', () => getDocsFromServer(collection(db, W(B, 'members'))));
  await denied('list B invites', () => getDocsFromServer(collection(db, W(B, 'invites'))));
});

await test('a stranger can access nothing in a workspace', async () => {
  const { db } = s;
  await denied('workspace doc', () => getDocFromServer(doc(db, W(A))));
  await denied('members', () => getDocsFromServer(collection(db, W(A, 'members'))));
  await denied('a member doc', () => getDocFromServer(doc(db, W(A, 'members/m'))));
  await denied('invites', () => getDocsFromServer(collection(db, W(A, 'invites'))));
  await denied('read card', () => getDocFromServer(doc(db, W(A, 'cards/c1'))));
  await denied('write card', () => setDoc(doc(db, W(A, 'cards/c9')), { title: 'x' }));
  await denied('read page', () => getDocFromServer(doc(db, W(A, 'pages/p1'))));
  await denied('page version', () => setDoc(doc(db, W(A, 'pages/p1/versions/v9')), { version: 9 }));
  await denied('projects', () => getDocsFromServer(collection(db, W(A, 'projects'))));
  await denied('join by writing own member doc', () => setDoc(doc(db, W(A, 'members/s')), member(A, 's', 'member')));
});

await test('attachment records must point at their own object (no forged storagePath)', async () => {
  const { db } = m;
  for (const coll of ['cards', 'pages'] as const) {
    const id = coll === 'cards' ? 'c1' : 'p1';
    const at = (aid: string) => doc(db, W(A, `${coll}/${id}/attachments/${aid}`));
    const forged = (what: string, path: unknown) => denied(`${coll}: ${what}`, () => setDoc(at('f1'), attachment(A, coll, id, 'f1', path)));
    await allowed(`${coll}: own path`, () => setDoc(at('f1'), attachment(A, coll, id, 'f1')));
    await allowed(`${coll}: own path, name with a slash`, () => setDoc(at('f2'), attachment(A, coll, id, 'f2', `workspaces/${A}/${coll}/${id}/f2/x/y.png`)));
    await forged('another workspace', `workspaces/${B}/${coll}/${id}/f1/secret.pdf`);
    await forged("another workspace's card attachment", `workspaces/${B}/cards/c1/a1/b.txt`);
    await forged(coll === 'cards' ? 'the pages area' : 'the cards area', `workspaces/${A}/${coll === 'cards' ? 'pages' : 'cards'}/${id}/f1/x.png`);
    await forged('another card/page', `workspaces/${A}/${coll}/other/f1/x.png`);
    await forged('another attachment id', `workspaces/${A}/${coll}/${id}/f2/x.png`);
    await forged('no file name', `workspaces/${A}/${coll}/${id}/f1/`);
    await forged('the prefix only', `workspaces/${A}/${coll}/${id}/f1`);
    await forged('the old root layout', `${coll === 'cards' ? 'attachments' : 'pages'}/${id}/f1/old.png`);
    await forged('a leading slash', `/workspaces/${A}/${coll}/${id}/f1/x.png`);
    await forged('not a string', 42);
    await denied(`${coll}: missing storagePath`, () => setDoc(at('f3'), { name: 'x', size: 1 }));
    await denied(`${coll}: update to a forged path`, () => updateDoc(at('f1'), { storagePath: `workspaces/${B}/cards/c1/a1/b.txt` }));
    await allowed(`${coll}: update other fields`, () => updateDoc(at('f1'), { name: 'renamed.png' }));
    await allowed(`${coll}: delete`, () => deleteDoc(at('f1')));
  }
});

await test('a workspace flagged deleting (or without its doc) takes no content writes; reads still work', async () => {
  const C = 'wsC';
  const G = 'wsGhost';
  await adminDb.doc(W(C)).set({ ...workspace('wsc', 'm'), deleting: true });
  await adminDb.doc(W(C, 'members/m')).set(member(C, 'm', 'owner'));
  await adminDb.doc(W(C, 'cards/c1')).set({ title: 'Card', labels: [] });
  await adminDb.doc(W(G, 'members/m')).set(member(G, 'm', 'member')); // workspace doc already gone
  const { db } = m;
  try {
    await allowed('read card', () => getDocFromServer(doc(db, W(C, 'cards/c1'))));
    await denied('create card', () => setDoc(doc(db, W(C, 'cards/c2')), { title: 'x' }));
    await denied('update card', () => updateDoc(doc(db, W(C, 'cards/c1')), { title: 'x' }));
    await denied('delete card', () => deleteDoc(doc(db, W(C, 'cards/c1'))));
    await denied('comment', () => setDoc(doc(db, W(C, 'cards/c1/comments/x')), { body: 'x' }));
    await denied('attachment', () => setDoc(doc(db, W(C, 'cards/c1/attachments/f1')), attachment(C, 'cards', 'c1', 'f1')));
    await denied('page', () => setDoc(doc(db, W(C, 'pages/p9')), { title: 'x' }));
    await denied('ghost workspace card', () => setDoc(doc(db, W(G, 'cards/c1')), { title: 'x' }));
    await adminDb.doc(W(C)).update({ deleting: false });
    await allowed('writes again once the flag is cleared', () => updateDoc(doc(db, W(C, 'cards/c1')), { title: 'ok' }));
  } finally {
    // m's member docs here would show up in the "my workspaces" test below.
    await adminDb.recursiveDelete(adminDb.doc(W(C)));
    await adminDb.recursiveDelete(adminDb.doc(W(G)));
  }
});

// ---------------------------------------------------------------- server-only docs

await test('no client writes workspaces, members or invites (not even the owner)', async () => {
  for (const [who, uid, { db }] of [['owner', 'o', o], ['admin', 'a', a], ['member', 'm', m]] as const) {
    await denied(`${who} creates a workspace`, () => setDoc(doc(db, 'workspaces/wsNew'), workspace('new', uid)));
    await denied(`${who} updates the workspace`, () => updateDoc(doc(db, W(A)), { name: 'Hacked' }));
    await denied(`${who} deletes the workspace`, () => deleteDoc(doc(db, W(A))));
    await denied(`${who} adds a member`, () => setDoc(doc(db, W(A, 'members/s')), member(A, 's', 'member')));
    await denied(`${who} changes a role`, () => updateDoc(doc(db, W(A, 'members/m')), { role: 'owner' }));
    await denied(`${who} edits own profile`, () => updateDoc(doc(db, W(A, `members/${uid}`)), { name: 'X' }));
    await denied(`${who} removes a member`, () => deleteDoc(doc(db, W(A, 'members/m'))));
    await denied(`${who} creates an invite`, () => setDoc(doc(db, W(A, 'invites/z@example.com')), invite(A, 'z@example.com')));
    await denied(`${who} updates an invite`, () => updateDoc(doc(db, W(A, 'invites/x@example.com')), { role: 'admin' }));
    await denied(`${who} deletes an invite`, () => deleteDoc(doc(db, W(A, 'invites/x@example.com'))));
  }
  await denied('invitee deletes (declines) their invite directly', () => deleteDoc(doc(x.db, W(A, 'invites/x@example.com'))));
  await denied('invitee accepts by writing a member doc', () => setDoc(doc(x.db, W(A, 'members/x')), member(A, 'x', 'member')));
});

await test('slugs and tokens have no client access', async () => {
  for (const [who, { db }] of [['owner', o], ['member', m], ['stranger', s]] as const) {
    await denied(`${who} reads a slug`, () => getDocFromServer(doc(db, 'slugs/wsa')));
    await denied(`${who} lists slugs`, () => getDocsFromServer(collection(db, 'slugs')));
    await denied(`${who} reserves a slug`, () => setDoc(doc(db, 'slugs/mine'), { workspaceId: A }));
    await denied(`${who} reads a token`, () => getDocFromServer(doc(db, 'tokens/t-m')));
    await denied(`${who} queries own tokens`, () => getDocsFromServer(query(collection(db, 'tokens'), where('userId', '==', 'm'))));
    await denied(`${who} writes a token`, () => setDoc(doc(db, 'tokens/t-new'), { workspaceId: A, userId: 'm' }));
    await denied(`${who} revokes a token`, () => updateDoc(doc(db, 'tokens/t-m'), { revoked: true }));
  }
});

await test('only the whitelisted collections and subcollections are writable', async () => {
  const { db } = m;
  await denied('workspaces/A/other/x write', () => setDoc(doc(db, W(A, 'other/x')), { a: 1 }));
  await denied('workspaces/A/other/x read', () => getDocFromServer(doc(db, W(A, 'other/x'))));
  await denied('unknown card subcollection', () => setDoc(doc(db, W(A, 'cards/c1/other/x')), { a: 1 }));
  // Fake member/invite docs nested in content would leak into the collection-group queries.
  await denied('nested fake member doc', () => setDoc(doc(db, W(A, 'cards/c1/members/s')), member(A, 's', 'owner')));
  await denied('nested fake invite doc', () => setDoc(doc(db, W(A, 'pages/p1/invites/s@example.com')), invite(A, 's@example.com')));
  await denied('deeper nesting', () => setDoc(doc(db, W(A, 'cards/c1/comments/s1/members/s')), member(A, 's', 'owner')));
  await denied('old top-level cards', () => getDocFromServer(doc(db, 'cards/c1')));
  await denied('old top-level members', () => getDocsFromServer(collection(db, 'members')));
});

// ---------------------------------------------------------------- collection-group queries

await test('"my workspaces": members collection group filtered on my uid', async () => {
  const mine = await getDocsFromServer(query(collectionGroup(m.db, 'members'), where('uid', '==', 'm')));
  assert.deepEqual(mine.docs.map((d) => d.ref.path), [W(A, 'members/m')]);
  const strangers = await getDocsFromServer(query(collectionGroup(s.db, 'members'), where('uid', '==', 's')));
  assert.equal(strangers.size, 0);
  await denied("another user's uid", () => getDocsFromServer(query(collectionGroup(m.db, 'members'), where('uid', '==', 'm2'))));
  await denied('unfiltered', () => getDocsFromServer(collectionGroup(m.db, 'members')));
  await denied('filtered on email instead', () => getDocsFromServer(query(collectionGroup(m.db, 'members'), where('email', '==', 'm@example.com'))));
  await allowed('own member doc by path', () => getDocFromServer(doc(m.db, W(A, 'members/m'))));
});

await test('"my invites": invites collection group filtered on my verified email', async () => {
  const mine = await getDocsFromServer(query(collectionGroup(x.db, 'invites'), where('email', '==', 'x@example.com')));
  assert.deepEqual(mine.docs.map((d) => d.ref.path), [W(A, 'invites/x@example.com')]);
  await allowed('own invite by path', () => getDocFromServer(doc(x.db, W(A, 'invites/x@example.com'))));
  await denied('another email', () => getDocsFromServer(query(collectionGroup(x.db, 'invites'), where('email', '==', 'y@example.com'))));
  await denied('unfiltered', () => getDocsFromServer(collectionGroup(x.db, 'invites')));
  await denied('unverified account', () => getDocsFromServer(query(collectionGroup(u.db, 'invites'), where('email', '==', 'u@example.com'))));
  await denied('invitee cannot read the workspace doc', () => getDocFromServer(doc(x.db, W(A))));
});

// ---------------------------------------------------------------- storage (cross-service rules)

const TEN_MB = 10 * 1024 * 1024;

await test('storage: members upload, read and delete card and page files in their workspace', async () => {
  const { storage } = m;
  for (const path of [W(A, 'cards/c1/a1/hello.txt'), W(A, 'pages/p1/f1/img.png')]) {
    await allowed(`upload ${path}`, () => uploadBytes(ref(storage, path), bytes));
    await allowed(`read ${path}`, () => getBytes(ref(storage, path)));
    await allowed(`read by another member`, () => getBytes(ref(a.storage, path)));
  }
  await allowed('delete', () => deleteObject(ref(storage, W(A, 'pages/p1/f1/img.png'))));
});

await test('storage: 10 MB per file', async () => {
  await allowed('exactly 10 MB', () => uploadBytes(ref(m.storage, W(A, 'cards/c1/big/10mb.bin')), new Uint8Array(TEN_MB)));
  await denied('10 MB + 1 byte', () => uploadBytes(ref(m.storage, W(A, 'cards/c1/big/over.bin')), new Uint8Array(TEN_MB + 1)));
  await denied('10 MB + 1 byte overwrite', () => uploadBytes(ref(m.storage, W(A, 'cards/c1/big/10mb.bin')), new Uint8Array(TEN_MB + 1)));
});

await test('storage: other workspaces, other areas, the old layout and strangers are denied', async () => {
  await denied('B upload', () => uploadBytes(ref(m.storage, W(B, 'cards/c1/a2/x.txt')), bytes));
  await denied('B read', () => getBytes(ref(m.storage, W(B, 'cards/c1/a1/b.txt'))));
  await denied('B delete', () => deleteObject(ref(m.storage, W(B, 'cards/c1/a1/b.txt'))));
  await denied('other area upload', () => uploadBytes(ref(m.storage, W(A, 'other/x/y.txt')), bytes));
  await denied('workspace root upload', () => uploadBytes(ref(m.storage, W(A, 'loose.txt')), bytes));
  await denied('old attachments/ read', () => getBytes(ref(m.storage, 'attachments/c1/a1/old.txt')));
  await denied('old attachments/ upload', () => uploadBytes(ref(m.storage, 'attachments/c1/a9/new.txt'), bytes));
  await denied('old pages/ read', () => getBytes(ref(m.storage, 'pages/p1/f1/old.png')));
  await denied('stranger upload', () => uploadBytes(ref(s.storage, W(A, 'cards/c1/a2/x.txt')), bytes));
  await denied('stranger read', () => getBytes(ref(s.storage, W(A, 'cards/c1/a1/hello.txt'))));
  await denied('stranger delete', () => deleteObject(ref(s.storage, W(A, 'cards/c1/a1/hello.txt'))));
});

// ---------------------------------------------------------------- removal

await test('removing a member cuts access immediately (Firestore + Storage)', async () => {
  await adminDb.doc(W(A, 'members/m')).delete();
  await denied('read workspace', () => getDocFromServer(doc(m.db, W(A))));
  await denied('read card', () => getDocFromServer(doc(m.db, W(A, 'cards/c1'))));
  await denied('write card', () => setDoc(doc(m.db, W(A, 'cards/c3')), { title: 'x' }));
  await denied('storage read', () => getBytes(ref(m.storage, W(A, 'cards/c1/a1/hello.txt'))));
  await denied('storage upload', () => uploadBytes(ref(m.storage, W(A, 'cards/c1/a3/x.txt')), bytes));
  const mine = await getDocsFromServer(query(collectionGroup(m.db, 'members'), where('uid', '==', 'm')));
  assert.equal(mine.size, 0, 'removed member still listed in "my workspaces"');
  await allowed('the other members keep access', () => getDocFromServer(doc(a.db, W(A, 'cards/c1'))));
});

// ---------------------------------------------------------------- done

await Promise.all(clients.map((app) => deleteApp(app)));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
