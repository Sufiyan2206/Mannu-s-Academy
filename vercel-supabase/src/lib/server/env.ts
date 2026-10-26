// Server-side configuration. Read lazily so a missing optional value only matters where it is used.
import path from 'node:path';

export const env = {
  /** The public address of this app (used for the Google sign-in redirect and for links Instagram fetches). */
  get siteUrl() { return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, ''); },
  get cronSecret() { return process.env.CRON_SECRET || ''; },
  /** Where recordings and clips are kept on this server’s disk. */
  get storageDir() { return path.resolve(process.env.STORAGE_DIR || './storage'); },
  get googleClientId() { return need('GOOGLE_CLIENT_ID'); },
  get googleClientSecret() { return need('GOOGLE_CLIENT_SECRET'); },
  get graphVersion() { return process.env.META_GRAPH_VERSION || 'v23.0'; },
  get workerEnabled() { return process.env.PIPELINE_WORKER !== '0'; },
  get zoom() {
    return {
      accountId: process.env.ZOOM_ACCOUNT_ID || '', clientId: process.env.ZOOM_CLIENT_ID || '',
      clientSecret: process.env.ZOOM_CLIENT_SECRET || '', webhookSecret: process.env.ZOOM_WEBHOOK_SECRET_TOKEN || '',
    };
  },
};

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Add it to .env.local (see .env.example).`);
  return v;
}

/** An error that will not fix itself by retrying (for example "YouTube is not connected"). */
export class PermanentError extends Error {}
