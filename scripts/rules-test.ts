/**
 * Firestore + Storage security rules test against the Firebase emulators.
 *
 *   npm run test:rules
 *
 * which runs `firebase emulators:exec --only firestore,storage,auth --project demo-fira`
 * around this script. Seeds data with the Admin SDK (bypasses rules), then signs in as
 * emulator users with the client SDK (rules apply) to check the owner / member / stranger
 * access model. The owner email is the one hardcoded in firestore.rules and storage.rules.
 */
import assert from 'node:assert/strict';
import { deleteApp, initializeApp as initClient, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  collection,
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
import { connectStorageEmulator, getBytes, getStorage, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import { initializeApp as initAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';

for (const v of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!process.env[v]) {
    console.error(`${v} is not set: run via \`npm run test:rules\` (firebase emulators:exec).`);
    process.exit(1);
  }
}

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-fira';
const BUCKET = `${PROJECT_ID}.appspot.com`;
const OWNER = 'huntercitation@gmail.com';
const PASSWORD = 'rules-password';

// Denied writes are expected; keep the SDK from logging each one.
setLogLevel('silent');

const admin = initAdmin({ projectId: PROJECT_ID, storageBucket: BUCKET });
const adminDb = getAdminFirestore(admin);
const adminAuth = getAdminAuth(admin);

// ---------------------------------------------------------------- harness

interface Client {
  app: FirebaseApp;
  db: Firestore;
  storage: FirebaseStorage;
}

const clients: FirebaseApp[] = [];
async function signIn(email: string, opts: { verified?: boolean } = {}): Promise<Client> {
  await adminAuth.createUser({ email, password: PASSWORD, emailVerified: opts.verified ?? true, displayName: email.split('@')[0] });
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

const member = (email: string, role = 'member') => ({ email, role, addedAt: new Date(), addedBy: OWNER });
await adminDb.doc(`members/${OWNER}`).set(member(OWNER, 'owner'));
await adminDb.doc('members/bob@example.com').set(member('bob@example.com'));
await adminDb.doc('members/carol@example.com').set(member('carol@example.com'));
await adminDb.doc('members/dave@example.com').set(member('dave@example.com'));
await adminDb.doc('cards/c1').set({ title: 'Card', labels: [] });
await adminDb.doc('pages/p1').set({ title: 'Page', content: '', version: 1 });
const token = (name: string, userEmail?: string) => ({ name, hash: 'x', prefix: 'fira_xxx', revoked: false, createdAt: new Date(), ...(userEmail && { userEmail }) });
await adminDb.doc('tokens/t-owner').set(token('owner bot', OWNER));
await adminDb.doc('tokens/t-bob').set(token('bob bot', 'bob@example.com'));
await adminDb.doc('tokens/t-legacy').set(token('legacy'));
const bytes = new TextEncoder().encode('hello');

const owner = await signIn(OWNER);
const bob = await signIn('Bob@Example.com'); // mixed case: rules compare lowercased emails
const stranger = await signIn('eve@example.com');
const unverified = await signIn('dave@example.com', { verified: false });

// ---------------------------------------------------------------- firestore

await test('non-member is denied everything', async () => {
  const { db } = stranger;
  await denied('read card', () => getDocFromServer(doc(db, 'cards/c1')));
  await denied('write card', () => setDoc(doc(db, 'cards/x'), { title: 'x' }));
  await denied('read page', () => getDocFromServer(doc(db, 'pages/p1')));
  await denied('list members', () => getDocsFromServer(collection(db, 'members')));
  await denied('read own (missing) member doc', () => getDocFromServer(doc(db, 'members/eve@example.com')));
  await denied('create own member doc', () => setDoc(doc(db, 'members/eve@example.com'), member('eve@example.com')));
  await denied('read a token', () => getDocFromServer(doc(db, 'tokens/t-bob')));
});

await test('unverified email with a member doc is denied', async () => {
  await denied('read card', () => getDocFromServer(doc(unverified.db, 'cards/c1')));
  await denied('read members', () => getDocsFromServer(collection(unverified.db, 'members')));
});

await test('member can read/write cards, pages and subcollections', async () => {
  const { db } = bob;
  await allowed('read card', () => getDocFromServer(doc(db, 'cards/c1')));
  await allowed('create card', () => setDoc(doc(db, 'cards/c2'), { title: 'Bob card', labels: [] }));
  await allowed('update card', () => updateDoc(doc(db, 'cards/c1'), { title: 'Edited' }));
  await allowed('comment', () => setDoc(doc(db, 'cards/c1/comments/m1'), { body: 'hi' }));
  await allowed('update page', () => updateDoc(doc(db, 'pages/p1'), { content: 'x', version: 2 }));
  await allowed('page version', () => setDoc(doc(db, 'pages/p1/versions/v2'), { version: 2 }));
  await allowed('labels/projects', () => setDoc(doc(db, 'labels/l1'), { name: 'L', color: 'red' }));
  await allowed('list members', () => getDocsFromServer(collection(db, 'members')));
});

await test('member cannot manage members', async () => {
  const { db } = bob;
  await denied('create member', () => setDoc(doc(db, 'members/zed@example.com'), member('zed@example.com')));
  await denied('delete other member', () => deleteDoc(doc(db, 'members/carol@example.com')));
  await denied('delete own member doc', () => deleteDoc(doc(db, 'members/bob@example.com')));
  await denied("edit other's profile", () => updateDoc(doc(db, 'members/carol@example.com'), { name: 'Hacked' }));
  await denied('promote self', () => updateDoc(doc(db, 'members/bob@example.com'), { role: 'owner' }));
  await denied('edit own addedBy', () => updateDoc(doc(db, 'members/bob@example.com'), { addedBy: 'bob@example.com' }));
  await denied('write via catch-all path', () => setDoc(doc(db, 'members/bob@example.com/x/y'), { a: 1 }));
});

await test('member can update only their own profile fields', async () => {
  await allowed('own profile', () =>
    updateDoc(doc(bob.db, 'members/bob@example.com'), { uid: 'u-bob', name: 'Bob', photoURL: 'https://x/y.png', lastSignInAt: new Date() }),
  );
});

await test('member reads only their own tokens; nobody writes tokens', async () => {
  const { db } = bob;
  await allowed('own token', () => getDocFromServer(doc(db, 'tokens/t-bob')));
  await allowed('query own tokens', () => getDocsFromServer(query(collection(db, 'tokens'), where('userEmail', '==', 'bob@example.com'))));
  await denied("owner's token", () => getDocFromServer(doc(db, 'tokens/t-owner')));
  await denied('legacy (owner) token', () => getDocFromServer(doc(db, 'tokens/t-legacy')));
  await denied('list all tokens', () => getDocsFromServer(collection(db, 'tokens')));
  await denied('member writes a token', () => setDoc(doc(db, 'tokens/t-new'), token('x', 'bob@example.com')));
  await denied('member revokes own token directly', () => updateDoc(doc(db, 'tokens/t-bob'), { revoked: true }));
  await allowed('owner lists all tokens', () => getDocsFromServer(collection(owner.db, 'tokens')));
  await denied('owner writes a token', () => setDoc(doc(owner.db, 'tokens/t-new'), token('x', OWNER)));
});

await test('owner manages members (but cannot remove themselves or mint owners)', async () => {
  const { db } = owner;
  await allowed('read card', () => getDocFromServer(doc(db, 'cards/c1')));
  await allowed('add member', () => setDoc(doc(db, 'members/zed@example.com'), member('zed@example.com')));
  await denied('add an owner', () => setDoc(doc(db, 'members/yan@example.com'), member('yan@example.com', 'owner')));
  await denied('id/email mismatch', () => setDoc(doc(db, 'members/a@example.com'), member('b@example.com')));
  await allowed('edit member', () => updateDoc(doc(db, 'members/zed@example.com'), { name: 'Zed' }));
  await allowed('remove member', () => deleteDoc(doc(db, 'members/zed@example.com')));
  await denied('remove own doc', () => deleteDoc(doc(db, `members/${OWNER}`)));
  await allowed('update own profile', () => updateDoc(doc(db, `members/${OWNER}`), { name: 'Owner', lastSignInAt: new Date() }));
});

// ---------------------------------------------------------------- storage (cross-service rules)

await test('storage: members read/write attachments and page files; non-members cannot', async () => {
  await allowed('member upload', () => uploadBytes(ref(bob.storage, 'attachments/c1/a1/hello.txt'), bytes));
  await allowed('member read', () => getBytes(ref(bob.storage, 'attachments/c1/a1/hello.txt')));
  await allowed('owner upload page file', () => uploadBytes(ref(owner.storage, 'pages/p1/f1/img.png'), bytes));
  await allowed('member read page file', () => getBytes(ref(bob.storage, 'pages/p1/f1/img.png')));
  await denied('stranger upload', () => uploadBytes(ref(stranger.storage, 'attachments/c1/a2/x.txt'), bytes));
  await denied('stranger read', () => getBytes(ref(stranger.storage, 'attachments/c1/a1/hello.txt')));
  await denied('unverified read', () => getBytes(ref(unverified.storage, 'pages/p1/f1/img.png')));
});

await test('removing a member cuts access immediately (Firestore + Storage)', async () => {
  await adminDb.doc('members/bob@example.com').delete();
  await denied('read card', () => getDocFromServer(doc(bob.db, 'cards/c1')));
  await denied('write card', () => setDoc(doc(bob.db, 'cards/c3'), { title: 'x' }));
  await denied('own token', () => getDocFromServer(doc(bob.db, 'tokens/t-bob')));
  await denied('storage read', () => getBytes(ref(bob.storage, 'attachments/c1/a1/hello.txt')));
});

// ---------------------------------------------------------------- done

await Promise.all(clients.map((app) => deleteApp(app)));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
