import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { Invite } from '@shared/types';
import { isWorkspaceSlug, normalizeWorkspaceName, slugify, wsPath } from '@shared/workspaces';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useMyInvites, useMyMemberships } from '../data/members';
import { acceptInvite, createWorkspace, declineInvite } from '../data/workspaces';
import { signOutUser, useUser } from '../lib/auth';
import type { WorkspaceNoticeState } from './WorkspaceRoute';

/**
 * `/workspaces` (no sidebar). PLACEHOLDER, to be replaced by T3: pending invites
 * (Accept/Decline), the user's workspaces, and a bare "Create workspace" form.
 */
export function Landing() {
  const user = useUser();
  const notice = (useLocation().state as WorkspaceNoticeState | null)?.notice;
  const memberships = useMyMemberships(user.uid);
  const invites = useMyInvites(user.email ?? '');

  return (
    <div className="h-full overflow-y-auto bg-sidebar p-6">
      <div className="mx-auto max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Workspaces</h1>
          <Button variant="ghost" size="sm" onClick={() => void signOutUser()}>
            Sign out {user.email}
          </Button>
        </div>
        {notice && <p className="rounded-md border border-line bg-surface p-3 text-fg-muted">{notice}</p>}
        {invites.data.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-medium">Invites</h2>
            <ul className="space-y-1">
              {invites.data.map((i) => (
                <InviteRow key={`${i.workspaceId}/${i.id}`} invite={i} />
              ))}
            </ul>
          </section>
        )}
        <section className="space-y-2">
          <h2 className="font-medium">Your workspaces</h2>
          {memberships.loading ? null : memberships.data.length === 0 ? (
            <p className="text-fg-muted">You aren't in a workspace yet.</p>
          ) : (
            <ul className="space-y-1">
              {memberships.data.map((m) => (
                <li key={m.workspaceId}>
                  <Link to={wsPath(m.workspaceSlug)} className="text-accent hover:underline">
                    {m.workspaceName}
                  </Link>
                  <span className="text-fg-faint"> · {m.role}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <CreateWorkspaceForm />
      </div>
    </div>
  );
}

function InviteRow({ invite }: { invite: Invite }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<unknown>, then?: () => void) => {
    setBusy(true);
    setError(null);
    fn().then(then, (err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    });
  };
  return (
    <li className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate">
        {invite.workspaceName} <span className="text-fg-faint">from {invite.invitedBy.name}</span>
      </span>
      <Button
        size="sm"
        variant="primary"
        disabled={busy}
        onClick={() => act(() => acceptInvite(invite.workspaceId, invite.email).then((r) => navigate(wsPath(r.workspace.slug))))}
      >
        Accept
      </Button>
      <Button size="sm" disabled={busy} onClick={() => act(() => declineInvite(invite.workspaceId, invite.email))}>
        Decline
      </Button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </li>
  );
}

function CreateWorkspaceForm() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const effectiveSlug = slug ?? slugify(name);
  const valid = normalizeWorkspaceName(name) !== null && isWorkspaceSlug(effectiveSlug);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    createWorkspace({ name: name.trim(), slug: effectiveSlug }).then(
      (w) => navigate(wsPath(w.slug)),
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <h2 className="font-medium">Create workspace</h2>
      <Input aria-label="Workspace name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="w-full" />
      <Input aria-label="Slug" placeholder="slug" value={effectiveSlug} onChange={(e) => setSlug(e.target.value)} className="w-full" />
      <Button type="submit" variant="primary" disabled={!valid || busy}>
        Create
      </Button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  );
}
