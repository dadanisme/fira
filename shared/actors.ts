import type { Actor } from './types.js';

/** Display name of an actor: `CI bot (via Alice)` for a token created by a member, else just the name. */
export function actorName(actor: Actor): string {
  return actor.via ? `${actor.name} (via ${actor.via.name})` : actor.name;
}

/** Normalizes an email for comparisons and as a `workspaces/{wid}/invites/{id}` document id. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}
