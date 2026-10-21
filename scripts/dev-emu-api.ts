/**
 * The REST API on http://127.0.0.1:3100/api/v1 against the Firebase emulators, for
 * `npm run dev:emu` (Vite proxies `/api` here when VITE_USE_EMULATORS=1). Run inside
 * `firebase emulators:exec`, which sets the *_EMULATOR_HOST variables. A throwaway service
 * account stands in for FIREBASE_SERVICE_ACCOUNT: the emulators ignore credentials, but
 * signed URLs need a key to sign with. RESEND_API_KEY stays unset, so invites are created
 * but not emailed.
 */
import { generateKeyPairSync } from 'node:crypto';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST is not set: run via `npm run dev:emu`.');
  process.exit(1);
}
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-fira';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: PROJECT_ID,
  client_email: `dev@${PROJECT_ID}.iam.gserviceaccount.com`,
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
});
// Same bucket as the SPA's emulator config (src/lib/firebase.ts).
process.env.VITE_FIREBASE_STORAGE_BUCKET = `${PROJECT_ID}.appspot.com`;
process.env.APP_URL ??= 'http://localhost:5173';

const { startServer } = await import('./api-dev-server.js');
const { url } = await startServer(Number(process.env.PORT ?? 3100));
console.log(`fira API (emulators) listening on ${url}`);
