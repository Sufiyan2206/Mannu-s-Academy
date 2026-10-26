declare module '@ffmpeg-installer/ffmpeg' {
  export const path: string;
  export const version: string;
  const installer: { path: string; version: string };
  export default installer;
}
