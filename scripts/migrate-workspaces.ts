/**
 * One-time migration from the single-space layout (top-level `projects`, `labels`, `cards`,
 * `pages`, `members`; Storage `attachments/**`, `pages/**`) into workspace "Ramdan" (slug
 * `ramdan`). See SPEC.md "Migration" and the cutover runbook.
 *
 *   npm run migrate -- copy    --project fira-dadanisme [--dry-run] [--prune]
 *   npm run migrate -- verify  --project fira-dadanisme [--lock]
 *   npm run migrate -- cleanup --project fira-dadanisme --confirm ramdan
 *
 * Targeting: with the emulator env vars (FIRESTORE_EMULATOR_HOST, FIREBASE_STORAGE_EMULATOR_HOST,
 * FIREBASE_AUTH_EMULATOR_HOST; all three or none) it uses the emulators. Otherwise it refuses
 * to run unless `--project <id>` is passed and equals the FIREBASE_SERVICE_ACCOUNT project.
 * The owner is OWNER_EMAIL (the former single-space owner).
 *
 * - `copy` is idempotent: it converges the workspace to rewrite(old data), writing only docs and
 *   objects that differ. Extras (in the workspace, not in the old data) are kept unless `--prune`.
 *   It refuses, writing nothing, once `verify --lock` has run, or when anything it would
 *   overwrite or delete was written after the last completed copy (`migration.copiedAt`): that
 *   means the app is live. Run `verify --lock` right after the last copy, before deploying.
 * - `verify` is read-only and exits non-zero on any failure. Before the lock it is strict (every
 *   doc equals its rewritten original); after the lock the app is live and edits are expected,
 *   so it checks structure only and reports drift as info.
 * - `cleanup --confirm ramdan` re-verifies, asks for the slug on stdin, then deletes the old data.
 *
 * `copy`, `verify` and `cleanup` are exported for scripts/migrate-check.ts.
 */
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { cert, deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import {
  DocumentReference,
  FieldValue,
  GeoPoint,
  getFirestore,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type Firestore,
} from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { workspaceStoragePrefix } from '../shared/workspaces.js';

export const WORKSPACE_NAME = 'Ramdan';
export const WORKSPACE_SLUG = 'ramdan';
/** Top-level content collections moved under the workspace. */
export const CONTENT_COLLECTIONS = ['projects', 'labels', 'cards', 'pages'] as const;
/** Live-only subcollections, not migrated. */
const SKIP_SUBCOLLECTIONS = new Set(['presence']);
/** Old Storage prefixes → area under `workspaces/{wid}/`. */
const STORAGE_AREAS = [
  { from: 'attachments/', to: 'cards/' },
  { from: 'pages/', to: 'pages/' },
] as const;
const APP_ORIGIN_RE = String.raw`https://fira-six\.vercel\.app`;
const APP_ROUTES = String.raw`(?:p|d|trash|settings)`;
const NOT_EMAILED = 'Not emailed (migrated)';

type Bucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;
type StorageFile = ReturnType<Bucket['file']>;

// ---------------------------------------------------------------- targeting

export interface Target {
  db: Firestore;
  bucket: Bucket;
  auth: Auth;
  projectId: string;
  emulator: boolean;
  close(): Promise<void>;
}

let appCounter = 0;

/** Connects to the emulators (all three hosts set) or to `project` (must equal the service account's). */
export function connect(project?: string): Target {
  const hosts = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'];
  const set = hosts.filter((h) => process.env[h]);
  if (set.length && set.length < hosts.length) {
    throw new Error(`Set all of ${hosts.join(', ')} or none (got only ${set.join(', ')}): refusing to mix emulators and a real project.`);
  }
  let app: App;
  let projectId: string;
  const emulator = set.length === hosts.length;
  const name = `migrate-${++appCounter}`;
  if (emulator) {
    projectId = process.env.GCLOUD_PROJECT ?? 'demo-fira';
    if (project && project !== projectId) throw new Error(`--project ${project} does not match the emulator project ${projectId}.`);
    app = initializeApp({ projectId, storageBucket: process.env.MIGRATE_STORAGE_BUCKET ?? `${projectId}.appspot.com` }, name);
  } else {
    if (!project) throw new Error('Not on the emulators: pass --project <id> explicitly (e.g. --project fira-dadanisme).');
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set (use --env-file=.env.local).');
    const account = JSON.parse(raw) as { project_id: string; client_email: string; private_key: string };
    if (account.project_id !== project) throw new Error(`--project ${project} does not match FIREBASE_SERVICE_ACCOUNT (${account.project_id}).`);
    const viteProject = process.env.VITE_FIREBASE_PROJECT_ID;
    if (viteProject && viteProject !== project) throw new Error(`--project ${project} does not match VITE_FIREBASE_PROJECT_ID (${viteProject}).`);
    projectId = project;
    app = initializeApp(
      {
        credential: cert({ projectId, clientEmail: account.client_email, privateKey: account.private_key }),
        storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`,
      },
      name,
    );
  }
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  return {
    db,
    bucket: getStorage(app).bucket(),
    auth: getAuth(app),
    projectId,
    emulator,
    close: () => deleteApp(app),
  };
}

// ---------------------------------------------------------------- rewriting

export interface RewriteStats {
  /** Firebase Storage download URLs re-pointed. */
  urls: number;
  /** `storagePath` fields mapped. */
  paths: number;
  /** In-app links prefixed with `/w/ramdan`. */
  links: number;
}

const zeroStats = (): RewriteStats => ({ urls: 0, paths: 0, links: 0 });

/** Old Storage object name → new one, or null when it is not in an old area. */
export function mapStoragePath(path: string, wid: string): string | null {
  for (const area of STORAGE_AREAS) {
    if (path.startsWith(area.from)) return `${workspaceStoragePrefix(wid)}${area.to}${path.slice(area.from.length)}`;
  }
  return null;
}

/** Percent-encodes an object name like the API's `downloadUrl` (parentheses included, safe in Markdown). */
export function encodeObjectName(path: string): string {
  return encodeURIComponent(path).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// A path segment char: anything but query/fragment/whitespace/quotes/brackets; balanced `(...)` allowed
// (the client SDK's getDownloadURL leaves parentheses unencoded).
const SEG = String.raw`[^?#\s"'<>()\[\]\\]`;
/** `<origin>/v0/b/<bucket>/o/<encoded path>`; the query (`?alt=media&token=`) follows untouched. */
const storageUrlRe = () => new RegExp(String.raw`(https?://[^/\s"'<>()]+/v0/b/)([^/\s"'<>()]+)(/o/)((?:${SEG}|\(${SEG}*\))+)`, 'g');
/** Full download URL including the query, for verify's fetches. */
const storageUrlWithQueryRe = () =>
  new RegExp(String.raw`https?://[^/\s"'<>()]+/v0/b/[^/\s"'<>()]+/o/(?:${SEG}|\(${SEG}*\))+(?:\?[^\s"'<>()\[\]]*)?`, 'g');
/** Relative in-app links: `](/p/...`, `](</d/...`, `href="/d/...`, `[ref]: /d/...`. */
const relLinkRe = () => new RegExp(String.raw`(\]\(\s*<?|\bhref=["']|^[ \t]*\[[^\]\n]+\]:[ \t]*<?)/(${APP_ROUTES})(?=[/)#?"'>\s]|$)`, 'gm');
/** Absolute in-app links on the production origin. */
const absLinkRe = () => new RegExp(String.raw`(${APP_ORIGIN_RE})/(${APP_ROUTES})(?=[/)#?"'>\s\]]|$)`, 'g');

export function rewriteText(text: string, wid: string, bucketName: string, stats: RewriteStats = zeroStats()): string {
  let out = text.replace(storageUrlRe(), (whole, head: string, bucket: string, o: string, encoded: string) => {
    if (bucket !== bucketName) return whole;
    let decoded: string;
    try {
      decoded = decodeURIComponent(encoded);
    } catch {
      return whole;
    }
    const mapped = mapStoragePath(decoded, wid);
    if (!mapped) return whole;
    stats.urls++;
    return `${head}${bucket}${o}${encodeObjectName(mapped)}`;
  });
  const prefix = `/w/${WORKSPACE_SLUG}`;
  out = out.replace(relLinkRe(), (_w, lead: string, route: string) => {
    stats.links++;
    return `${lead}${prefix}/${route}`;
  });
  out = out.replace(absLinkRe(), (_w, origin: string, route: string) => {
    stats.links++;
    return `${origin}${prefix}/${route}`;
  });
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Deep rewrite of a document's data: every string through `rewriteText`, `storagePath` fields mapped. */
export function rewriteData<T>(value: T, wid: string, bucketName: string, stats: RewriteStats = zeroStats(), key?: string): T {
  if (typeof value === 'string') {
    if (key === 'storagePath') {
      const mapped = mapStoragePath(value, wid);
      if (mapped) {
        stats.paths++;
        return mapped as T;
      }
      return value;
    }
    return rewriteText(value, wid, bucketName, stats) as T;
  }
  if (Array.isArray(value)) return value.map((v) => rewriteData(v, wid, bucketName, stats)) as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewriteData(v, wid, bucketName, stats, k);
    return out as T;
  }
  return value; // Timestamp, GeoPoint, DocumentReference, bytes, numbers, booleans, null
}

/** Structural equality of Firestore values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Timestamp || a instanceof GeoPoint) return (b instanceof Timestamp || b instanceof GeoPoint) && a.isEqual(b as never);
  if (a instanceof DocumentReference) return b instanceof DocumentReference && a.path === b.path;
  if (a instanceof Uint8Array) return b instanceof Uint8Array && Buffer.from(a).equals(Buffer.from(b));
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false;
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b);
}

/** Every string in a value (for leftover checks and URL collection). */
function* strings(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const v of value) yield* strings(v);
  else if (isPlainObject(value)) for (const v of Object.values(value)) yield* strings(v);
}

/** Problems a migrated string must not have. */
function leftovers(text: string): string[] {
  const found: string[] = [];
  if (/\/o\/(?:attachments|pages)%2F/i.test(text)) found.push('old Storage URL');
  if (relLinkRe().test(text) || absLinkRe().test(text)) found.push('un-prefixed in-app link');
  return found;
}

// ---------------------------------------------------------------- tree walking

/** Documents under a root, keyed by path relative to it (`cards/abc/comments/x`). Phantom parents are walked, not listed. */
type Tree = Map<string, DocumentData>;

async function inChunks<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

async function walk(db: Firestore, cols: CollectionReference[], rootPath: string, times?: Map<string, Timestamp>): Promise<Tree> {
  const tree: Tree = new Map();
  const rel = (path: string) => (rootPath ? path.slice(rootPath.length + 1) : path);
  const visit = async (col: CollectionReference): Promise<void> => {
    const refs = await col.listDocuments();
    for (let i = 0; i < refs.length; i += 300) {
      const chunk = refs.slice(i, i + 300);
      const snaps = chunk.length ? await db.getAll(...chunk) : [];
      for (const s of snaps) {
        if (!s.exists) continue;
        tree.set(rel(s.ref.path), s.data()!);
        times?.set(rel(s.ref.path), s.updateTime!);
      }
      await inChunks(chunk, 20, async (ref) => {
        for (const sub of await ref.listCollections()) if (!SKIP_SUBCOLLECTIONS.has(sub.id)) await visit(sub);
      });
    }
  };
  for (const col of cols) await visit(col);
  return tree;
}

const oldTree = (db: Firestore) => walk(db, CONTENT_COLLECTIONS.map((c) => db.collection(c)), '');
const newTree = (db: Firestore, wid: string, times?: Map<string, Timestamp>) =>
  walk(db, CONTENT_COLLECTIONS.map((c) => db.collection(`workspaces/${wid}/${c}`)), `workspaces/${wid}`, times);

/** `cards/abc/comments/x` → `cards/*\/comments`. */
function collectionKey(relPath: string): string {
  const parts = relPath.split('/');
  return parts.filter((_, i) => i % 2 === 0).join('/*/');
}

// ---------------------------------------------------------------- old members / owner

interface OldMember {
  id: string;
  email: string;
  role?: string;
  addedAt?: Timestamp;
  addedBy?: string;
  uid?: string;
  name?: string;
  photoURL?: string;
  lastSignInAt?: Timestamp;
}

interface Owner {
  uid: string;
  email: string;
  name: string;
  addedAt?: Timestamp;
}

function ownerEmail(): string {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('OWNER_EMAIL is not set (the former owner, e.g. OWNER_EMAIL=you@example.com).');
  return email;
}

async function oldMembers(db: Firestore): Promise<OldMember[]> {
  const snap = await db.collection('members').get();
  return snap.docs.map((d) => {
    const data = d.data();
    return { ...data, id: d.id, email: String(data.email ?? d.id).toLowerCase() } as OldMember;
  });
}

async function resolveOwner(t: Target, members: OldMember[]): Promise<Owner> {
  const email = ownerEmail();
  const doc = members.find((m) => m.email === email);
  let uid = doc?.uid;
  let name = doc?.name;
  if (!uid) {
    const user = await t.auth.getUserByEmail(email).catch(() => null);
    uid = user?.uid;
    name ??= user?.displayName;
  }
  if (!uid) throw new Error(`The owner ${email} has no uid (never signed in, and no Auth user): aborting.`);
  return { uid, email, name: name || email, addedAt: doc?.addedAt };
}

// ---------------------------------------------------------------- workspace lookup

interface WorkspaceState {
  wid: string;
  exists: boolean;
  data?: DocumentData;
  locked: boolean;
  /** End of the last completed copy (server time); unset until the first copy finishes. */
  copiedAt?: Timestamp;
  /** When the workspace doc was created (fallback for `copiedAt`). */
  createTime?: Timestamp;
}

/**
 * The migration workspace, found through `slugs/ramdan` and cross-checked against the
 * `migration.ownerEmail` marker, so a renamed workspace is detected instead of re-created.
 */
async function findWorkspace(db: Firestore): Promise<WorkspaceState | null> {
  const marked = (await db.collection('workspaces').where('migration.ownerEmail', '==', ownerEmail()).get()).docs;
  const slug = await db.doc(`slugs/${WORKSPACE_SLUG}`).get();
  const wid = slug.exists ? (slug.get('workspaceId') as string) : null;
  const stray = marked.find((d) => d.id !== wid);
  if (stray) {
    throw new Error(
      `workspaces/${stray.id} was created by this migration but slugs/${WORKSPACE_SLUG} does not point to it (renamed while live?): aborting.`,
    );
  }
  if (!wid) return null;
  const ws = await db.doc(`workspaces/${wid}`).get();
  if (!ws.exists || !ws.get('migration')) {
    throw new Error(`slugs/${WORKSPACE_SLUG} belongs to workspace ${wid}, which was not created by this migration (or was already cleaned up): aborting.`);
  }
  return {
    wid,
    exists: true,
    data: ws.data(),
    locked: !!ws.get('migration.lockedAt'),
    copiedAt: ws.get('migration.copiedAt') as Timestamp | undefined,
    createTime: ws.createTime,
  };
}

const LOCKED = 'The migration is locked (verify --lock ran; the app is live): copy would overwrite new edits. Aborting.';

// ---------------------------------------------------------------- copy

export interface CopyOptions {
  target: Target;
  dryRun?: boolean;
  /** Delete docs, members, invites and objects in the workspace that have no original. Off by default. */
  prune?: boolean;
  log?: (line: string) => void;
}

interface Counts {
  /** Extras: in the workspace, not in the old data (deleted only with `prune`). */
  extra: number;
  deleted: number;
}

export interface CopyResult {
  workspaceId: string;
  createdWorkspace: boolean;
  pruned: boolean;
  docs: Record<string, { source: number; written: number; unchanged: number } & Counts>;
  rewrites: Record<string, RewriteStats>;
  members: { written: number; unchanged: number; members: number; invites: number } & Counts;
  storage: { source: number; copied: number; unchanged: number } & Counts;
  tokens: { total: number; updated: number; unchanged: number; skipped: number; toOwner: number; revoked: number };
  warnings: string[];
}

/** Total writes a copy made (0 on a converged re-run). */
export function copyChanges(r: CopyResult): number {
  const docs = Object.values(r.docs).reduce((n, c) => n + c.written + c.deleted, 0);
  return docs + r.members.written + r.members.deleted + r.storage.copied + r.storage.deleted + r.tokens.updated + (r.createdWorkspace ? 1 : 0);
}

const after = (t: Timestamp | undefined, since: Timestamp) =>
  !!t && (t.seconds > since.seconds || (t.seconds === since.seconds && t.nanoseconds > since.nanoseconds));
/** Storage times are milliseconds: count the copy's own millisecond as "after" too (safe side). */
const fileAfter = (f: StorageFile, since: Timestamp) => {
  const at = Date.parse(String(f.metadata.updated ?? f.metadata.timeCreated ?? ''));
  return Number.isFinite(at) && at >= Math.floor(since.toMillis());
};

/**
 * Converges the workspace to rewrite(old data). Reads and plans everything first, then refuses
 * (writing nothing) if the workspace is locked, or if anything it would overwrite or delete was
 * written after the last completed copy (the app is live). Only then writes, and records
 * `migration.copiedAt` when done.
 */
export async function copy(opts: CopyOptions): Promise<CopyResult> {
  const { target: t, dryRun = false, prune = false } = opts;
  const log = opts.log ?? console.log;
  const { db, bucket } = t;
  const warnings: string[] = [];

  // 1. workspace guard (before anything else: never touch a real or locked workspace)
  let ws = await findWorkspace(db);
  if (ws?.locked) throw new Error(LOCKED);

  // 2. owner, then the workspace itself
  const members = await oldMembers(db);
  const owner = await resolveOwner(t, members);
  let createdWorkspace = false;
  if (!ws) {
    const ref = db.collection('workspaces').doc();
    const createdAt = owner.addedAt ?? Timestamp.now();
    const data = {
      name: WORKSPACE_NAME,
      slug: WORKSPACE_SLUG,
      ownerUid: owner.uid,
      createdBy: owner.uid,
      createdAt,
      migration: { ownerEmail: owner.email },
    };
    if (!dryRun) {
      await db.runTransaction(async (tx) => {
        const slugRef = db.doc(`slugs/${WORKSPACE_SLUG}`);
        if ((await tx.get(slugRef)).exists) throw new Error(`slugs/${WORKSPACE_SLUG} appeared concurrently: re-run.`);
        tx.create(ref, data);
        tx.create(slugRef, { workspaceId: ref.id });
      });
    }
    ws = { wid: ref.id, exists: !dryRun, data, locked: false };
    createdWorkspace = true;
  } else {
    if (ws.data!.ownerUid !== owner.uid) throw new Error(`Workspace ${ws.wid} is owned by ${ws.data!.ownerUid}, not ${owner.email} (${owner.uid}): aborting.`);
    if (ws.data!.name !== WORKSPACE_NAME || ws.data!.slug !== WORKSPACE_SLUG) {
      throw new Error(`Workspace ${ws.wid} was renamed to ${ws.data!.name} (/${ws.data!.slug}): the app is live. Aborting.`);
    }
  }
  const wid = ws.wid;
  const wsCreatedAt = ws.data!.createdAt as Timestamp;
  /** Writes after this are not the migration's: the end of the last copy (or the workspace's creation). */
  const since = createdWorkspace ? null : (ws.copiedAt ?? ws.createTime ?? null);
  /** Things the copy would overwrite or delete that changed after the last copy. */
  const live: string[] = [];
  const isLive = (label: string, newer: boolean) => newer && live.push(label);

  // The plan: nothing is written until every read and the live check are done.
  const sets: { ref: DocumentReference; data: DocumentData; merge?: boolean }[] = [];
  const deletes: DocumentReference[] = [];
  const fileCopies: { src: StorageFile; dest: string }[] = [];
  const fileDeletes: string[] = [];

  // 3. members and invites
  const memberResult = { written: 0, unchanged: 0, extra: 0, deleted: 0, members: 0, invites: 0 };
  {
    const expected = new Map<string, DocumentData>();
    const seenUids = new Set<string>();
    const ownerOld = members.find((m) => m.email === owner.email);
    const memberDoc = (m: Partial<OldMember>, uid: string, role: 'owner' | 'member', email: string) => ({
      uid,
      email,
      name: m.name || email,
      photoURL: m.photoURL,
      role,
      joinedAt: m.addedAt ?? wsCreatedAt,
      invitedBy: role === 'owner' ? undefined : owner.uid,
      lastSignInAt: m.lastSignInAt,
      workspaceName: WORKSPACE_NAME,
      workspaceSlug: WORKSPACE_SLUG,
    });
    expected.set(`members/${owner.uid}`, memberDoc({ ...ownerOld, name: ownerOld?.name || owner.name }, owner.uid, 'owner', owner.email));
    seenUids.add(owner.uid);
    for (const m of members) {
      if (m.email === owner.email) continue;
      if (m.role === 'owner') warnings.push(`members/${m.id} had role owner but is not OWNER_EMAIL: migrated as member.`);
      if (m.uid) {
        if (seenUids.has(m.uid)) {
          warnings.push(`members/${m.id}: uid ${m.uid} already migrated from another email; skipped.`);
          continue;
        }
        seenUids.add(m.uid);
        expected.set(`members/${m.uid}`, memberDoc(m, m.uid, 'member', m.email));
      } else {
        expected.set(`invites/${m.email}`, {
          email: m.email,
          role: 'member',
          invitedBy: { uid: owner.uid, name: owner.name, email: owner.email },
          createdAt: m.addedAt ?? wsCreatedAt,
          emailStatus: 'failed',
          emailError: NOT_EMAILED,
          workspaceId: wid,
          workspaceName: WORKSPACE_NAME,
        });
      }
    }
    for (const key of expected.keys()) memberResult[key.startsWith('members/') ? 'members' : 'invites']++;
    const existing = new Map<string, { data: DocumentData; updated: Timestamp }>();
    if (ws.exists) {
      for (const col of ['members', 'invites']) {
        for (const d of (await db.collection(`workspaces/${wid}/${col}`).get()).docs) existing.set(`${col}/${d.id}`, { data: d.data(), updated: d.updateTime });
      }
    }
    for (const [key, data] of expected) {
      const compact = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
      const have = existing.get(key);
      if (have && deepEqual(have.data, compact)) memberResult.unchanged++;
      else {
        if (have && since) isLive(`${key} (edited)`, after(have.updated, since));
        memberResult.written++;
        sets.push({ ref: db.doc(`workspaces/${wid}/${key}`), data: compact });
      }
    }
    for (const [key, have] of existing) {
      if (expected.has(key)) continue;
      memberResult.extra++;
      if (since) isLive(`${key} (new)`, after(have.updated, since));
      if (!prune) continue;
      memberResult.deleted++;
      deletes.push(db.doc(`workspaces/${wid}/${key}`));
    }
  }

  // 4. storage
  const storageResult = { source: 0, copied: 0, unchanged: 0, extra: 0, deleted: 0 };
  {
    const sources: StorageFile[] = [];
    for (const area of STORAGE_AREAS) sources.push(...(await bucket.getFiles({ prefix: area.from }))[0]);
    const dests = new Map<string, StorageFile>();
    if (ws.exists) {
      for (const area of STORAGE_AREAS) {
        for (const f of (await bucket.getFiles({ prefix: `${workspaceStoragePrefix(wid)}${area.to}` }))[0]) dests.set(f.name, f);
      }
    }
    storageResult.source = sources.length;
    const wanted = new Set<string>();
    for (const src of sources) {
      const destName = mapStoragePath(src.name, wid)!;
      wanted.add(destName);
      const dest = dests.get(destName);
      if (dest && sameObject(src, dest)) storageResult.unchanged++;
      else {
        if (dest && since) isLive(`storage ${destName} (replaced)`, fileAfter(dest, since));
        storageResult.copied++;
        fileCopies.push({ src, dest: destName });
      }
    }
    for (const [name, f] of dests) {
      if (wanted.has(name)) continue;
      storageResult.extra++;
      if (since) isLive(`storage ${name} (new)`, fileAfter(f, since));
      if (!prune) continue;
      storageResult.deleted++;
      fileDeletes.push(name);
    }
  }

  // 5. content documents
  const docs: CopyResult['docs'] = {};
  const rewrites: CopyResult['rewrites'] = {};
  {
    const times = new Map<string, Timestamp>();
    const [olds, news] = await Promise.all([oldTree(db), ws.exists ? newTree(db, wid, times) : Promise.resolve<Tree>(new Map())]);
    const bump = (key: string, field: 'source' | 'written' | 'unchanged' | 'extra' | 'deleted') => {
      docs[key] ??= { source: 0, written: 0, unchanged: 0, extra: 0, deleted: 0 };
      docs[key][field]++;
    };
    for (const [rel, data] of olds) {
      const key = collectionKey(rel);
      bump(key, 'source');
      rewrites[key] ??= zeroStats();
      const next = rewriteData(data, wid, bucket.name, rewrites[key]);
      if (news.has(rel) && deepEqual(news.get(rel), next)) bump(key, 'unchanged');
      else {
        if (news.has(rel) && since) isLive(`${rel} (edited)`, after(times.get(rel), since));
        bump(key, 'written');
        sets.push({ ref: db.doc(`workspaces/${wid}/${rel}`), data: next });
      }
    }
    for (const rel of news.keys()) {
      if (olds.has(rel)) continue;
      bump(collectionKey(rel), 'extra');
      if (since) isLive(`${rel} (new)`, after(times.get(rel), since));
      if (!prune) continue;
      bump(collectionKey(rel), 'deleted');
      deletes.push(db.doc(`workspaces/${wid}/${rel}`));
    }
    for (const [k, s] of Object.entries(rewrites)) if (!s.urls && !s.paths && !s.links) delete rewrites[k];
  }

  // 6. tokens
  const tokenResult = { total: 0, updated: 0, unchanged: 0, skipped: 0, toOwner: 0, revoked: 0 };
  {
    const byUid = new Map<string, { uid: string; email: string; name: string }>();
    const byEmail = new Map<string, { uid: string; email: string; name: string }>();
    byUid.set(owner.uid, owner);
    byEmail.set(owner.email, owner);
    for (const m of members) {
      if (!m.uid || m.email === owner.email || byUid.has(m.uid)) continue;
      const entry = { uid: m.uid, email: m.email, name: m.name || m.email };
      byUid.set(m.uid, entry);
      byEmail.set(m.email, entry);
    }
    const snap = await db.collection('tokens').get();
    tokenResult.total = snap.size;
    for (const d of snap.docs) {
      const data = d.data();
      if (data.workspaceId && data.workspaceId !== wid) {
        tokenResult.skipped++;
        continue;
      }
      const userId = data.userId as string | undefined;
      const userEmail = (data.userEmail as string | undefined)?.toLowerCase();
      const patch: DocumentData = { workspaceId: wid };
      const creator = userId ? byUid.get(userId) : userEmail ? byEmail.get(userEmail) : owner;
      if (!userId && !userEmail) tokenResult.toOwner++;
      if (creator) {
        patch.userId = creator.uid;
        patch.userEmail = userEmail ?? creator.email;
        patch.userName = (data.userName as string | undefined) ?? creator.name;
      } else {
        // The creator is no longer a member: the old API already rejected this token. Keep it dead.
        patch.revoked = true;
        tokenResult.revoked++;
        warnings.push(`tokens/${d.id} (${data.name}): creator ${userEmail ?? userId} is not a member; marked revoked.`);
      }
      if (Object.entries(patch).every(([k, v]) => deepEqual(data[k], v))) tokenResult.unchanged++;
      else {
        // A token of this workspace created or changed after the last copy belongs to the live app.
        if (since && data.workspaceId === wid) isLive(`tokens/${d.id} (${data.name})`, after(d.updateTime, since));
        tokenResult.updated++;
        sets.push({ ref: d.ref, data: patch, merge: true });
      }
    }
  }

  const result: CopyResult = {
    workspaceId: wid,
    createdWorkspace,
    pruned: prune,
    docs,
    rewrites,
    members: memberResult,
    storage: storageResult,
    tokens: tokenResult,
    warnings,
  };

  // 7. refuse before the first write if the app is live, or if the workspace got locked meanwhile
  if (live.length) {
    throw new Error(
      `workspaces/${wid} has ${live.length} change(s) since the last copy (${since!.toDate().toISOString()}): the app looks live, and copy would overwrite or delete them. Aborting; nothing written.\n` +
        live.slice(0, 20).map((l) => `  ${l}`).join('\n') +
        (live.length > 20 ? `\n  … and ${live.length - 20} more` : ''),
    );
  }
  if (!createdWorkspace) {
    const now = await db.doc(`workspaces/${wid}`).get();
    if (now.get('migration.lockedAt')) throw new Error(LOCKED);
    if (!deepEqual(now.get('migration.copiedAt'), ws.copiedAt)) throw new Error('Another copy finished while this one was planning: re-run.');
  }

  // 8. write, then record the end of the copy
  if (!dryRun) {
    const writer = db.bulkWriter();
    writer.onWriteError((err) => err.failedAttempts < 5);
    const failed: string[] = [];
    const track = (p: Promise<unknown>, path: string) => p.catch((e: Error) => failed.push(`${path}: ${e.message}`));
    for (const s of sets) void track(s.merge ? writer.set(s.ref, s.data, { merge: true }) : writer.set(s.ref, s.data), s.ref.path);
    for (const ref of deletes) void track(writer.delete(ref), ref.path);
    await inChunks(fileCopies, 8, ({ src, dest }) => copyObject(src, bucket.file(dest)));
    await inChunks(fileDeletes, 8, async (name) => {
      await bucket.file(name).delete({ ignoreNotFound: true });
    });
    await writer.close();
    if (failed.length) throw new Error(`${failed.length} write(s) failed; copiedAt not recorded, re-run:\n  ${failed.slice(0, 20).join('\n  ')}`);
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`workspaces/${wid}`);
      const snap = await tx.get(ref);
      if (snap.get('migration.lockedAt')) throw new Error('The workspace was locked while copy ran: its writes landed after the lock. Run verify and check the data.');
      tx.update(ref, { 'migration.copiedAt': FieldValue.serverTimestamp() });
    });
  }

  printCopy(result, dryRun, log);
  return result;
}

type CustomMetadata = { [key: string]: string | number | boolean | null };

function customMetadata(f: StorageFile): CustomMetadata {
  return (f.metadata.metadata as CustomMetadata | undefined) ?? {};
}

function sameObject(a: StorageFile, b: StorageFile): boolean {
  return (
    a.metadata.md5Hash === b.metadata.md5Hash &&
    String(a.metadata.size) === String(b.metadata.size) &&
    a.metadata.contentType === b.metadata.contentType &&
    customMetadata(a).firebaseStorageDownloadTokens === customMetadata(b).firebaseStorageDownloadTokens
  );
}

/** Server-side copy that keeps contentType and custom metadata (the download token stays valid). */
async function copyObject(src: StorageFile, dest: StorageFile): Promise<void> {
  await src.copy(dest);
  const [meta] = await dest.getMetadata();
  const want = customMetadata(src);
  const have = (meta.metadata as Record<string, unknown> | undefined) ?? {};
  if (meta.contentType !== src.metadata.contentType || Object.entries(want).some(([k, v]) => have[k] !== v)) {
    await dest.setMetadata({ contentType: src.metadata.contentType, metadata: want });
  }
}

function printCopy(r: CopyResult, dryRun: boolean, log: (line: string) => void) {
  const verb = dryRun ? 'would write' : 'written';
  log(`${dryRun ? '[dry run] ' : ''}copy → workspaces/${r.workspaceId} (${WORKSPACE_NAME}, /${WORKSPACE_SLUG})${r.createdWorkspace ? `, workspace ${dryRun ? 'would be ' : ''}created` : ''}`);
  const extras = (c: Counts) => (r.pruned ? `${dryRun ? 'would delete' : 'deleted'} ${c.deleted} extras` : `${c.extra} extras kept`);
  log(`  documents (source / ${verb} / unchanged / extras${r.pruned ? ' deleted' : ' kept'}):`);
  for (const [k, c] of Object.entries(r.docs).sort()) log(`    ${k.padEnd(28)} ${c.source} / ${c.written} / ${c.unchanged} / ${r.pruned ? c.deleted : c.extra}`);
  if (Object.keys(r.rewrites).length) {
    log('  rewritten strings (urls / storagePaths / links):');
    for (const [k, s] of Object.entries(r.rewrites).sort()) log(`    ${k.padEnd(28)} ${s.urls} / ${s.paths} / ${s.links}`);
  }
  const m = r.members;
  log(`  members: ${m.members} members + ${m.invites} invites (${verb} ${m.written}, unchanged ${m.unchanged}, ${extras(m)})`);
  const s = r.storage;
  log(`  storage: ${s.source} objects (${dryRun ? 'would copy' : 'copied'} ${s.copied}, unchanged ${s.unchanged}, ${extras(s)})`);
  const t = r.tokens;
  log(`  tokens: ${t.total} (${dryRun ? 'would update' : 'updated'} ${t.updated}, unchanged ${t.unchanged}, other workspace ${t.skipped}, legacy → owner ${t.toOwner}, dead → revoked ${t.revoked})`);
  for (const w of r.warnings) log(`  warning: ${w}`);
  const kept = Object.values(r.docs).reduce((n, c) => n + c.extra, 0) + r.members.extra + r.storage.extra;
  if (!r.pruned && kept) log(`  ${kept} extras kept (not in the old data): verify fails until they are gone; re-run with --prune to delete them.`);
  log(`  total changes: ${copyChanges(r)}`);
}

// ---------------------------------------------------------------- verify

export interface VerifyOptions {
  target: Target;
  lock?: boolean;
  /** Skip the HTTP checks of download URLs. */
  skipUrls?: boolean;
  log?: (line: string) => void;
}

export interface VerifyResult {
  ok: boolean;
  workspaceId: string | null;
  locked: boolean;
  failures: string[];
  warnings: string[];
  info: string[];
  counts: Record<string, { old: number; new: number }>;
}

export async function verify(opts: VerifyOptions): Promise<VerifyResult> {
  const { target: t } = opts;
  const log = opts.log ?? console.log;
  const { db, bucket } = t;
  const failures: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];
  const counts: VerifyResult['counts'] = {};
  const fail = (msg: string) => failures.length < 200 && failures.push(msg);
  const finish = (r: Omit<VerifyResult, 'ok' | 'failures' | 'warnings' | 'info' | 'counts'>): VerifyResult => {
    const result = { ...r, ok: failures.length === 0, failures, warnings, info, counts };
    printVerify(result, log);
    return result;
  };

  let ws: WorkspaceState | null;
  try {
    ws = await findWorkspace(db);
  } catch (e) {
    fail((e as Error).message);
    return finish({ workspaceId: null, locked: false });
  }
  if (!ws) {
    fail(`slugs/${WORKSPACE_SLUG} does not exist: run copy first.`);
    return finish({ workspaceId: null, locked: false });
  }
  const { wid, locked } = ws;
  const wsData = ws.data!;
  if (!locked && !ws.copiedAt) fail('no completed copy recorded (migration.copiedAt): run copy.');
  if (wsData.slug !== WORKSPACE_SLUG || wsData.name !== WORKSPACE_NAME) fail(`workspaces/${wid} has name/slug ${wsData.name}/${wsData.slug}.`);

  // members, invites, owner
  const members = await oldMembers(db);
  let owner: Owner | null = null;
  try {
    owner = await resolveOwner(t, members);
  } catch (e) {
    fail((e as Error).message);
  }
  const newMembers = (await db.collection(`workspaces/${wid}/members`).get()).docs;
  const newInvites = (await db.collection(`workspaces/${wid}/invites`).get()).docs;
  const memberUids = new Set(newMembers.map((d) => d.id));
  {
    const owners = newMembers.filter((d) => d.get('role') === 'owner');
    if (owners.length !== 1) fail(`expected exactly one owner member, found ${owners.length}.`);
    else if (owners[0].id !== wsData.ownerUid) fail(`owner member ${owners[0].id} ≠ workspace ownerUid ${wsData.ownerUid}.`);
    if (owner && wsData.ownerUid !== owner.uid) fail(`workspace ownerUid ${wsData.ownerUid} ≠ OWNER_EMAIL's uid ${owner.uid}.`);
    for (const d of newMembers) if (d.get('uid') !== d.id) fail(`workspaces/${wid}/members/${d.id} has uid ${d.get('uid')}.`);
    const oldEmails = new Set(members.map((m) => m.email));
    if (owner) oldEmails.add(owner.email);
    const newEmails = new Set([...newMembers.map((d) => String(d.get('email'))), ...newInvites.map((d) => d.id)]);
    counts['members+invites'] = { old: oldEmails.size, new: newMembers.length + newInvites.length };
    for (const e of oldEmails) {
      if (newEmails.has(e)) continue;
      if (locked) info.push(`member ${e} is gone from the workspace (removed or left after the lock).`);
      else fail(`old member ${e} is neither a member nor an invite.`);
    }
    if (!locked) for (const e of newEmails) if (!oldEmails.has(e)) fail(`${e} is in the workspace but was not an old member.`);
  }

  // tokens
  {
    const snap = await db.collection('tokens').get();
    for (const d of snap.docs) {
      const wsId = d.get('workspaceId') as string | undefined;
      if (!wsId) {
        fail(`tokens/${d.id} has no workspaceId.`);
        continue;
      }
      if (wsId !== wid) continue;
      const userId = d.get('userId') as string | undefined;
      if (d.get('revoked') === true) continue;
      if (!userId) fail(`tokens/${d.id} has no userId.`);
      else if (!memberUids.has(userId)) warnings.push(`tokens/${d.id} (${d.get('name')}): creator ${userId} is not a member; the token is dead.`);
    }
  }

  // documents
  const olds = await oldTree(db);
  const news = await newTree(db, wid);
  for (const rel of olds.keys()) (counts[collectionKey(rel)] ??= { old: 0, new: 0 }).old++;
  for (const rel of news.keys()) (counts[collectionKey(rel)] ??= { old: 0, new: 0 }).new++;
  {
    let missing = 0;
    let changed = 0;
    let extra = 0;
    for (const [rel, data] of olds) {
      const twin = news.get(rel);
      if (!twin) {
        missing++;
        if (!locked) fail(`workspaces/${wid}/${rel} is missing.`);
      } else if (!deepEqual(rewriteData(data, wid, bucket.name), twin)) {
        changed++;
        if (!locked) fail(`workspaces/${wid}/${rel} differs from the rewritten original.`);
      }
    }
    for (const rel of news.keys()) {
      if (olds.has(rel)) continue;
      extra++;
      if (!locked) fail(`workspaces/${wid}/${rel} has no original.`);
    }
    if (locked && (missing || changed || extra)) info.push(`since the lock: ${changed} docs edited, ${missing} deleted, ${extra} new (expected while live).`);
  }
  // leftovers in the new data (checked even when locked: new edits must not reintroduce them either)
  const urls = new Set<string>();
  for (const [rel, data] of news) {
    for (const s of strings(data)) {
      for (const problem of leftovers(s)) fail(`workspaces/${wid}/${rel}: ${problem} in ${JSON.stringify(s.slice(0, 120))}.`);
      for (const m of s.matchAll(storageUrlWithQueryRe())) urls.add(m[0]);
    }
    if (/^pages\/[^/]+\/attachments\/[^/]+$/.test(rel) && typeof data.url === 'string') urls.add(data.url);
  }

  // storage objects
  {
    const sources: StorageFile[] = [];
    for (const area of STORAGE_AREAS) sources.push(...(await bucket.getFiles({ prefix: area.from }))[0]);
    const dests = new Map<string, StorageFile>();
    for (const area of STORAGE_AREAS) {
      for (const f of (await bucket.getFiles({ prefix: `${workspaceStoragePrefix(wid)}${area.to}` }))[0]) dests.set(f.name, f);
    }
    counts['storage objects'] = { old: sources.length, new: dests.size };
    let gone = 0;
    for (const src of sources) {
      const dest = dests.get(mapStoragePath(src.name, wid)!);
      if (!dest) {
        if (locked) gone++;
        else fail(`storage ${src.name} was not copied.`);
      } else if (!sameObject(src, dest)) fail(`storage ${dest.name} differs from ${src.name} (size, md5, contentType or download token).`);
    }
    if (gone) info.push(`since the lock: ${gone} copied objects deleted (expected while live).`);
  }

  // download URLs answer
  if (!opts.skipUrls) {
    const list = [...urls];
    await inChunks(list, 8, async (url) => {
      try {
        const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
        await res.arrayBuffer();
        if (res.status !== 200 && res.status !== 206) {
          if (locked) warnings.push(`${url} → ${res.status}`);
          else fail(`${url} → ${res.status}`);
        }
      } catch (e) {
        fail(`${url} → ${(e as Error).message}`);
      }
    });
    counts['download URLs checked'] = { old: list.length, new: list.length };
  }

  const result = finish({ workspaceId: wid, locked });
  if (opts.lock) {
    if (!result.ok) log('not locking: verify failed.');
    else if (locked) log('already locked.');
    else {
      await db.runTransaction(async (tx) => {
        const ref = db.doc(`workspaces/${wid}`);
        const snap = await tx.get(ref);
        if (!deepEqual(snap.get('migration.copiedAt'), ws.copiedAt)) throw new Error('A copy finished while verify ran: not locking; run verify --lock again.');
        tx.update(ref, { 'migration.lockedAt': FieldValue.serverTimestamp() });
      });
      result.locked = true;
      log(`locked workspaces/${wid}: copy now refuses to run. Deploy the app next.`);
    }
  }
  return result;
}

function printVerify(r: VerifyResult, log: (line: string) => void) {
  log(`verify workspaces/${r.workspaceId ?? '?'}${r.locked ? ' (locked: structural checks only)' : ''}`);
  for (const [k, c] of Object.entries(r.counts).sort()) log(`  ${k.padEnd(28)} old ${c.old}  new ${c.new}`);
  for (const i of r.info) log(`  info: ${i}`);
  for (const w of r.warnings) log(`  warning: ${w}`);
  for (const f of r.failures) log(`  FAIL: ${f}`);
  log(r.ok ? '  verify passed' : `  verify FAILED (${r.failures.length} problems${r.failures.length >= 200 ? ', first 200 shown' : ''})`);
}

// ---------------------------------------------------------------- cleanup

export interface CleanupOptions {
  target: Target;
  confirm?: string;
  /** Asks for the slug again; defaults to one line from stdin. */
  ask?: (question: string) => Promise<string>;
  log?: (line: string) => void;
}

export interface CleanupResult {
  deleted: Record<string, number>;
}

async function askStdin(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  process.stdout.write(question);
  try {
    for await (const line of rl) return line.trim();
    return '';
  } finally {
    rl.close();
  }
}

export async function cleanup(opts: CleanupOptions): Promise<CleanupResult> {
  const { target: t } = opts;
  const log = opts.log ?? console.log;
  const { db, bucket } = t;
  if (opts.confirm !== WORKSPACE_SLUG) throw new Error(`cleanup deletes the old data: pass --confirm ${WORKSPACE_SLUG}.`);
  const v = await verify({ target: t, log });
  if (!v.ok) throw new Error('verify failed: not cleaning up.');

  const deleted: Record<string, number> = {};
  for (const c of [...CONTENT_COLLECTIONS, 'members']) deleted[c] = (await db.collection(c).count().get()).data().count;
  for (const area of STORAGE_AREAS) deleted[`storage ${area.from}`] = (await bucket.getFiles({ prefix: area.from }))[0].length;
  log('cleanup will permanently delete:');
  for (const [k, n] of Object.entries(deleted)) log(`  ${k.padEnd(28)} ${n}${k.startsWith('storage') ? ' objects' : ' top-level docs (and their subcollections)'}`);
  log(`  the migration marker on workspaces/${v.workspaceId}`);
  const answer = await (opts.ask ?? askStdin)(`Type the workspace slug (${WORKSPACE_SLUG}) to delete: `);
  if (answer !== WORKSPACE_SLUG) throw new Error('Confirmation did not match: nothing deleted.');

  for (const c of [...CONTENT_COLLECTIONS, 'members']) await db.recursiveDelete(db.collection(c));
  for (const area of STORAGE_AREAS) await bucket.deleteFiles({ prefix: area.from });
  await db.doc(`workspaces/${v.workspaceId}`).update({ migration: FieldValue.delete() });
  log('cleanup done; tokens/ stays top level.');
  return { deleted };
}

// ---------------------------------------------------------------- CLI

const USAGE = `usage: migrate-workspaces.ts <copy|verify|cleanup> [--project <id>] [--dry-run] [--prune] [--lock] [--confirm ${WORKSPACE_SLUG}]
  copy               copy old data into workspace "${WORKSPACE_NAME}" (idempotent; --dry-run writes nothing;
                     --prune also deletes workspace data with no original); refuses if locked or live
  verify             check the copy (read-only); --lock marks it final (copy then refuses)
  cleanup            delete the old data (needs --confirm ${WORKSPACE_SLUG} and the slug again on stdin)
  --project <id>     required unless the emulator env vars are set; must match FIREBASE_SERVICE_ACCOUNT
env: OWNER_EMAIL (former owner), FIREBASE_SERVICE_ACCOUNT, VITE_FIREBASE_STORAGE_BUCKET`;

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const flags: { project?: string; dryRun?: boolean; prune?: boolean; lock?: boolean; confirm?: string } = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const value = () => {
      const v = rest[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--prune') flags.prune = true;
    else if (a === '--lock') flags.lock = true;
    else if (a === '--project') flags.project = value();
    else if (a.startsWith('--project=')) flags.project = a.slice('--project='.length);
    else if (a === '--confirm') flags.confirm = value();
    else if (a.startsWith('--confirm=')) flags.confirm = a.slice('--confirm='.length);
    else throw new Error(`unknown argument ${a}\n${USAGE}`);
  }
  if (!cmd || !['copy', 'verify', 'cleanup'].includes(cmd)) {
    console.error(USAGE);
    return 2;
  }
  if (flags.dryRun && cmd !== 'copy') throw new Error('--dry-run applies to copy only (verify is read-only).');
  if (flags.prune && cmd !== 'copy') throw new Error('--prune applies to copy only.');
  if (flags.lock && cmd !== 'verify') throw new Error('--lock applies to verify only.');
  const target = connect(flags.project);
  console.log(`target: ${target.emulator ? `emulators (project ${target.projectId})` : `PROJECT ${target.projectId}`}, bucket ${target.bucket.name}`);
  try {
    if (cmd === 'copy') await copy({ target, dryRun: flags.dryRun, prune: flags.prune });
    else if (cmd === 'verify') return (await verify({ target, lock: flags.lock })).ok ? 0 : 1;
    else await cleanup({ target, confirm: flags.confirm });
    return 0;
  } finally {
    await target.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
