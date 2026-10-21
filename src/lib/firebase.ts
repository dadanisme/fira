import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

const env = import.meta.env;

/**
 * `VITE_USE_EMULATORS=1` (see `npm run dev:emu`): talk to the local Auth, Firestore and Storage
 * emulators of the `demo-fira` project (ports from firebase.json) instead of production. The
 * demo project id and API key also give the emulator session its own IndexedDB cache and
 * signed-in user, so it never mixes with a production session in the same browser.
 */
export const USE_EMULATORS = env.VITE_USE_EMULATORS === '1' || env.VITE_USE_EMULATORS === 'true';
const EMULATOR_HOST = '127.0.0.1';
const EMULATOR_PROJECT = 'demo-fira';

export const app = initializeApp(
  USE_EMULATORS
    ? {
        apiKey: 'demo-fira-key',
        authDomain: `${EMULATOR_PROJECT}.firebaseapp.com`,
        projectId: EMULATOR_PROJECT,
        storageBucket: `${EMULATOR_PROJECT}.appspot.com`,
        appId: 'demo-fira-app',
      }
    : {
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
        appId: env.VITE_FIREBASE_APP_ID,
      },
);

/**
 * Persistent, multi-tab cache: reads resolve from IndexedDB instantly, writes are optimistic.
 * `undefined` properties are dropped on write, so optional fields can be passed through.
 */
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const auth = getAuth(app);
export const storage = getStorage(app);

if (USE_EMULATORS) {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, EMULATOR_HOST, 8080);
  connectStorageEmulator(storage, EMULATOR_HOST, 9199);
}
