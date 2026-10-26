// Starts the app with an in-memory demo database instead of PostgreSQL (nothing to set up).
import { spawn } from 'node:child_process';
const port = process.env.PORT || '3100';
const env = { ...process.env, MOCK_DB: '1', PIPELINE_WORKER: '0', JWT_SECRET: 'mock-secret-mock-secret-mock-secret-1234', NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`, NEXT_TELEMETRY_DISABLED: '1' };
const p = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', port], { stdio: 'inherit', env });
p.on('exit', c => process.exit(c ?? 0));
