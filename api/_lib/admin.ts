import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

/**
 * firebase-admin singletons, initialized lazily from FIREBASE_SERVICE_ACCOUNT (the
 * service account key JSON). Warm function instances reuse them.
 */

let firestoreInstance: Firestore | undefined;

function app(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  const account = JSON.parse(raw) as { project_id: string; client_email: string; private_key: string };
  return initializeApp({
    credential: cert({ projectId: account.project_id, clientEmail: account.client_email, privateKey: account.private_key }),
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || `${account.project_id}.firebasestorage.app`,
  });
}

/**
 * Firestore over REST (faster cold starts than gRPC) with `ignoreUndefinedProperties`,
 * so optional fields can be passed through.
 */
export function firestore(): Firestore {
  if (!firestoreInstance) {
    firestoreInstance = getFirestore(app());
    // The emulator only grants admin access over gRPC (REST requests are checked against the rules).
    firestoreInstance.settings({ preferRest: !process.env.FIRESTORE_EMULATOR_HOST, ignoreUndefinedProperties: true });
  }
  return firestoreInstance;
}

export function adminAuth(): Auth {
  return getAuth(app());
}

/** The default Storage bucket (attachments live under `attachments/{cardId}/{attachmentId}/{name}`). */
export function bucket() {
  return getStorage(app()).bucket();
}
