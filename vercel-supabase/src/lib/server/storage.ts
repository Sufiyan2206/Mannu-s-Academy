// Files (class recordings and cut clips) live on this server's disk under STORAGE_DIR.
import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';

export type Bucket = 'recordings' | 'clips';

/** Absolute path of a stored file. Refuses anything that would leave the storage folder. */
export function filePath(bucket: Bucket, key: string): string {
  const root = path.join(env.storageDir, bucket);
  const p = path.resolve(root, key);
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('Invalid file name.');
  return p;
}

export function sizeOf(bucket: Bucket, key: string): number {
  try { return fs.statSync(filePath(bucket, key)).size; } catch { return 0; }
}

/** Writes bytes at a position (for resumable uploads). */
export async function writeAt(bucket: Bucket, key: string, offset: number, data: Uint8Array): Promise<number> {
  const p = filePath(bucket, key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const fd = fs.openSync(p, fs.existsSync(p) ? 'r+' : 'w+');
  try { fs.writeSync(fd, data, 0, data.length, offset); } finally { fs.closeSync(fd); }
  return offset + data.length;
}

export async function readRange(bucket: Bucket, key: string, from: number, to: number): Promise<Uint8Array> {
  const fh = await fs.promises.open(filePath(bucket, key), 'r');
  try {
    const buf = Buffer.alloc(to - from + 1);
    const { bytesRead } = await fh.read(buf, 0, buf.length, from);
    return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
  } finally { await fh.close(); }
}

export function remove(bucket: Bucket, key: string) { fs.rmSync(filePath(bucket, key), { force: true }); }

export function put(bucket: Bucket, key: string, from: string) {
  const dest = filePath(bucket, key);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(from, dest);
}

// ---------------------------------------------------------------- signed links (so Instagram, or a browser tab, can fetch a clip)
const secret = () => process.env.JWT_SECRET || '';
const mac = (key: string, exp: number) => createHmac('sha256', secret()).update(`clip:${key}:${exp}`).digest('hex');

export function signedClipUrl(key: string, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${env.siteUrl}/api/media/clip/${encodeURIComponent(key)}?exp=${exp}&sig=${mac(key, exp)}`;
}
export function verifyClipLink(key: string, exp: number, sig: string): boolean {
  if (!exp || exp < Date.now() / 1000 || !secret()) return false;
  const want = mac(key, exp);
  return want.length === sig.length && timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}
