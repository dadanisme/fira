import { useState, type FormEvent } from 'react';
import { Plus, Trash } from 'lucide-react';
import type { Member } from '@shared/types';
import { isValidEmail, normalizeEmail } from '@shared/actors';
import { useMembers } from '../../data/members';
import { useIsAdmin, useWorkspaceId } from '../../data/workspace';
import { inviteMember, removeMember } from '../../data/workspaces';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { run } from '../board/context';
import { absoluteTime, relativeTime } from '../board/format';
import { useDelayedFlag } from '../board/hooks';
import { PageTitle, RowList } from './ui';

/** Settings → Members: who may use fira. Everyone sees the list; only the owner adds and removes. */
export function MembersSettings() {
  const { data: members, loading } = useMembers();
  const owner = useIsAdmin();
  const wid = useWorkspaceId();
  const slow = useDelayedFlag(loading);
  const [email, setEmail] = useState('');
  const normalized = normalizeEmail(email);
  const exists = members.some((m) => m.email === normalized);
  const invalid = normalized !== '' && !isValidEmail(normalized);

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!normalized || invalid || exists) return;
    run(() => inviteMember(wid, normalized));
    setEmail('');
  };

  return (
    <>
      <PageTitle
        title="Members"
        description={
          owner
            ? 'Google accounts that can use fira. Members can do everything except manage members. Removing someone ends their access, including their API tokens, immediately.'
            : 'Google accounts that can use fira. Only the owner can add or remove members.'
        }
      />
      {loading ? (
        slow && <p className="text-fg-faint">Loading…</p>
      ) : (
        <RowList>
          {members.map((m) => (
            <MemberRow key={m.id} wid={wid} member={m} canRemove={owner && m.role !== 'owner'} />
          ))}
        </RowList>
      )}
      {owner && (
        <form onSubmit={add} className="mt-3 flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              type="email"
              aria-label="Email to invite"
              placeholder="name@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-64"
            />
            <Button type="submit" icon={<Plus size="0.8125rem" />} disabled={!normalized || invalid || exists}>
              Add member
            </Button>
          </div>
          {exists ? (
            <p className="text-sm text-danger">{normalized} is already a member</p>
          ) : invalid ? (
            <p className="text-sm text-danger">Enter an email address</p>
          ) : (
            <p className="text-sm text-fg-faint">They sign in with Google using this email.</p>
          )}
        </form>
      )}
    </>
  );
}

function MemberRow({ wid, member: m, canRemove }: { wid: string; member: Member; canRemove: boolean }) {
  const remove = () => {
    if (!confirm(`Remove ${m.name ?? m.email}? They lose access immediately, and their API tokens stop working.`)) return;
    run(() => removeMember(wid, m.uid));
  };
  return (
    <li className="flex h-11 items-center gap-2.5 px-3">
      <Avatar actor={{ type: 'user', id: m.uid ?? m.email, name: m.name ?? m.email }} photoURL={m.photoURL} size={20} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{m.name ?? m.email}</span>
          {m.role === 'owner' && <Badge color="blue">Owner</Badge>}
          {!m.lastSignInAt && <Badge>Pending</Badge>}
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
      {canRemove && (
        <IconButton label={`Remove ${m.email}`} size="sm" className="hover:text-danger" onClick={remove}>
          <Trash size="0.8125rem" />
        </IconButton>
      )}
    </li>
  );
}
