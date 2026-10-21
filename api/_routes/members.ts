import { INVITE_ROLES, type WorkspaceRole } from '../../shared/types.js';
import { canManageMember } from '../../shared/workspaces.js';
import { firestore } from '../_lib/admin.js';
import { requireRole } from '../_lib/auth.js';
import { badRequest, forbidden, jsonBody, noContent, notFound } from '../_lib/http.js';
import { route } from '../_lib/router.js';
import { col } from '../_lib/store.js';
import { onlyKeys, optEnum } from '../_lib/validate.js';
import { memberJson, revokeMemberTokens } from '../_lib/workspaces.js';

/** Roles and removal. Admins (and the owner) manage everyone below the owner, other admins included. */
export const memberRoutes = [
  route('PATCH', '/workspaces/:wid/members/:uid', 'member', async ({ req, params, member, workspaceId: wid }) => {
    requireRole(member, 'admin');
    const body = jsonBody(req);
    onlyKeys(body, ['role']);
    const role = optEnum(body, 'role', INVITE_ROLES);
    if (role === undefined) throw badRequest(`role (${INVITE_ROLES.join(' or ')}) is required`);
    const ref = col.members(wid).doc(params.uid);

    await firestore().runTransaction(async (tx) => {
      const target = await tx.get(ref);
      if (!target.exists) throw notFound('Member not found');
      const current = target.get('role') as WorkspaceRole;
      if (!canManageMember(member.role, current)) throw forbidden("The owner's role changes only by transferring ownership");
      if (current !== role) tx.update(ref, { role });
    });
    return memberJson(await ref.get());
  }),

  /** Removes a member (admin), or leaves (own uid; anyone but the owner). Their tokens here are revoked. */
  route('DELETE', '/workspaces/:wid/members/:uid', 'member', async ({ params, member, workspaceId: wid }) => {
    const self = params.uid === member.uid;
    if (self) {
      if (member.role === 'owner') throw forbidden('The owner cannot leave: transfer ownership first');
    } else {
      requireRole(member, 'admin');
    }
    const ref = col.members(wid).doc(params.uid);
    const target = await ref.get();
    if (!target.exists) throw notFound('Member not found');
    if (!self && !canManageMember(member.role, target.get('role') as WorkspaceRole)) {
      throw forbidden('The owner cannot be removed');
    }
    const batch = firestore().batch();
    batch.delete(ref);
    await revokeMemberTokens(batch, wid, params.uid);
    await batch.commit();
    return noContent();
  }),
];
