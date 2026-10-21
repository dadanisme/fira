/**
 * fira data model, shared by the SPA (src/) and the REST API (api/).
 *
 * Timestamps: every timestamp is an ISO 8601 string (`Timestamp` below).
 * Firestore stores real `Timestamp`s; the SPA converters (src/data/db.ts) and the
 * API serializer (api/_lib/serialize.ts) both convert them to ISO strings, so the
 * SPA and API JSON share exactly these shapes. ISO strings sort lexicographically
 * in time order and survive JSON. Calendar dates (`dueDate`) are plain `YYYY-MM-DD`.
 *
 * Every document type carries its Firestore document `id`.
 */

/** ISO 8601 timestamp, e.g. `2026-10-19T08:30:00.000Z`. */
export type Timestamp = string;
/** Calendar date, `YYYY-MM-DD`. */
export type DateString = string;

export interface Actor {
  type: 'user' | 'token';
  /** Firebase uid for users, token document id for tokens. */
  id: string;
  name: string;
  /** Tokens only: the member who created the token (uid + display name). Always set for tokens; optional in the type. */
  via?: { id: string; name: string };
}

// ---------------------------------------------------------------- projects

export interface Column {
  id: string;
  name: string;
}

export const FIELD_TYPES = ['text', 'number', 'select', 'multiselect', 'date', 'checkbox', 'url'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldDef {
  id: string;
  /** camelCase, unique per project; the key in `Card.fields`. */
  key: string;
  name: string;
  type: FieldType;
  /** For `select` / `multiselect`. */
  options?: string[];
}

/** text/url/select: string, number: number, checkbox: boolean, multiselect: string[], date: DateString. */
export type FieldValue = string | number | boolean | string[];

export interface Project {
  id: string;
  /** Uppercase, unique, immutable (e.g. `NI`). See PROJECT_KEY_RE. */
  key: string;
  name: string;
  /** Ordered; the last column is the "done" column. */
  columns: Column[];
  fields: FieldDef[];
  nextNumber: number;
  pageTemplateId?: string;
  pageParentId?: string;
  rank: string;
  createdAt: Timestamp;
}

export const DEFAULT_COLUMN_NAMES = ['To Do', 'In Progress', 'Done'] as const;

// ---------------------------------------------------------------- labels

/** Fixed palette for label (and token) colors. CSS vars: `--label-<color>-bg/-fg`. */
export const LABEL_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export interface Label {
  id: string;
  /** Unique case-insensitively. Cards reference labels by name. */
  name: string;
  color: LabelColor;
}

// ---------------------------------------------------------------- cards

export const CARD_TYPES = ['epic', 'card', 'subtask'] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** Ordered lowest → highest. */
export const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Card {
  id: string;
  projectId: string;
  /** `NI-12`. */
  key: string;
  number: number;
  type: CardType;
  /** Epic id for a card, card id for a subtask. */
  parentId?: string;
  title: string;
  /** Markdown. */
  description: string;
  /** Starts at 1, +1 per description change. */
  descriptionVersion: number;
  /** Column id. */
  status: string;
  rank: string;
  priority: Priority;
  /** Label names. */
  labels: string[];
  dueDate?: DateString;
  fields: Record<string, FieldValue>;
  pageId?: string;
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: Actor;
  updatedBy: Actor;
}

export interface Comment {
  id: string;
  /** Markdown. */
  body: string;
  author: Actor;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export const ACTIVITY_KINDS = [
  'created',
  'status',
  'title',
  'description',
  'priority',
  'labels',
  'dueDate',
  'field',
  'parent',
  'archived',
  'comment',
  'attachment',
  'page',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** JSON-safe value recorded in activity entries. */
export type ActivityValue = string | number | boolean | string[] | null;

export interface Activity {
  id: string;
  at: Timestamp;
  actor: Actor;
  kind: ActivityKind;
  /** Field key for kind `field`. */
  field?: string;
  /** Status from/to are column names; parent from/to are card keys. */
  from?: ActivityValue;
  to?: ActivityValue;
}

/** An activity entry before it is stamped with `id`, `at` and `actor`. */
export type ActivityDraft = Omit<Activity, 'id' | 'at' | 'actor'>;

export interface Attachment {
  id: string;
  name: string;
  size: number;
  contentType: string;
  /** `workspaces/{workspaceId}/cards/{cardId}/{attachmentId}/{name}` (see `cardAttachmentPath`). */
  storagePath: string;
  uploadedBy: Actor;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------- pages

export interface Page {
  id: string;
  title: string;
  /** Emoji. */
  icon?: string;
  parentId: string | null;
  rank: string;
  /** Markdown. */
  content: string;
  /** Starts at 1, +1 per content/title save. */
  version: number;
  isTemplate: boolean;
  cardId?: string;
  trashed: boolean;
  trashedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  updatedBy: Actor;
}

export interface PageVersion {
  id: string;
  version: number;
  title: string;
  content: string;
  savedAt: Timestamp;
  actor: Actor;
}

export interface ThreadMessage {
  id: string;
  /** Markdown. */
  body: string;
  author: Actor;
  createdAt: Timestamp;
}

/** Inline comment thread, anchored by searching quote + context in the page Markdown. */
export interface Thread {
  id: string;
  quote: string;
  /** ≤ 32 chars of text before / after the quote. */
  prefix: string;
  suffix: string;
  resolved: boolean;
  resolvedAt?: Timestamp;
  messages: ThreadMessage[];
  createdAt: Timestamp;
}

/**
 * A file stored with a page (`workspaces/{wid}/pages/{pageId}/attachments/{id}`): API uploads and images
 * pasted in the editor. `url` is a non-expiring Firebase download-token URL, usable as
 * `![alt](url)` in the page Markdown. Re-uploading a name creates a new attachment.
 */
export interface PageAttachment {
  id: string;
  name: string;
  size: number;
  contentType: string;
  /** `workspaces/{workspaceId}/pages/{pageId}/{attachmentId}/{name}` (see `pageAttachmentPath`). */
  storagePath: string;
  url: string;
  uploadedBy: Actor;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------- tokens

/**
 * API token as exposed to clients (the `hash` never leaves the server). `tokens/{id}` is
 * top level (looked up by hash); `workspaceId` scopes it to one workspace, and it works only
 * while `workspaces/{workspaceId}/members/{userId}` exists.
 */
export interface ApiToken {
  id: string;
  workspaceId: string;
  name: string;
  color: LabelColor;
  /** First 8 chars of the secret, for display. */
  prefix: string;
  createdAt: Timestamp;
  lastUsedAt?: Timestamp;
  revoked: boolean;
  /** Creator uid. */
  userId: string;
  /** Creator email, lowercased. */
  userEmail: string;
  /** Creator display name. */
  userName: string;
}

// ---------------------------------------------------------------- workspaces

export const WORKSPACE_ROLES = ['owner', 'admin', 'member'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
/** Roles an invite (or a role change) can grant: ownership moves only by transfer. */
export type InviteRole = Exclude<WorkspaceRole, 'owner'>;
export const INVITE_ROLES: readonly InviteRole[] = ['admin', 'member'];

/** `workspaces/{id}`. Written only by the API. `id` is random and immutable; name and slug are renameable. */
export interface Workspace {
  id: string;
  /** 1–60 chars. */
  name: string;
  /** Unique; see `WORKSPACE_SLUG_RE` / `isWorkspaceSlug` (shared/workspaces.ts). */
  slug: string;
  ownerUid: string;
  createdAt: Timestamp;
  /** uid */
  createdBy: string;
}

/** `workspaces/{wid}/members/{uid}`; `id` = uid. Written only by the API. */
export interface Member {
  id: string;
  uid: string;
  /** Lowercased. */
  email: string;
  name: string;
  photoURL?: string;
  role: WorkspaceRole;
  joinedAt: Timestamp;
  /** uid of the inviter; absent for the creator / migrated owner. */
  invitedBy?: string;
  lastSignInAt?: Timestamp;
  /** Denormalized from the workspace (rewritten on rename). */
  workspaceName: string;
  workspaceSlug: string;
}

/** A member doc found by the "my workspaces" collection-group query: adds the parent workspace id (from the path). */
export type Membership = Member & { workspaceId: string };

/** `pending` while the invite email is being sent. */
export type InviteEmailStatus = 'pending' | 'sent' | 'failed';

/** `workspaces/{wid}/invites/{email}`; `id` = lowercased email. Written only by the API. */
export interface Invite {
  id: string;
  /** Lowercased; equals `id`. */
  email: string;
  role: InviteRole;
  invitedBy: { uid: string; name: string; email: string };
  createdAt: Timestamp;
  lastSentAt?: Timestamp;
  emailStatus: InviteEmailStatus;
  emailError?: string;
  workspaceId: string;
  /** Denormalized: the invitee can read the invite but not the workspace. */
  workspaceName: string;
}
