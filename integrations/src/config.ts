// Settings come from environment variables (see ../.env.example). The same JWT secret as the Flask API is used,
// so a user signed in through Flask is recognised here without a second login.
const env = (k: string, d = ''): string => process.env[k] ?? d

export const config = {
  port: Number(env('INTEGRATIONS_PORT', '5100')),
  databaseUrl: env('DATABASE_URL_NODE', 'mysql://mannus:mannus@127.0.0.1:3306/mannus'),
  jwtSecret: env('JWT_SECRET'),
  academy: env('ACADEMY_NAME', 'Mannu’s Tuition Academy'),
  tz: env('ACADEMY_TZ', 'Asia/Dubai'),
  // stage 3: WhatsApp, YouTube.  stage 4: Instagram, ffmpeg.
  workersEnabled: env('WORKERS', '1') === '1',
}

export function assertConfig(): void {
  if (!config.jwtSecret) throw new Error('JWT_SECRET is not set. Use the same value as the Flask API.')
}
