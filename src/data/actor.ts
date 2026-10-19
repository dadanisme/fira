import type { Actor } from '@shared/types';
import { auth } from '../lib/firebase';

/** The signed-in user as an Actor. Mutations call this; it throws when signed out. */
export function currentActor(): Actor {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  return { type: 'user', id: user.uid, name: user.displayName ?? user.email ?? 'Owner' };
}
