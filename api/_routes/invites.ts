import { FieldValue as Fv, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import type { AcceptResult, InviteResult } from '../../shared/api.js';
import { INVITE_ROLES } from '../../shared/types.js';
import { LIMITS } from '../../shared/workspaces.js';
import { firestore } from '../_lib/admin.js';
import { memberOf, requireRole } from '../_lib/auth.js';
import { sendInviteEmail } from '../_lib/email.js';
import { badRequest, coded, created, jsonBody, noContent, notFound, tooManyRequests, unprocessable } from '../_lib/http.js';
import { route } from '../_lib/router.js';
import { col } from '../_lib/store.js';
import { onlyKeys, optEnum, optString } from '../_lib/validate.js';
import { countSeats, inviteJson, memberJson, normalizeEmail, workspaceJson } from '../_lib/workspaces.js';

/** The `:email` path segment, lowercased (invites are keyed by the exact lowercased email). */
const pathEmail = (raw: string) => raw.trim().toLowerCase();

/**
 * Sends the invite email and records the outcome on the invite (`emailStatus`, `emailError`).
 * A failed send keeps the invite; the UI shows a warning and offers Resend.
 */
async function deliver(ref: DocumentReference): Promise<InviteResult> {
  const invite = inviteJson(await ref.get());
  const sent = await sendInviteEmail({
    to: invite.email,
    workspaceName: invite.workspaceName,
    inviterName: invite.invitedBy.name,
    role: invite.role,
  });
  try {
    await ref.update(sent.ok ? { emailStatus: 'sent', emailError: Fv.delete() } : { emailStatus: 'failed', emailError: sent.error });
  } catch {
    // Revoked or accepted while the email was being sent: report the send as it went.
    return { invite, emailSent: sent.ok, ...(!sent.ok && { emailError: sent.error }) };
  }
  return { invite: inviteJson(await ref.get()), emailSent: sent.ok, ...(!sent.ok && { emailError: sent.error }) };
}

export const inviteRoutes = [
  route('POST', '/workspaces/:wid/invites', 'member', async ({ req, member, workspaceId: wid }) => {
    requireRole(member, 'admin');
    const body = jsonBody(req);
    onlyKeys(body, ['email', 'role']);
    const raw = optString(body, 'email');
    if (raw === undefined) throw badRequest('email is required');
    const email = normalizeEmail(raw);
    if (!email) throw unprocessable('email must be an email address');
    const role = optEnum(body, 'role', INVITE_ROLES) ?? 'member';
    const wsRef = col.workspaces().doc(wid);
    const ref = col.invites(wid).doc(email);

    await firestore().runTransaction(async (tx) => {
      const [ws, existing, members] = await Promise.all([
        tx.get(wsRef),
        tx.get(ref),
        tx.get(col.members(wid).where('email', '==', email).limit(1)),
      ]);
      if (!ws.exists) throw notFound('Workspace not found');
      if (!members.empty) throw coded(409, 'already_member', `${email} is already a member`);
      if (existing.exists) throw coded(409, 'already_invited', `${email} is already invited`);
      if ((await countSeats(tx, wid)) >= LIMITS.seats) {
        throw coded(422, 'seat_limit', `A workspace has at most ${LIMITS.seats} seats (members + pending invites)`);
      }
      tx.create(ref, {
        email,
        role,
        invitedBy: { uid: member.uid, name: member.name, email: member.email },
        createdAt: Fv.serverTimestamp(),
        lastSentAt: Timestamp.now(),
        emailStatus: 'pending',
        workspaceId: wid,
        workspaceName: ws.get('name') as string,
      });
    });
    return created(await deliver(ref));
  }),

  route('POST', '/workspaces/:wid/invites/:email/resend', 'member', async ({ params, member, workspaceId: wid }) => {
    requireRole(member, 'admin');
    const ref = col.invites(wid).doc(pathEmail(params.email));
    await firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw notFound('Invite not found');
      const last = snap.get('lastSentAt') as Timestamp | undefined;
      if (last && Date.now() - last.toMillis() < LIMITS.resendCooldownMs) {
        throw tooManyRequests('This invite was just sent; try again in a minute');
      }
      tx.update(ref, { lastSentAt: Timestamp.now(), emailStatus: 'pending', emailError: Fv.delete() });
    });
    return deliver(ref);
  }),

  /** The invitee declines, or an admin revokes. */
  route('DELETE', '/workspaces/:wid/invites/:email', 'user', async ({ params, user }) => {
    const email = pathEmail(params.email);
    if (email !== user.email) requireRole(await memberOf(user, params.wid), 'admin');
    const ref = col.invites(params.wid).doc(email);
    if (!(await ref.get()).exists) throw notFound('Invite not found');
    await ref.delete();
    return noContent();
  }),

  route('POST', '/workspaces/:wid/invites/:email/accept', 'user', async ({ params, user }): Promise<AcceptResult> => {
    const email = pathEmail(params.email);
    // Someone else's invite is reported as missing.
    if (email !== user.email) throw notFound('Invite not found');
    const wid = params.wid;
    const wsRef = col.workspaces().doc(wid);
    const inviteRef = col.invites(wid).doc(email);
    const memberRef = col.members(wid).doc(user.uid);

    await firestore().runTransaction(async (tx) => {
      const [invite, ws, existing] = await Promise.all([tx.get(inviteRef), tx.get(wsRef), tx.get(memberRef)]);
      if (!invite.exists || !ws.exists) throw notFound('Invite not found');
      if (!existing.exists) {
        tx.create(memberRef, {
          uid: user.uid,
          email: user.email,
          name: user.name,
          photoURL: user.photoURL,
          role: invite.get('role') as string,
          joinedAt: Fv.serverTimestamp(),
          invitedBy: invite.get('invitedBy.uid') as string,
          lastSignInAt: Timestamp.fromDate(user.authTime),
          workspaceName: ws.get('name') as string,
          workspaceSlug: ws.get('slug') as string,
        });
      }
      tx.delete(inviteRef);
    });
    const [ws, member] = await Promise.all([wsRef.get(), memberRef.get()]);
    return { workspace: workspaceJson(ws), member: memberJson(member) };
  }),
];
