'use client';
// Upload of a (large) recording to the server in pieces that can be resumed, and in-browser recording.
import { db } from './client';

const PIECE = 8 * 1024 * 1024;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Sends the file to /api/upload/<recording id> piece by piece. If the connection drops it asks the server how much it has and continues. */
export async function uploadRecording(file: Blob, recordingId: string, onProgress: (done: number, total: number) => void, signal?: { cancelled: boolean }): Promise<void> {
  const { data } = await db.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session has expired. Sign in again.');
  const url = `/api/upload/${recordingId}`, headers = { Authorization: `Bearer ${token}` };
  const have = async (): Promise<number> => {
    const r = await fetch(url, { headers });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as { error?: string }).error || 'The server did not accept the upload.');
    return (j as { size: number }).size;
  };
  let offset = await have();
  let failures = 0;
  while (offset < file.size) {
    if (signal?.cancelled) throw new Error('Upload cancelled.');
    const piece = file.slice(offset, Math.min(offset + PIECE, file.size));
    try {
      const r = await fetch(`${url}?offset=${offset}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: piece });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409 && typeof (j as { size?: number }).size === 'number') { offset = (j as { size: number }).size; continue; }   // the server is somewhere else: carry on from there
      if (!r.ok) throw new Error((j as { error?: string }).error || `Upload failed (${r.status}).`);
      offset = (j as { size: number }).size; failures = 0;
      onProgress(offset, file.size);
    } catch (e) {
      if (++failures > 6 || (e instanceof Error && /^Upload failed|accept|More data|Empty|Bad offset/.test(e.message))) throw e;
      await wait(Math.min(15000, 1000 * 2 ** failures));
      try { offset = await have(); } catch { /* try again on the next round */ }
    }
  }
  onProgress(file.size, file.size);
}

export type CaptureMode = 'camera' | 'screen';
export interface Capture { stream: MediaStream; recorder: MediaRecorder; chunks: Blob[]; mime: string; stop(): Promise<File>; cleanup(): void }

const MIMES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

/** Records the camera or the screen (with the microphone) in the browser. */
export async function startCapture(mode: CaptureMode, onStopped?: () => void): Promise<Capture> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot record. Use a recent Chrome, Edge or Safari, or upload a file instead.');
  const cleanups: (() => void)[] = [];
  let video: MediaStreamTrack;
  const audioSources: MediaStream[] = [];
  if (mode === 'screen') {
    if (!navigator.mediaDevices.getDisplayMedia) throw new Error('Screen recording is not available on this device. Use the camera or upload a file.');
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 24 }, audio: true });
    video = screen.getVideoTracks()[0];
    cleanups.push(() => screen.getTracks().forEach(t => t.stop()));
    if (screen.getAudioTracks().length) audioSources.push(new MediaStream(screen.getAudioTracks()));
    try { const mic = await navigator.mediaDevices.getUserMedia({ audio: true }); audioSources.push(mic); cleanups.push(() => mic.getTracks().forEach(t => t.stop())); } catch { /* recording without a microphone */ }
  } else {
    const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
    video = cam.getVideoTracks()[0];
    audioSources.push(new MediaStream(cam.getAudioTracks()));
    cleanups.push(() => cam.getTracks().forEach(t => t.stop()));
  }
  const tracks: MediaStreamTrack[] = [video];
  if (audioSources.length) {                                   // mix everything we can hear into one audio track
    const ctx = new AudioContext(), dest = ctx.createMediaStreamDestination();
    audioSources.forEach(s => ctx.createMediaStreamSource(s).connect(dest));
    tracks.push(...dest.stream.getAudioTracks());
    cleanups.push(() => { void ctx.close(); });
  }
  const stream = new MediaStream(tracks);
  const mime = MIMES.find(m => MediaRecorder.isTypeSupported(m)) || '';
  const recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 1_800_000, audioBitsPerSecond: 96_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  video.addEventListener('ended', () => { if (recorder.state !== 'inactive') recorder.stop(); onStopped?.(); });
  recorder.start(5000);
  const cleanup = () => cleanups.forEach(f => f());
  return {
    stream, recorder, chunks, mime: mime || 'video/webm', cleanup,
    stop: () => new Promise<File>(resolve => {
      const finish = () => { cleanup(); const type = (recorder.mimeType || mime || 'video/webm').split(';')[0]; resolve(new File(chunks, `class-${Date.now()}.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type })); };
      if (recorder.state === 'inactive') return finish();
      recorder.onstop = finish; recorder.stop();
    }),
  };
}
