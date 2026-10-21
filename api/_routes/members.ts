import { INVITE_ROLES, type WorkspaceRole } from '../../shared/types.js';
import { canManageMember, isAdminRole } from '../../shared/workspaces.js';
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

  /**
   * Removes a member (admin), or leaves (own uid; anyone but the owner). Their tokens here are
   * revoked. One transaction re-reads the target, the caller and the workspace, so a concurrent
   * transfer or role change can't leave the workspace without its owner.
   */
  route('DELETE', '/workspaces/:wid/members/:uid', 'member', async ({ params, member, workspaceId: wid }) => {
    const self = params.uid === member.uid;
    if (!self) requireRole(member, 'admin');
    const ref = col.members(wid).doc(params.uid);
    const actorRef = col.members(wid).doc(member.uid);
    const wsRef = col.workspaces().doc(wid);

    await firestore().runTransaction(async (tx) => {
      const [target, actor, ws] = await tx.getAll(ref, actorRef, wsRef);
      if (!target.exists) throw notFound('Member not found');
      const targetRole = target.get('role') as WorkspaceRole;
      const targetIsOwner = targetRole === 'owner' || ws.get('ownerUid') === params.uid;
      if (self) {
        if (targetIsOwner) throw forbidden('The owner cannot leave: transfer ownership first');
      } else {
        if (!actor.exists) throw notFound('Workspace not found');
        const actorRole = actor.get('role') as WorkspaceRole;
        if (!isAdminRole(actorRole)) throw forbidden('Only workspace admins can do this');
        if (targetIsOwner || !canManageMember(actorRole, targetRole)) throw forbidden('The owner cannot be removed');
      }
      await revokeMemberTokens(tx, wid, params.uid);
      tx.delete(ref);
    });
    return noContent();
  }),
];
