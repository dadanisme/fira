import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ChevronRight, Info, LogOut, X } from 'lucide-react';
import type { Invite, Membership } from '@shared/types';
import { LIMITS, slugify, wsPath } from '@shared/workspaces';
import { Avatar } from '../components/Avatar';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { Input } from '../components/Input';
import { Logo } from '../components/Logo';
import { WorkspaceIcon } from '../components/WorkspaceIcon';
import { ApiError } from '../data/api';
import { useMyInvites, useMyMemberships } from '../data/members';
import { readLastWorkspace } from '../data/workspace';
import { acceptInvite, createWorkspace, declineInvite } from '../data/workspaces';
import { signOutUser, useUser } from '../lib/auth';
import { ThemeToggle } from './ThemeToggle';
import { SlugInput } from './SlugInput';
import { nameProblem, slugProblem, useEnterWorkspace } from './workspaceForm';
import type { WorkspaceNoticeState } from './WorkspaceRoute';

/** `location.state` of links to the landing page: the lost-access notice, or "open the create form". */
export type LandingState = WorkspaceNoticeState & { create?: boolean };

const ROLE_NAMES = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const;

/**
 * `/workspaces` (no sidebar): pending invites to the user's email (Accept / Decline), their
 * workspaces, and "Create workspace". A first-time user sees only invites + create.
 */
export function Landing() {
  const user = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as LandingState | null;
  const memberships = useMyMemberships(user.uid);
  const invites = useMyInvites(user.email ?? '');
  const enter = useEnterWorkspace(user.uid);
  const owned = memberships.data.filter((m) => m.role === 'owner').length;
  const loading = memberships.loading;

  return (
    <div className="h-full overflow-y-auto bg-sidebar">
      <header className="flex h-12 items-center gap-2 px-4">
        <Logo size={18} />
        <span className="flex-1 text-md font-semibold tracking-tight">fira</span>
        <ThemeToggle />
        <span className="hidden max-w-60 truncate text-sm text-fg-muted sm:inline">{user.email}</span>
        <Button variant="ghost" icon={<LogOut size="0.8125rem" />} onClick={() => void signOutUser()}>
          Sign out
        </Button>
      </header>
      <main className="mx-auto flex max-w-lg flex-col gap-6 px-4 pt-6 pb-16 sm:pt-12">
        {state?.notice && (
          <div role="status" className="flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-card">
            <Info size="0.9375rem" className="mt-0.5 shrink-0 text-fg-muted" />
            <p className="min-w-0 flex-1">{state.notice}</p>
            <IconButton size="sm" label="Dismiss" onClick={() => navigate('.', { replace: true, state: null })}>
              <X size="0.8125rem" />
            </IconButton>
          </div>
        )}

        {invites.data.length > 0 && (
          <Section title="Invitations" count={invites.data.length}>
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface shadow-card">
              {invites.data.map((i) => (
                <InviteRow key={`${i.workspaceId}/${i.id}`} invite={i} onAccepted={enter} />
              ))}
            </ul>
          </Section>
        )}

        {(loading || memberships.data.length > 0) && (
          <Section title="Your workspaces">
            {!loading && <WorkspaceList memberships={memberships.data} />}
          </Section>
        )}

        {!loading && (
          <Section title={memberships.data.length === 0 ? 'Create your first workspace' : 'Create a workspace'}>
            {memberships.data.length === 0 && invites.data.length === 0 && (
              <p className="-mt-1 mb-2 px-1 text-fg-muted">
                A workspace holds boards and docs for you and the people you invite. Waiting for an invite? It shows up here once
                someone invites {user.email}.
              </p>
            )}
            <CreateWorkspaceForm owned={owned} autoFocus={state?.create === true} onCreated={enter} />
          </Section>
        )}
      </main>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 flex items-center gap-1.5 px-1 text-sm font-medium text-fg-muted">
        {title}
        {count !== undefined && <span className="rounded-full bg-accent px-1.5 text-2xs leading-4 font-semibold text-accent-fg">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function WorkspaceList({ memberships }: { memberships: Membership[] }) {
  const last = readLastWorkspace();
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card">
      {memberships.map((m) => (
        <li key={m.workspaceId}>
          <Link to={wsPath(m.workspaceSlug)} className="group flex h-12 items-center gap-3 px-3 hover:bg-hover">
            <WorkspaceIcon id={m.workspaceId} name={m.workspaceName} size={24} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{m.workspaceName}</span>
              <span className="block truncate font-mono text-xs text-fg-faint">/w/{m.workspaceSlug}</span>
            </span>
            {m.workspaceId === last && <span className="text-xs text-fg-faint">Last used</span>}
            {m.role !== 'member' && <Badge color={m.role === 'owner' ? 'blue' : 'gray'}>{ROLE_NAMES[m.role]}</Badge>}
            <ChevronRight size="0.875rem" className="text-fg-faint group-hover:text-fg-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function InviteRow({ invite, onAccepted }: { invite: Invite; onAccepted: (ws: { id: string; slug: string }) => void }) {
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = (kind: 'accept' | 'decline') => {
    setBusy(kind);
    setError(null);
    const done =
      kind === 'accept'
        ? acceptInvite(invite.workspaceId, invite.email).then((r) => onAccepted({ id: r.workspace.id, slug: r.workspace.slug }))
        : declineInvite(invite.workspaceId, invite.email);
    // On success the invite leaves the live list (and accept navigates), so only failures reset.
    done.catch((err: unknown) => {
      setError(err instanceof ApiError && err.code === 'not_found' ? 'This invite was revoked.' : err instanceof Error ? err.message : String(err));
      setBusy(null);
    });
  };

  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <WorkspaceIcon id={invite.workspaceId} name={invite.workspaceName} size={24} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{invite.workspaceName}</div>
          <div className="flex min-w-0 items-center gap-1 text-xs text-fg-faint">
            <Avatar actor={{ type: 'user', id: invite.invitedBy.uid, name: invite.invitedBy.name }} size={14} />
            <span className="truncate">
              {invite.invitedBy.name} invited you as {invite.role === 'admin' ? 'an admin' : 'a member'}
            </span>
          </div>
        </div>
        <Button variant="ghost" disabled={busy !== null} onClick={() => act('decline')}>
          {busy === 'decline' ? 'Declining…' : 'Decline'}
        </Button>
        <Button variant="primary" disabled={busy !== null} onClick={() => act('accept')}>
          {busy === 'accept' ? 'Joining…' : 'Accept'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="pl-9 text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

function CreateWorkspaceForm({
  owned,
  autoFocus,
  onCreated,
}: {
  owned: number;
  autoFocus: boolean;
  onCreated: (ws: { id: string; slug: string }) => void;
}) {
  const [name, setName] = useState('');
  /** null: follow the name's suggestion. */
  const [slug, setSlug] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: 'slug' | 'form'; message: string } | null>(null);
  const effectiveSlug = slug ?? slugify(name);
  const atLimit = owned >= LIMITS.ownedWorkspaces;
  const nameError = nameProblem(name);
  const slugError = slugProblem(effectiveSlug);
  const invalid = Boolean(nameError || slugError);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid || busy || atLimit) return;
    setBusy(true);
    setError(null);
    createWorkspace({ name: name.trim(), slug: effectiveSlug }).then(
      (w) => onCreated({ id: w.id, slug: w.slug }),
      (err: unknown) => {
        setBusy(false);
        if (err instanceof ApiError && err.code === 'slug_taken') {
          setError({ field: 'slug', message: `/w/${effectiveSlug} is taken; pick another slug` });
        } else if (err instanceof ApiError && err.code === 'workspace_limit') {
          setError({ field: 'form', message: limitMessage });
        } else {
          setError({ field: 'form', message: err instanceof Error ? err.message : String(err) });
        }
      },
    );
  };

  // Field problems show once the user has typed in the field (or tried to submit).
  const showName = (touched || name !== '') && nameError;
  const slugMessage = error?.field === 'slug' ? error.message : (touched || slug !== null || name !== '') && slugError;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 shadow-card">
      <div className="flex flex-col gap-1">
        <label htmlFor="ws-name" className="text-sm font-medium text-fg-muted">
          Name
        </label>
        <Input
          id="ws-name"
          autoFocus={autoFocus}
          placeholder="Acme"
          maxLength={LIMITS.workspaceName + 10}
          value={name}
          aria-invalid={Boolean(showName)}
          onChange={(e) => {
            setName(e.target.value);
            if (error?.field === 'form') setError(null);
          }}
          disabled={atLimit}
        />
        {showName && <span className="text-sm text-danger">{nameError}</span>}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="ws-slug" className="text-sm font-medium text-fg-muted">
          URL
        </label>
        <SlugInput
          id="ws-slug"
          placeholder="acme"
          value={effectiveSlug}
          aria-invalid={Boolean(slugMessage)}
          onChange={(s) => {
            setSlug(s);
            if (error?.field === 'slug') setError(null);
          }}
          disabled={atLimit}
        />
        {slugMessage ? (
          <span className="text-sm text-danger">{slugMessage}</span>
        ) : (
          <span className="text-sm text-fg-faint">Lowercase letters, digits and hyphens. The owner can change it later.</span>
        )}
      </div>
      {(atLimit || error?.field === 'form') && (
        <p role="alert" className="text-sm text-danger">
          {atLimit ? limitMessage : error?.message}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={busy || atLimit || (touched && invalid)}>
          {busy ? 'Creating…' : 'Create workspace'}
        </Button>
      </div>
    </form>
  );
}

const limitMessage = `You own ${LIMITS.ownedWorkspaces} workspaces, the most allowed. Transfer or delete one to create another.`;
