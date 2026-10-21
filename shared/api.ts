/** Request/response bodies of the workspace, member, invite and token endpoints, shared by the SPA client and the API. */
import type { Actor, ApiToken, Invite, InviteRole, LabelColor, Member, Workspace } from './types.js';

export interface CreateWorkspaceBody {
  name: string;
  slug: string;
}

export interface UpdateWorkspaceBody {
  name?: string;
  slug?: string;
}

export interface DeleteWorkspaceBody {
  /** Must equal the workspace's current slug. */
  confirm: string;
}

export interface TransferBody {
  /** uid of the member who becomes owner. */
  uid: string;
}

export interface SetRoleBody {
  role: InviteRole;
}

export interface CreateInviteBody {
  email: string;
  /** Default `member`. */
  role?: InviteRole;
}

export interface InviteResult {
  invite: Invite;
  emailSent: boolean;
  emailError?: string;
}

export interface AcceptResult {
  workspace: Workspace;
  member: Member;
}

export interface CreateTokenBody {
  name: string;
  color?: LabelColor;
}

export interface CreateTokenResult {
  token: ApiToken;
  /** `fira_...`, shown once. */
  secret: string;
}

/** `GET /me`: the calling actor plus the token's workspace. */
export interface MeResult extends Actor {
  workspace: { id: string; name: string; slug: string };
}

/** Paginated list response (`limit` + opaque `cursor`). */
export interface Page_<T> {
  items: T[];
  nextCursor: string | null;
}

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'version_conflict'
  | 'unprocessable'
  | 'slug_taken'
  | 'already_member'
  | 'already_invited'
  | 'workspace_limit'
  | 'seat_limit'
  | 'too_many_requests';
