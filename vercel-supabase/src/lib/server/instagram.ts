// Instagram Graph API: publish a Reel from a public video URL, then read its link and numbers.
import { env, PermanentError } from './env';
import { getIntegration, setIntegration } from './admin';

const G = () => `https://graph.facebook.com/${env.graphVersion}`;

export interface IgConnection { token: string; igUserId: string; username?: string }

export async function connection(): Promise<IgConnection> {
  const st = await getIntegration<{ access_token?: string; ig_user_id?: string; username?: string }>('instagram');
  if (!st?.access_token || !st.ig_user_id) throw new PermanentError('Instagram is not connected. An admin can connect it in Setup → Video pipeline.');
  return { token: st.access_token, igUserId: st.ig_user_id, username: st.username };
}

async function graph<T>(path: string, init?: { method?: 'GET' | 'POST'; params?: Record<string, string>; token: string }): Promise<T> {
  const method = init?.method || 'GET', params = { ...(init?.params || {}), access_token: init!.token };
  const url = `${G()}/${path}`;
  const r = method === 'GET'
    ? await fetch(`${url}?${new URLSearchParams(params)}`)
    : await fetch(url, { method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = (await r.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_subcode?: number } } & T;
  if (!r.ok || j.error) {
    const e = j.error;
    const msg = `Instagram said: ${e?.message || r.status}`;
    // 190 = token expired/invalid, 200/10 = permission missing
    if (e?.code === 190) throw new PermanentError('The Instagram access token has expired. Create a new one and paste it in Setup. ' + msg);
    if (e?.code === 10 || e?.code === 200) throw new PermanentError('Instagram has not given this app permission to publish. ' + msg);
    throw new Error(msg);
  }
  return j;
}

/** Checks the pasted token and returns the account name. */
export async function verify(token: string, igUserId: string): Promise<{ username: string }> {
  const j = await graph<{ username?: string }>(igUserId, { token, params: { fields: 'username' } });
  return { username: j.username || '' };
}
export async function saveConnection(token: string, igUserId: string, username: string) {
  await setIntegration('instagram', { access_token: token, ig_user_id: igUserId, username, connected_at: new Date().toISOString() });
}

export async function createReelContainer(c: IgConnection, videoUrl: string, caption: string): Promise<string> {
  const j = await graph<{ id: string }>(`${c.igUserId}/media`, { method: 'POST', token: c.token, params: { media_type: 'REELS', video_url: videoUrl, caption, share_to_feed: 'true' } });
  return j.id;
}

export type ContainerStatus = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';
export async function containerStatus(c: IgConnection, id: string): Promise<{ code: ContainerStatus; detail: string }> {
  const j = await graph<{ status_code: ContainerStatus; status?: string }>(id, { token: c.token, params: { fields: 'status_code,status' } });
  return { code: j.status_code, detail: j.status || '' };
}

export async function publish(c: IgConnection, containerId: string): Promise<string> {
  const j = await graph<{ id: string }>(`${c.igUserId}/media_publish`, { method: 'POST', token: c.token, params: { creation_id: containerId } });
  return j.id;
}

export async function permalink(c: IgConnection, mediaId: string): Promise<string> {
  const j = await graph<{ permalink?: string }>(mediaId, { token: c.token, params: { fields: 'permalink' } });
  return j.permalink || '';
}

export interface Metrics { views: number | null; reach: number | null; likes: number | null; comments: number | null; shares: number | null; saved: number | null }
export async function insights(c: IgConnection, mediaId: string): Promise<Metrics> {
  const j = await graph<{ data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(`${mediaId}/insights`, { token: c.token, params: { metric: 'views,reach,likes,comments,shares,saved' } });
  const get = (n: string) => { const m = j.data?.find(x => x.name === n); return m ? (m.values?.[0]?.value ?? m.total_value?.value ?? null) : null; };
  return { views: get('views'), reach: get('reach'), likes: get('likes'), comments: get('comments'), shares: get('shares'), saved: get('saved') };
}
