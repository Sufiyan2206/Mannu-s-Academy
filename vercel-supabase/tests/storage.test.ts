import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let dir = '';
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mannus-store-'));
  process.env.STORAGE_DIR = dir; process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234'; process.env.NEXT_PUBLIC_SITE_URL = 'https://academy.example.com';
});

describe('files on the server disk', () => {
  it('writes in pieces at the right place, reads ranges back, and refuses paths that leave the folder', async () => {
    const s = await import('../src/lib/server/storage');
    expect(await s.writeAt('recordings', 'u1/a.bin', 0, Uint8Array.from([1, 2, 3, 4]))).toBe(4);
    expect(await s.writeAt('recordings', 'u1/a.bin', 4, Uint8Array.from([5, 6]))).toBe(6);
    expect(s.sizeOf('recordings', 'u1/a.bin')).toBe(6);
    expect([...await s.readRange('recordings', 'u1/a.bin', 2, 4)]).toEqual([3, 4, 5]);
    expect(() => s.filePath('recordings', '../../etc/passwd')).toThrow(/Invalid file name/);
    expect(s.sizeOf('recordings', 'nope')).toBe(0);
  });

  it('signs clip links that expire and cannot be changed', async () => {
    const s = await import('../src/lib/server/storage');
    const u = new URL(s.signedClipUrl('abc.mp4', 60));
    expect(u.origin).toBe('https://academy.example.com'); expect(u.pathname).toBe('/api/media/clip/abc.mp4');
    const exp = Number(u.searchParams.get('exp')), sig = u.searchParams.get('sig') as string;
    expect(s.verifyClipLink('abc.mp4', exp, sig)).toBe(true);
    expect(s.verifyClipLink('other.mp4', exp, sig)).toBe(false);
    expect(s.verifyClipLink('abc.mp4', exp + 1, sig)).toBe(false);
    expect(s.verifyClipLink('abc.mp4', Math.floor(Date.now() / 1000) - 5, sig)).toBe(false);
  });

  it('cuts a real recording from the local file into a stored clip', async () => {
    const { run, ffmpegPath, durationOf } = await import('../src/lib/server/ffmpeg');
    const { realGateways } = await import('../src/lib/server/runtime');
    const s = await import('../src/lib/server/storage');
    const { openSource } = await import('../src/lib/server/source');
    const src = s.filePath('recordings', 'u1/class.mp4');
    fs.mkdirSync(path.dirname(src), { recursive: true });
    const made = await run(await ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src], 60_000);
    expect(made.code).toBe(0);
    const rec = { id: '11111111-1111-4111-8111-111111111111', source_kind: 'upload', source_path: 'u1/class.mp4', source_size: null, trim_start_sec: 2, trim_len_sec: 5 } as never;
    const source = await openSource(rec);
    expect(source.size).toBe(fs.statSync(src).size);
    expect((await source.read(0, 3)).length).toBe(4);
    const cut = await realGateways.cutClip(source, rec, 120_000);
    expect(cut.path).toBe('11111111-1111-4111-8111-111111111111.mp4'); expect(cut.seconds).toBeGreaterThan(4.5); expect(cut.seconds).toBeLessThan(5.6);
    expect(await durationOf(s.filePath('clips', cut.path))).toBeGreaterThan(4.5);
    expect(await realGateways.clipUrl(cut.path)).toMatch(/^https:\/\/academy\.example\.com\/api\/media\/clip\//);
  }, 180_000);
});
