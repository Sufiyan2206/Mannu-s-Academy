// Where the full class recording is read from: a file on this server’s disk, or a Zoom cloud recording.
import { filePath, readRange, sizeOf } from './storage';
import { env, PermanentError } from './env';
import type { Recording } from '../types';

export interface Source {
  url: string;                 // a URL ffmpeg can read directly
  size: number;                // total bytes
  read(from: number, to: number): Promise<Uint8Array>;   // inclusive byte range
}

let zoomToken: { v: string; exp: number } | null = null;
async function zoomAccessToken(): Promise<string> {
  const z = env.zoom;
  if (!z.accountId || !z.clientId || !z.clientSecret) throw new PermanentError('Zoom credentials are missing (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET).');
  if (zoomToken && zoomToken.exp > Date.now() + 60_000) return zoomToken.v;
  const r = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(z.accountId)}`, {
    method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${z.clientId}:${z.clientSecret}`).toString('base64') },
  });
  const j = (await r.json()) as { access_token?: string; expires_in?: number; reason?: string };
  if (!r.ok || !j.access_token) throw new Error('Zoom would not give an access token: ' + (j.reason || r.status));
  zoomToken = { v: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

async function fetchRange(url: string, from: number, to: number): Promise<Uint8Array> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } });
      if (r.status === 206) return new Uint8Array(await r.arrayBuffer());
      if (r.status === 200 && from === 0) {
        const all = new Uint8Array(await r.arrayBuffer());
        if (all.length <= to + 1) return all;
        return all.subarray(0, to + 1);
      }
      if (r.status === 200) throw new PermanentError('The server holding the recording does not allow partial downloads, so it cannot be copied to YouTube in pieces. Upload the file in the app instead.');
      if (r.status >= 400 && r.status < 500) throw new PermanentError(`The recording could not be read (${r.status}). The link may have expired.`);
      last = new Error(`Reading the recording failed (${r.status}).`);
    } catch (e) { if (e instanceof PermanentError) throw e; last = e; }
    await new Promise(res => setTimeout(res, 1500 * (i + 1)));
  }
  throw last instanceof Error ? last : new Error('Reading the recording failed.');
}

export async function openSource(rec: Recording): Promise<Source> {
  if (rec.source_kind !== 'zoom') {
    if (!rec.source_path) throw new PermanentError('The recording file is missing (it may have been deleted).');
    const size = sizeOf('recordings', rec.source_path);
    if (!size) throw new PermanentError('The recording file was not found on the server (it may have been deleted).');
    const key = rec.source_path;
    return { url: filePath('recordings', key), size, read: (a, b) => readRange('recordings', key, a, Math.min(b, size - 1)) };
  }
  if (!rec.source_url) throw new PermanentError('This Zoom recording has no download link.');
  const url = `${rec.source_url}${rec.source_url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(await zoomAccessToken())}`;
  let size = rec.source_size ?? 0;
  if (!size) {
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    const m = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
    size = m ? Number(m[1]) : Number(r.headers.get('content-length') || 0);
    if (!size) throw new Error('Could not work out the size of the recording.');
  }
  return { url, size, read: (a, b) => fetchRange(url, a, b) };
}
