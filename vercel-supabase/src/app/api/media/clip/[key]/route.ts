import fs from 'node:fs';
import { Readable } from 'node:stream';
import { filePath, sizeOf, verifyClipLink } from '@/lib/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Serves a cut clip to whoever holds a valid signed link (Instagram fetches the video from here). Supports range requests. */
export async function GET(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const key = decodeURIComponent((await ctx.params).key);
  const u = new URL(req.url);
  if (!/^[\w-]+\.mp4$/.test(key) || !verifyClipLink(key, Number(u.searchParams.get('exp')), u.searchParams.get('sig') || '')) return new Response('Not found', { status: 404 });
  const size = sizeOf('clips', key);
  if (!size) return new Response('Not found', { status: 404 });
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  let start = 0, end = size - 1, status = 200;
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : size - Number(range[2]);
    end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response('Range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    status = 206;
  }
  const stream = Readable.toWeb(fs.createReadStream(filePath('clips', key), { start, end })) as unknown as ReadableStream;
  return new Response(stream, {
    status,
    headers: {
      'Content-Type': 'video/mp4', 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=300',
      ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}
