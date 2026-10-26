import { NextResponse } from 'next/server';
import { deleteIntegration, getIntegration } from '@/lib/server/admin';
import { env } from '@/lib/server/env';
import { exchangeCode, saveConnection } from '@/lib/server/youtube';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Step 2: Google sends the admin back here with a one-time code. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(`${env.siteUrl}/settings?${q}`);
  try {
    if (url.searchParams.get('error')) return back('youtube=error&msg=' + encodeURIComponent('Google said: ' + url.searchParams.get('error')));
    const st = await getIntegration<{ state: string; expires: number }>('youtube_oauth');
    await deleteIntegration('youtube_oauth');
    if (!st || st.state !== url.searchParams.get('state') || st.expires < Date.now()) return back('youtube=error&msg=' + encodeURIComponent('That sign-in link expired. Try connecting again.'));
    const code = url.searchParams.get('code');
    if (!code) return back('youtube=error&msg=' + encodeURIComponent('Google did not send a code.'));
    const t = await exchangeCode(code);
    await saveConnection(t.refresh_token as string, t.access_token);
    return back('youtube=connected');
  } catch (e) {
    return back('youtube=error&msg=' + encodeURIComponent(e instanceof Error ? e.message : 'Could not connect YouTube.'));
  }
}
