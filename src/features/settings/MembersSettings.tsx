import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { AlertTriangle, ChevronDown, Mail, Send, UserPlus, X } from 'lucide-react';
import type { Invite, InviteRole, Member, WorkspaceRole } from '@shared/types';
import { INVITE_ROLES } from '@shared/types';
import { isValidEmail, normalizeEmail } from '@shared/actors';
import { canManageMember, LIMITS } from '@shared/workspaces';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { confirmAction } from '../../components/ConfirmDialog';
import { Input } from '../../components/Input';
import { Menu, MenuItem, MenuSeparator } from '../../components/Menu';
import { Popover } from '../../components/Popover';
import { Select } from '../../components/Select';
import { ApiError } from '../../data/api';
import { useInvites, useMembers } from '../../data/members';
import { useIsAdmin, useWorkspace } from '../../data/workspace';
import { inviteMember, removeMember, resendInvite, revokeInvite, setMemberRole } from '../../data/workspaces';
import { useUser } from '../../lib/auth';
import { cx } from '../../lib/cx';
import { absoluteTime, errorMessage, relativeTime } from '../board/format';
import { useDelayedFlag } from '../board/hooks';
import { toastError } from '../board/toast';
import { LeaveWorkspaceButton } from './leave';
import { PageTitle, RowList, SettingsSection } from './ui';

const ROLE_NAMES: Record<WorkspaceRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };
const ROLE_HINTS: Record<InviteRole, string> = {
  admin: 'Invites and manages members, sees all API tokens',
  member: 'Boards, docs, settings, own API tokens',
};

/**
 * Settings → Members: members (with roles) and pending invites. Everyone sees them; the
 * owner and admins invite, resend, revoke, change roles and remove (never the owner).
 * These are server operations (the API), picked up by the live lists when they commit.
 */
export function MembersSettings() {
  const ws = useWorkspace();
  const admin = useIsAdmin();
  const members = useMembers();
  const invites = useInvites();
  const loading = members.loading || invites.loading;
  const slow = useDelayedFlag(loading);
  const seats = members.data.length + invites.data.length;

  return (
    <>
      <PageTitle
        title="Members"
        description={
          admin
            ? `People in ${ws.name}. Admins invite and manage members; only the owner renames, transfers or deletes the workspace. Removing someone ends their access, including their API tokens, immediately.`
            : `People in ${ws.name}. Only admins and the owner invite or manage members.`
        }
      >
        <span className="mt-1 text-sm whitespace-nowrap text-fg-faint" title="Members plus pending invites">
          {loading ? '' : `${seats} / ${LIMITS.seats} seats`}
        </span>
      </PageTitle>

      {admin && !loading && <InviteForm members={members.data} invites={invites.data} seats={seats} />}

      <SettingsSection title="Members">
        {loading ? (
          slow && <p className="text-sm text-fg-faint">Loading…</p>
        ) : (
          <RowList>
            {members.data.map((m) => (
              <MemberRow key={m.id} member={m} />
            ))}
          </RowList>
        )}
      </SettingsSection>

      {!loading && invites.data.length > 0 && (
        <SettingsSection title="Pending invites" description="They join when they sign in with Google as that email and accept.">
          <RowList>
            {invites.data.map((i) => (
              <InviteRow key={i.id} invite={i} />
            ))}
          </RowList>
        </SettingsSection>
      )}

      {ws.role !== 'owner' && (
        <SettingsSection title="Leave workspace" description="You stop having access to its boards and docs.">
          <LeaveWorkspaceButton />
        </SettingsSection>
      )}
    </>
  );
}

/** Outcome of the last invite, shown under the form until dismissed or the next invite. */
type Outcome = { kind: 'sent'; email: string } | { kind: 'failed'; email: string; error?: string };

function InviteForm({ members, invites, seats }: { members: Member[]; invites: Invite[]; seats: number }) {
  const ws = useWorkspace();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const normalized = normalizeEmail(email);
  const full = seats >= LIMITS.seats;

  const problem = !normalized
    ? null
    : !isValidEmail(normalized)
      ? 'Enter an email address'
      : members.some((m) => m.email === normalized)
        ? `${normalized} is already a member`
        : invites.some((i) => i.email === normalized)
          ? `${normalized} is already invited`
          : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!normalized || problem || busy || full) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    inviteMember(ws.id, normalized, role).then(
      (r) => {
        setBusy(false);
        setEmail('');
        setOutcome(r.emailSent ? { kind: 'sent', email: r.invite.email } : { kind: 'failed', email: r.invite.email, error: r.emailError });
      },
      (err: unknown) => {
        setBusy(false);
        setError(inviteErrorMessage(err, normalized));
      },
    );
  };

  const message = error ?? problem;

  return (
    <SettingsSection title="Invite">
      <form onSubmit={submit} noValidate className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
        <div className="flex flex-wrap gap-2">
          <Input
            type="email"
            aria-label="Email to invite"
            placeholder="name@gmail.com"
            value={email}
            aria-invalid={Boolean(message)}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            disabled={full}
            className="min-w-48 flex-1"
          />
          <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as InviteRole)} disabled={full} className="w-28">
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_NAMES[r]}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="primary" icon={<UserPlus size="0.8125rem" />} disabled={!normalized || Boolean(problem) || busy || full}>
            {busy ? 'Inviting…' : 'Invite'}
          </Button>
        </div>
        {full ? (
          <p role="alert" className="text-sm text-danger">
            All {LIMITS.seats} seats are taken (members plus pending invites). Revoke an invite or remove a member to invite someone else.
          </p>
        ) : message ? (
          <p role="alert" className="text-sm text-danger">
            {message}
          </p>
        ) : (
          <p className="text-sm text-fg-faint">
            {ROLE_HINTS[role]}. They get an email and join by signing in with Google as exactly this address.
          </p>
        )}
        {outcome && <InviteOutcome outcome={outcome} onDismiss={() => setOutcome(null)} />}
      </form>
    </SettingsSection>
  );
}

function InviteOutcome({ outcome, onDismiss }: { outcome: Outcome; onDismiss: () => void }) {
  const failed = outcome.kind === 'failed';
  return (
    <div
      role="status"
      className={cx(
        'flex items-start gap-2 rounded-md px-2.5 py-2 text-sm',
        failed ? 'bg-[var(--label-yellow-bg)] text-[var(--label-yellow-fg)]' : 'bg-accent-soft text-fg',
      )}
    >
      {failed ? <AlertTriangle size="0.875rem" className="mt-px shrink-0" /> : <Mail size="0.875rem" className="mt-px shrink-0 text-accent" />}
      <p className="min-w-0 flex-1">
        {failed ? (
          <>
            Invited {outcome.email}, but the email couldn't be sent{outcome.error ? ` (${outcome.error})` : ''}. The invite still works: they
            see it after signing in. Tell them, or try Resend below.
          </>
        ) : (
          <>Invite sent to {outcome.email}.</>
        )}
      </p>
      <button type="button" aria-label="Dismiss" onClick={onDismiss} className="rounded opacity-70 hover:opacity-100">
        <X size="0.8125rem" />
      </button>
    </div>
  );
}

function inviteErrorMessage(err: unknown, email: string): string {
  if (err instanceof ApiError) {
    if (err.code === 'seat_limit') return `All ${LIMITS.seats} seats are taken (members plus pending invites).`;
    if (err.code === 'already_member') return `${email} is already a member`;
    if (err.code === 'already_invited') return `${email} is already invited`;
    if (err.code === 'too_many_requests') return `An invite was just emailed to ${email}. Try again in a minute.`;
    if (err.code === 'invite_limit') return `You've sent ${LIMITS.inviteSendsPerDay} invite emails today, the daily limit. Try again tomorrow.`;
  }
  return errorMessage(err);
}

function MemberRow({ member: m }: { member: Member }) {
  const ws = useWorkspace();
  const user = useUser();
  const self = m.uid === user.uid;
  const manageable = !self && canManageMember(ws.role, m.role);
  /** Role shown while a change is on its way to the server. */
  const [pendingRole, setPendingRole] = useState<InviteRole | null>(null);
  if (pendingRole && pendingRole === m.role) setPendingRole(null);
  const role = pendingRole ?? m.role;
  const name = m.name || m.email;

  const changeRole = (next: InviteRole) => {
    if (next === role) return;
    setPendingRole(next);
    setMemberRole(ws.id, m.uid, next).catch((err: unknown) => {
      setPendingRole(null);
      toastError(err);
    });
  };

  const remove = () =>
    void confirmAction({
      title: `Remove ${name}?`,
      body: `They lose access to ${ws.name} immediately, and their API tokens in it stop working. You can invite them again later.`,
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: () => removeMember(ws.id, m.uid),
    });

  return (
    <li className="flex min-h-11 items-center gap-2.5 px-3 py-1.5">
      <Avatar actor={{ type: 'user', id: m.uid, name }} photoURL={m.photoURL} size={20} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{name}</span>
          {self && <span className="text-sm text-fg-faint">(you)</span>}
        </div>
        <div className="truncate text-xs text-fg-faint">
          {m.name && `${m.email} · `}
          {m.lastSignInAt ? (
            <span title={absoluteTime(m.lastSignInAt)}>Signed in {relativeTime(m.lastSignInAt)}</span>
          ) : (
            <span title={absoluteTime(m.joinedAt)}>Joined {relativeTime(m.joinedAt)}</span>
          )}
        </div>
      </div>
      {manageable && role !== 'owner' ? (
        <Popover
          placement="bottom-end"
          className="w-72"
          trigger={(props) => (
            <Button {...props} size="sm" variant="ghost" aria-label={`Role of ${name}: ${ROLE_NAMES[role]}`}>
              {ROLE_NAMES[role]}
              <ChevronDown size="0.75rem" className="text-fg-faint" />
            </Button>
          )}
        >
          <Menu>
            {INVITE_ROLES.map((r) => (
              <MenuItem key={r} selected={r === role} onSelect={() => changeRole(r)} title={ROLE_HINTS[r]}>
                {ROLE_NAMES[r]}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem danger onSelect={remove}>
              Remove from workspace
            </MenuItem>
          </Menu>
        </Popover>
      ) : (
        <Badge color={role === 'owner' ? 'blue' : 'gray'}>{ROLE_NAMES[role]}</Badge>
      )}
    </li>
  );
}

const tickEverySecond = (onChange: () => void) => {
  const t = setInterval(onChange, 1000);
  return () => clearInterval(t);
};
const noTicks = () => () => {};
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Seconds left until `until` (ms epoch); re-renders every second while some are left. */
function useSecondsUntil(until: number): number {
  const [done, setDone] = useState(false);
  const now = useSyncExternalStore(done ? noTicks : tickEverySecond, nowSeconds);
  const left = Math.max(0, Math.ceil(until / 1000) - now);
  if (done !== (left <= 0)) setDone(left <= 0);
  return left;
}

function InviteRow({ invite: i }: { invite: Invite }) {
  const ws = useWorkspace();
  const admin = useIsAdmin();
  const [sending, setSending] = useState(false);
  const lastSent = i.lastSentAt ? Date.parse(i.lastSentAt) : 0;
  const cooldown = useSecondsUntil(lastSent + LIMITS.resendCooldownMs);
  const status = sending ? 'pending' : i.emailStatus;

  const resend = () => {
    setSending(true);
    resendInvite(ws.id, i.email)
      .then((r) => {
        if (!r.emailSent) toastError(new Error(`Couldn't email ${i.email}${r.emailError ? `: ${r.emailError}` : ''}`));
      }, toastError)
      .finally(() => setSending(false));
  };

  const revoke = () =>
    void confirmAction({
      title: `Revoke the invite for ${i.email}?`,
      body: 'The link in their email stops working. You can invite them again later.',
      confirmLabel: 'Revoke',
      danger: true,
      onConfirm: () => revokeInvite(ws.id, i.email),
    });

  return (
    <li className="flex min-h-11 items-center gap-2.5 px-3 py-1.5">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-fg-faint">
        <Mail size="0.625rem" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{i.email}</span>
          <Badge>{ROLE_NAMES[i.role]}</Badge>
        </div>
        <div className="flex min-w-0 items-center gap-1 text-xs text-fg-faint">
          <span className="truncate">
            Invited by {i.invitedBy.name} <span title={absoluteTime(i.createdAt)}>{relativeTime(i.createdAt)}</span> ·{' '}
          </span>
          {status === 'failed' ? (
            <span className="flex shrink-0 items-center gap-0.5 text-warning" title={i.emailError}>
              <AlertTriangle size="0.6875rem" />
              Email failed
            </span>
          ) : status === 'pending' ? (
            <span className="shrink-0">Sending email…</span>
          ) : (
            <span className="shrink-0" title={absoluteTime(i.lastSentAt)}>
              Email sent {relativeTime(i.lastSentAt)}
            </span>
          )}
        </div>
      </div>
      {admin && (
        <>
          <Button
            size="sm"
            variant="ghost"
            icon={<Send size="0.75rem" />}
            disabled={sending || cooldown > 0}
            title={cooldown > 0 ? 'Invites can be re-sent once a minute' : `Send the invite email to ${i.email} again`}
            onClick={resend}
          >
            {sending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
          </Button>
          <Button size="sm" variant="ghost" className="hover:text-danger" onClick={revoke}>
            Revoke
          </Button>
        </>
      )}
    </li>
  );
}
