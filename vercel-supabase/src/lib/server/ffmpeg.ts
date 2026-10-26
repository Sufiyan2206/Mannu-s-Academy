// ffmpeg: cut the Reel out of the class recording as a vertical 1080x1920 MP4 (what Instagram expects).
import { spawn } from 'node:child_process';
import { accessSync, chmodSync, constants, copyFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TrimOptions { input: string; output: string; startSec: number; lengthSec: number }

const CA_FILES = ['/etc/pki/tls/certs/ca-bundle.crt', '/etc/ssl/certs/ca-certificates.crt', '/etc/ssl/cert.pem'];
/** The static ffmpeg build does not know where the system certificates live, so point it at them for https inputs. */
export function tlsArgs(input: string, exists: (p: string) => boolean = existsSync): string[] {
  if (!/^https:/i.test(input)) return [];
  if (process.env.FFMPEG_TLS_VERIFY === '0') return ['-tls_verify', '0'];
  const ca = process.env.FFMPEG_CA_FILE || CA_FILES.find(exists);
  return ca ? ['-ca_file', ca] : [];
}

/**
 * -ss before -i makes ffmpeg jump to the start (for web URLs it only downloads what it needs).
 * Landscape classes are shown full-width over a blurred copy of themselves; portrait video fills the frame.
 */
export function trimArgs(o: TrimOptions): string[] {
  const filter =
    '[0:v]split=2[a][b];' +
    '[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:6[bg];' +
    '[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];' +
    '[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]';
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...tlsArgs(o.input), '-ss', String(Math.max(0, o.startSec)), '-i', o.input, '-t', String(o.lengthSec),
    '-filter_complex', filter, '-map', '[v]', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-r', '30', '-profile:v', 'high', '-level', '4.0',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart', '-t', String(o.lengthSec), o.output,
  ];
}

export async function ffmpegPath(): Promise<string> {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const mod = (await import('@ffmpeg-installer/ffmpeg')) as { path?: string; default?: { path: string } };
  const p = mod.default?.path || mod.path;
  if (!p || !existsSync(p)) throw new Error('ffmpeg is not available on this server.');
  try { accessSync(p, constants.X_OK); return p; } catch {
    // some deployments drop the executable bit; run a copy from the temp folder instead
    const copy = path.join(os.tmpdir(), 'ffmpeg-bin');
    if (!existsSync(copy)) { copyFileSync(p, copy); chmodSync(copy, 0o755); }
    return copy;
  }
}

export function run(bin: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg took too long and was stopped.')); }, timeoutMs);
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => { clearTimeout(timer); resolve({ code, stderr }); });
  });
}

export async function trim(o: TrimOptions, timeoutMs: number): Promise<void> {
  const bin = await ffmpegPath();
  const { code, stderr } = await run(bin, trimArgs(o), timeoutMs);
  if (code !== 0) throw new Error('ffmpeg could not cut the clip: ' + (stderr.trim().split('\n').slice(-3).join(' ') || `exit code ${code}`));
}

/** Duration of a media file in seconds (read from ffmpeg’s banner; ffprobe is not shipped). */
export async function durationOf(file: string): Promise<number | null> {
  const bin = await ffmpegPath();
  const { stderr } = await run(bin, ['-hide_banner', '-i', file], 30_000).catch(() => ({ stderr: '' }));
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  return m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : null;
}
