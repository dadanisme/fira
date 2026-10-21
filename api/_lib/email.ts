import type { InviteRole } from '../../shared/types.js';

/**
 * Invite emails through the Resend REST API (plain `fetch`, no SDK). Env: `RESEND_API_KEY`
 * (unset = not sent, reported as a failure), `INVITE_FROM`, `APP_URL`; `RESEND_API_URL`
 * overrides the endpoint (the smoke test points it at a local stub). The key is never logged
 * or returned.
 */

const DEFAULT_FROM = 'Fira <invites@mail.muhammadramdan.com>';
const DEFAULT_APP_URL = 'https://fira.muhammadramdan.com';
const TIMEOUT_MS = 5000;

export type SendResult = { ok: true } | { ok: false; error: string };

export interface InviteEmail {
  to: string;
  workspaceName: string;
  inviterName: string;
  role: InviteRole;
}

/** The app's origin for links in emails, without a trailing slash. */
export function appUrl(): string {
  return (process.env.APP_URL?.trim() || DEFAULT_APP_URL).replace(/\/+$/, '');
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Subject, HTML and text of an invite email. */
export function inviteMessage({ to, workspaceName, inviterName, role }: InviteEmail) {
  const link = `${appUrl()}/workspaces`;
  // Fixed: the names are user-controlled (a Google display name, a workspace name), so they stay
  // out of the subject, the line most clients show and auto-link. The body has them, escaped.
  const subject = "You've been invited to a workspace on Fira";
  const as = role === 'admin' ? 'an admin' : 'a member';
  const text = [
    `${inviterName} invited you to join ${workspaceName} on fira as ${as}.`,
    '',
    `Open ${link} to accept.`,
    `Sign in with Google as ${to}.`,
  ].join('\n');
  const e = escapeHtml;
  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;color:#111;line-height:1.5">
<p><strong>${e(inviterName)}</strong> invited you to join <strong>${e(workspaceName)}</strong> on fira as ${as}.</p>
<p><a href="${e(link)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">Open fira</a></p>
<p style="color:#555">Sign in with Google as ${e(to)}.</p>
</body></html>`;
  return { subject, text, html };
}

/** Sends one invite email. Never throws: a failure comes back as `{ ok: false, error }` (short, safe to store). */
export async function sendInviteEmail(invite: InviteEmail): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { ok: false, error: 'Email is not configured' };
  const endpoint = `${(process.env.RESEND_API_URL?.trim() || 'https://api.resend.com').replace(/\/+$/, '')}/emails`;
  const { subject, text, html } = inviteMessage(invite);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.INVITE_FROM?.trim() || DEFAULT_FROM, to: [invite.to], subject, html, text }),
      signal: controller.signal,
    });
    if (res.ok) return { ok: true };
    let detail = '';
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === 'string') detail = `: ${body.message}`;
    } catch {
      // not JSON
    }
    return { ok: false, error: `Email provider error ${res.status}${detail}`.slice(0, 300) };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    return { ok: false, error: aborted ? 'Email provider timed out' : 'Email provider unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
