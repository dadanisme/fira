import { FieldValue as Fv, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { firestore } from '../_lib/admin.js';
import { noContent } from '../_lib/http.js';
import { route } from '../_lib/router.js';

export const accountRoutes = [
  /** Refreshes `name`, `photoURL` and `lastSignInAt` on all of the caller's member docs (the SPA calls it once per session). */
  route('POST', '/account/sync', 'user', async ({ user }) => {
    const memberships = await firestore().collectionGroup('members').where('uid', '==', user.uid).get();
    const signedInAt = Timestamp.fromDate(user.authTime);
    const batch = firestore().batch();
    let writes = 0;
    for (const doc of memberships.docs) {
      const patch: DocumentData = {};
      if (doc.get('name') !== user.name) patch.name = user.name;
      const photo = doc.get('photoURL') as string | undefined;
      if (photo !== user.photoURL) patch.photoURL = user.photoURL ?? Fv.delete();
      const last = doc.get('lastSignInAt') as Timestamp | undefined;
      if (!last || last.toMillis() !== signedInAt.toMillis()) patch.lastSignInAt = signedInAt;
      if (Object.keys(patch).length) {
        batch.update(doc.ref, patch);
        writes++;
      }
    }
    if (writes) await batch.commit();
    return noContent();
  }),
];
