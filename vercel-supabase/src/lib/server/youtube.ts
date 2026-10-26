// YouTube Data API: OAuth with a stored refresh token, and resumable uploads that can span several function runs.
import { env, PermanentError } from './env';
import { getIntegration, setIntegration } from './admin';

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
export const redirectUri = () => `${env.siteUrl}/api/integrations/youtube/callback`;

export function authUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: env.googleClientId, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

interface TokenReply { access_token: string; refresh_token?: string; expires_in: number; error?: string; error_description?: string }

async function tokenRequest(body: Record<string, string>): Promise<TokenReply> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.googleClientId, client_secret: env.googleClientSecret, ...body }),
  });
  const j = (await r.json()) as TokenReply;
  if (!r.ok) {
    const msg = `Google said: ${j.error_description || j.error || r.status}`;
    if (j.error === 'invalid_grant') throw new PermanentError('The YouTube connection has expired or was revoked. Reconnect YouTube in Setup. ' + msg);
    throw new Error(msg);
  }
  return j;
}

export async function exchangeCode(code: string) {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
  if (!t.refresh_token) throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
  return t;
}

let cached: { token: string; exp: number } | null = null;
export async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const st = await getIntegration<{ refresh_token?: string }>('youtube');
  if (!st?.refresh_token) throw new PermanentError('YouTube is not connected. An admin can connect it in Setup → Video pipeline.');
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: st.refresh_token });
  cached = { token: t.access_token, exp: Date.now() + t.expires_in * 1000 };
  return t.access_token;
}

export async function channelInfo(token: string): Promise<{ id: string; title: string } | null> {
  const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const j = (await r.json()) as { items?: { id: string; snippet: { title: string } }[] };
  const c = j.items?.[0];
  return c ? { id: c.id, title: c.snippet.title } : null;
}

export async function saveConnection(refreshToken: string, accessTok: string) {
  const ch = await channelInfo(accessTok);
  await setIntegration('youtube', { refresh_token: refreshToken, channel_id: ch?.id || '', channel_title: ch?.title || '', connected_at: new Date().toISOString() });
  cached = null;
  return ch;
}

export interface UploadMeta { title: string; description: string; tags: string[]; privacy: 'private' | 'unlisted' | 'public' }

/** Opens a resumable upload session; the returned URL accepts the file in chunks (valid for about a week). */
export async function startSession(token: string, meta: UploadMeta, size: number, mime: string): Promise<string> {
  const r = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': mime || 'video/*',
    },
    body: JSON.stringify({
      snippet: { title: meta.title.slice(0, 100), description: meta.description.slice(0, 4900), tags: meta.tags.slice(0, 15), categoryId: '27' },
      status: { privacyStatus: meta.privacy, selfDeclaredMadeForKids: false },
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    if (r.status === 403 && /quota/i.test(t)) throw new Error('YouTube’s daily upload quota is used up. It will retry later.');
    throw new Error(`YouTube would not start the upload (${r.status}): ${t.slice(0, 300)}`);
  }
  const loc = r.headers.get('location');
  if (!loc) throw new Error('YouTube did not return an upload address.');
  return loc;
}

export type ChunkResult = { done: false; offset: number } | { done: true; videoId: string };

/** Sends bytes [start, start+chunk.length) of a file of `total` bytes. */
export async function sendChunk(session: string, chunk: Uint8Array, start: number, total: number, mime: string): Promise<ChunkResult> {
  const end = start + chunk.length - 1;
  const r = await fetch(session, {
    method: 'PUT',
    headers: { 'Content-Length': String(chunk.length), 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Type': mime || 'video/*' },
    body: chunk as unknown as BodyInit,
  });
  return readReply(r);
}

/** Asks YouTube how much it already has (used after a function run was cut short). */
export async function queryOffset(session: string, total: number): Promise<ChunkResult> {
  const r = await fetch(session, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${total}` } });
  return readReply(r);
}

async function readReply(r: Response): Promise<ChunkResult> {
  if (r.status === 308) {
    const m = /bytes=0-(\d+)/.exec(r.headers.get('range') || '');
    return { done: false, offset: m ? Number(m[1]) + 1 : 0 };
  }
  if (r.status === 200 || r.status === 201) {
    const j = (await r.json()) as { id?: string };
    if (!j.id) throw new Error('YouTube finished the upload but did not return a video id.');
    return { done: true, videoId: j.id };
  }
  if (r.status === 404 || r.status === 410) throw new SessionExpired();
  const t = await r.text();
  throw new Error(`YouTube upload failed (${r.status}): ${t.slice(0, 300)}`);
}
export class SessionExpired extends Error { constructor() { super('The YouTube upload session expired.'); } }
