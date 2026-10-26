// Tiny .env loader for the helper scripts (Next.js loads .env.local itself for the app).
import fs from 'node:fs';
import path from 'node:path';
export function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    const p = path.resolve(f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
