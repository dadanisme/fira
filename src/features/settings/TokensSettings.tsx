import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, KeyRound, Plus } from 'lucide-react';
import type { ApiToken, LabelColor, Member } from '@shared/types';
import { colorFor } from '@shared/labels';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { useMembers } from '../../data/members';
import { useIsOwner, useUser } from '../../lib/auth';
import { cx } from '../../lib/cx';
import { absoluteTime, errorMessage, relativeTime } from '../board/format';
import { useDelayedFlag } from '../board/hooks';
import { ColorSwatches } from '../board/pickers';
import { toastError } from '../board/toast';
import { createToken, listTokens, revokeToken } from './api';
import { PageTitle, RowList, SettingsSection } from './ui';

/**
 * API tokens for automation agents. Managed through the REST API (the server hashes secrets).
 * Members see their own tokens; the owner sees everyone's, with who created each.
 */
export function TokensSettings() {
  const owner = useIsOwner();
  const user = useUser();
  const { data: members } = useMembers();
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ token: ApiToken; secret: string } | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const slow = useDelayedFlag(tokens === null && !error);

  const load = useCallback(() => {
    listTokens().then(
      (list) => {
        setTokens(list);
        setError(null);
      },
      (err) => setError(errorMessage(err)),
    );
  }, []);
  useEffect(load, [load]);

  const revoke = async (t: ApiToken) => {
    if (!confirm(`Revoke “${t.name}”? Agents using it stop working immediately.`)) return;
    setTokens((list) => list?.map((x) => (x.id === t.id ? { ...x, revoked: true } : x)) ?? null);
    try {
      const updated = await revokeToken(t.id);
      setTokens((list) => list?.map((x) => (x.id === t.id ? updated : x)) ?? null);
    } catch (err) {
      toastError(err);
      load();
    }
  };

  const active = tokens?.filter((t) => !t.revoked) ?? [];
  const revoked = tokens?.filter((t) => t.revoked) ?? [];

  return (
    <>
      <PageTitle
        title="API tokens"
        description={
          <>
            Personal tokens for agents calling <code className="text-sm">/api/v1</code> with <code className="text-sm">Authorization: Bearer fira_…</code>.
            Their changes show up under the token's name and yours, e.g. “agen (via {user.displayName ?? 'you'})”.
            {owner && ' As the owner, you see and can revoke every member’s tokens.'}{' '}
            {/* A static page outside the SPA (public/docs/api), so a plain link, not a router Link. */}
            <a href="/docs/api" target="_blank" rel="noreferrer" className="whitespace-nowrap text-accent hover:underline">
              API documentation →
            </a>
          </>
        }
      />

      {created ? (
        <SecretNotice created={created} onDone={() => setCreated(null)} />
      ) : (
        <CreateForm
          onCreated={(c) => {
            setCreated(c);
            setTokens((list) => [c.token, ...(list ?? [])]);
          }}
        />
      )}

      <SettingsSection title="Active tokens">
        {error ? (
          <div className="rounded-lg border border-line px-3 py-3 text-sm">
            <p className="text-danger">Couldn't load tokens: {error}</p>
            <Button size="sm" className="mt-2" onClick={load}>
              Retry
            </Button>
          </div>
        ) : tokens === null ? (
          slow && <p className="text-sm text-fg-faint">Loading…</p>
        ) : active.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-fg-faint">No active tokens</p>
        ) : (
          <RowList>
            {active.map((t) => (
              <TokenRow key={t.id} token={t} creator={owner ? creatorOf(t, members) : undefined} onRevoke={() => void revoke(t)} />
            ))}
          </RowList>
        )}
        {revoked.length > 0 && (
          <div className="mt-3">
            <button type="button" onClick={() => setShowRevoked((x) => !x)} className="text-sm text-fg-muted hover:text-fg hover:underline">
              {showRevoked ? 'Hide' : 'Show'} {revoked.length} revoked
            </button>
            {showRevoked && (
              <div className="mt-2">
                <RowList>
                  {revoked.map((t) => (
                    <TokenRow key={t.id} token={t} creator={owner ? creatorOf(t, members) : undefined} />
                  ))}
                </RowList>
              </div>
            )}
          </div>
        )}
      </SettingsSection>
    </>
  );
}

function CreateForm({ onCreated }: { onCreated: (c: { token: ApiToken; secret: string }) => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<LabelColor | null>(null);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      onCreated(await createToken(trimmed, color ?? colorFor(trimmed)));
      setName('');
      setColor(null);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="New token">
      <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
        <div className="flex gap-2">
          <Input
            aria-label="Token name"
            placeholder="Agent name, e.g. agen"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-64"
          />
          <Button type="submit" variant="primary" icon={<Plus size="0.8125rem" />} disabled={!trimmed || busy}>
            {busy ? 'Creating…' : 'Create token'}
          </Button>
        </div>
        {trimmed && <ColorSwatches value={color ?? colorFor(trimmed)} onChange={setColor} />}
      </form>
    </SettingsSection>
  );
}

function SecretNotice({ created, onDone }: { created: { token: ApiToken; secret: string }; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(created.secret).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      toastError,
    );
  };
  return (
    <div role="status" className="mb-8 rounded-lg border border-accent/40 bg-accent-soft p-3">
      <p className="text-base font-medium">Token “{created.token.name}” created</p>
      <p className="mb-2 text-sm text-fg-muted">Copy the secret now. It won't be shown again.</p>
      <div className="flex gap-2">
        <input
          readOnly
          aria-label="Token secret"
          value={created.secret}
          onFocus={(e) => e.target.select()}
          className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 font-mono text-sm text-fg outline-none focus:border-accent"
        />
        <Button icon={copied ? <Check size="0.8125rem" /> : <Copy size="0.8125rem" />} onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** Who created a token, for the owner's view. Legacy tokens without a creator are the owner's. */
function creatorOf(t: ApiToken, members: readonly Member[]): { name: string; removed: boolean } {
  if (!t.userEmail) return { name: 'Owner', removed: false };
  const member = members.find((m) => m.id === t.userEmail);
  return { name: member?.name ?? t.userName ?? t.userEmail, removed: members.length > 0 && !member };
}

function TokenRow({ token: t, creator, onRevoke }: { token: ApiToken; creator?: { name: string; removed: boolean }; onRevoke?: () => void }) {
  return (
    <li className={cx('flex h-11 items-center gap-2.5 px-3', t.revoked && 'opacity-60')}>
      <Avatar actor={{ type: 'token', id: t.id, name: t.name }} size={20} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{t.name}</span>
          <code className="flex items-center gap-1 text-xs text-fg-faint">
            <KeyRound size="0.625rem" />
            {t.prefix}…
          </code>
        </div>
        <div className="text-xs text-fg-faint">
          <span title={absoluteTime(t.createdAt)}>Created {relativeTime(t.createdAt)}</span>
          {' · '}
          <span title={absoluteTime(t.lastUsedAt)}>{t.lastUsedAt ? `Last used ${relativeTime(t.lastUsedAt)}` : 'Never used'}</span>
          {creator && ` · By ${creator.name}`}
          {creator?.removed && !t.revoked && <span className="text-danger"> · Creator removed, inactive</span>}
          {t.revoked && ' · Revoked'}
        </div>
      </div>
      {onRevoke && (
        <Button size="sm" variant="ghost" className="hover:text-danger" onClick={onRevoke}>
          Revoke
        </Button>
      )}
    </li>
  );
}
