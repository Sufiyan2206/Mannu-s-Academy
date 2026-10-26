import { getIntegration, jsonError, requireUser } from '@/lib/server/admin';
import { env } from '@/lib/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What is connected, for the Setup screen. Never returns a secret. */
export async function GET(req: Request) {
  try {
    await requireUser(req, true);
    const [yt, ig, st] = await Promise.all([
      getIntegration<{ channel_title?: string; connected_at?: string }>('youtube'),
      getIntegration<{ username?: string; connected_at?: string }>('instagram'),
      getIntegration<{ metrics_at?: string }>('pipeline_state'),
    ]);
    return Response.json({
      youtube: { configured: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET, connected: !!yt, channel: yt?.channel_title || '', since: yt?.connected_at || null },
      instagram: { connected: !!ig, username: ig?.username || '', since: ig?.connected_at || null },
      zoom: { configured: !!(env.zoom.accountId && env.zoom.clientId && env.zoom.clientSecret), webhook: !!env.zoom.webhookSecret },
      scheduler: { cron_secret_set: !!env.cronSecret, metrics_checked_at: st?.metrics_at || null },
      site_url: env.siteUrl,
    });
  } catch (e) { return jsonError(e); }
}
