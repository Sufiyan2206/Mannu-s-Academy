import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { durationOf, ffmpegPath, run, tlsArgs, trim, trimArgs } from '../src/lib/server/ffmpeg';

describe('ffmpeg clip cutting', () => {
  it('builds arguments that seek first and cap the length', () => {
    const a = trimArgs({ input: 'https://x/y.mp4', output: '/tmp/o.mp4', startSec: 30, lengthSec: 60 });
    expect(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 4)).toEqual(['-ss', '30', '-i', 'https://x/y.mp4']);
    expect(a).toContain('libx264'); expect(a).toContain('+faststart'); expect(a.join(' ')).toContain('1080:1920');
  });

  it('gives ffmpeg the system certificates for https inputs only', () => {
    expect(tlsArgs('https://x/y.mp4', p => p === '/etc/ssl/certs/ca-certificates.crt')).toEqual(['-ca_file', '/etc/ssl/certs/ca-certificates.crt']);
    expect(tlsArgs('https://x/y.mp4', () => false)).toEqual([]);
    expect(tlsArgs('/tmp/local.mp4', () => true)).toEqual([]);
  });

  it('cuts a landscape recording into a vertical 1080x1920 clip of the requested length', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mannus-ff-'));
    const src = path.join(dir, 'class.mp4'), out = path.join(dir, 'clip.mp4');
    const bin = await ffmpegPath();
    const made = await run(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src], 60_000);
    expect(made.code).toBe(0);
    await trim({ input: src, output: out, startSec: 4, lengthSec: 6 }, 120_000);
    const dur = await durationOf(out);
    expect(dur).toBeGreaterThan(5.5); expect(dur).toBeLessThan(6.6);
    const info = await run(bin, ['-hide_banner', '-i', out], 30_000);
    expect(info.stderr).toMatch(/1080x1920/); expect(info.stderr).toMatch(/Audio: aac/); expect(info.stderr).toMatch(/h264/);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 180_000);

  it('reports a readable error when the input is missing', async () => {
    await expect(trim({ input: path.join(os.tmpdir(), 'nope-does-not-exist.mp4'), output: path.join(os.tmpdir(), 'x.mp4'), startSec: 0, lengthSec: 5 }, 30_000)).rejects.toThrow(/could not cut the clip/);
  });
});
