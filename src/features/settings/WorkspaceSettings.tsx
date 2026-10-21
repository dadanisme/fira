import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRightLeft, Trash } from 'lucide-react';
import { LIMITS } from '@shared/workspaces';
import { Button } from '../../components/Button';
import { confirmAction } from '../../components/ConfirmDialog';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { WorkspaceIcon } from '../../components/WorkspaceIcon';
import { ApiError } from '../../data/api';
import { useMembers } from '../../data/members';
import { useWorkspace } from '../../data/workspace';
import { deleteWorkspace, transferOwnership, updateWorkspace } from '../../data/workspaces';
import { useUser } from '../../lib/auth';
import type { LandingState } from '../../app/Landing';
import { SlugInput } from '../../app/SlugInput';
import { nameProblem, slugProblem } from '../../app/workspaceForm';
import { errorMessage } from '../board/format';
import { LeaveWorkspaceButton } from './leave';
import { PageTitle, RowList, SettingRow, SettingsSection } from './ui';

/**
 * Settings → Workspace: name and slug (owner edits, others read), transfer ownership,
 * delete (typed-slug confirm), leave (non-owners).
 */
export function WorkspaceSettings() {
  const ws = useWorkspace();
  const owner = ws.role === 'owner';
  return (
    <>
      <PageTitle
        title="Workspace"
        description={owner ? 'You own this workspace.' : 'Only the owner can rename, transfer or delete the workspace.'}
      />
      {owner ? <RenameForm key={`${ws.name}\u0000${ws.slug}`} /> : <ReadOnlyGeneral />}
      {owner && <TransferSection />}
      {owner ? (
        <DeleteSection />
      ) : (
        <SettingsSection title="Leave workspace" description="You stop having access to its boards and docs.">
          <LeaveWorkspaceButton />
        </SettingsSection>
      )}
    </>
  );
}

function ReadOnlyGeneral() {
  const ws = useWorkspace();
  return (
    <SettingsSection title="General">
      <RowList>
        <li>
          <SettingRow label="Name">
            <span className="flex min-w-0 items-center gap-2">
              <WorkspaceIcon id={ws.id} name={ws.name} size={18} />
              <span className="truncate">{ws.name}</span>
            </span>
          </SettingRow>
        </li>
        <li>
          <SettingRow label="URL">
            <span className="truncate font-mono text-fg-muted">/w/{ws.slug}</span>
          </SettingRow>
        </li>
      </RowList>
    </SettingsSection>
  );
}

function RenameForm() {
  const ws = useWorkspace();
  const [name, setName] = useState(ws.name);
  const [slug, setSlug] = useState(ws.slug);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: 'slug' | 'form'; message: string } | null>(null);
  const nameError = nameProblem(name);
  const slugError = slugProblem(slug);
  const changed = name.trim() !== ws.name || slug !== ws.slug;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!changed || nameError || slugError || busy) return;
    setBusy(true);
    setError(null);
    const body = { ...(name.trim() !== ws.name && { name: name.trim() }), ...(slug !== ws.slug && { slug }) };
    // On success the membership snapshot carries the new name/slug: this form remounts with
    // them, and WorkspaceRoute moves the URL to the new slug (same page).
    updateWorkspace(ws.id, body).catch((err: unknown) => {
      setBusy(false);
      setError(
        err instanceof ApiError && err.code === 'slug_taken'
          ? { field: 'slug', message: `/w/${slug} is taken; pick another slug` }
          : { field: 'form', message: errorMessage(err) },
      );
    });
  };

  const slugMessage = error?.field === 'slug' ? error.message : slugError;

  return (
    <SettingsSection title="General">
      <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="ws-name" className="text-sm font-medium text-fg-muted">
            Name
          </label>
          <Input id="ws-name" value={name} maxLength={LIMITS.workspaceName + 10} aria-invalid={Boolean(nameError)} onChange={(e) => setName(e.target.value)} />
          {nameError && <span className="text-sm text-danger">{nameError}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ws-slug" className="text-sm font-medium text-fg-muted">
            URL
          </label>
          <SlugInput
            id="ws-slug"
            value={slug}
            aria-invalid={Boolean(slugMessage)}
            onChange={(s) => {
              setSlug(s);
              if (error?.field === 'slug') setError(null);
            }}
          />
          {slugMessage ? (
            <span className="text-sm text-danger">{slugMessage}</span>
          ) : slug !== ws.slug ? (
            <span className="text-sm text-warning">Links to /w/{ws.slug} stop working after the change.</span>
          ) : (
            <span className="text-sm text-fg-faint">Every link into the workspace starts with it.</span>
          )}
        </div>
        {error?.field === 'form' && (
          <p role="alert" className="text-sm text-danger">
            {error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          {changed && !busy && (
            <Button
              variant="ghost"
              onClick={() => {
                setName(ws.name);
                setSlug(ws.slug);
                setError(null);
              }}
            >
              Reset
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={!changed || busy || Boolean(nameError || slugError)}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

function TransferSection() {
  const ws = useWorkspace();
  const user = useUser();
  const { data: members, loading } = useMembers();
  const others = members.filter((m) => m.uid !== user.uid);
  const [target, setTarget] = useState('');
  const picked = others.find((m) => m.uid === target);

  const transfer = () => {
    if (!picked) return;
    const who = picked.name || picked.email;
    void confirmAction({
      title: `Make ${who} the owner?`,
      body: (
        <>
          {who} becomes the owner of {ws.name} and you become an admin. Only the owner can rename, transfer or delete the workspace, so
          you can't undo this yourself.
        </>
      ),
      confirmLabel: 'Transfer ownership',
      danger: true,
      onConfirm: () =>
        transferOwnership(ws.id, picked.uid).catch((err: unknown) => {
          throw err instanceof ApiError && err.code === 'workspace_limit'
            ? new Error(`${who} already owns ${LIMITS.ownedWorkspaces} workspaces, the most allowed.`)
            : err;
        }),
    }).then((ok) => ok && setTarget(''));
  };

  return (
    <SettingsSection title="Transfer ownership" description="Hand the workspace to another member. You stay on as an admin.">
      {loading ? null : others.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-fg-faint">
          Invite someone first: ownership goes to an existing member.
        </p>
      ) : (
        <div className="flex gap-2">
          <Select aria-label="New owner" value={target} onChange={(e) => setTarget(e.target.value)} className="w-64">
            <option value="" disabled>
              Choose a member…
            </option>
            {others.map((m) => (
              <option key={m.uid} value={m.uid}>
                {m.name ? `${m.name} (${m.email})` : m.email}
              </option>
            ))}
          </Select>
          <Button icon={<ArrowRightLeft size="0.8125rem" />} disabled={!picked} onClick={transfer}>
            Transfer…
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}

function DeleteSection() {
  const ws = useWorkspace();
  const navigate = useNavigate();

  const remove = () =>
    void confirmAction({
      title: `Delete ${ws.name}?`,
      body: 'Every project, card, doc, file, member, invite and API token in it is deleted right away. This cannot be undone.',
      confirmLabel: 'Delete workspace',
      danger: true,
      typed: ws.slug,
      onConfirm: () =>
        deleteWorkspace(ws.id, ws.slug).then(() => {
          const state: LandingState = { notice: `Deleted ${ws.name}.` };
          navigate('/workspaces', { replace: true, state });
        }),
    });

  return (
    <SettingsSection title="Delete workspace" description="Permanently deletes the workspace and everything in it, for everyone.">
      <div className="rounded-lg border border-danger/40 p-3">
        <Button variant="danger" icon={<Trash size="0.8125rem" />} onClick={remove}>
          Delete workspace…
        </Button>
      </div>
    </SettingsSection>
  );
}
