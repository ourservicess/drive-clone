/**
 * Allowed upload types. The MIME type is decided by the SERVER from the file
 * extension, never taken from the browser, and anything not listed here
 * (for example .exe, .bat, .ps1, .dll) is rejected.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  // images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml', // stored, but never rendered inline (can contain scripts)
  heic: 'image/heic',
  // documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  epub: 'application/epub+zip',
  // text & code (shown as plain text, never executed)
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  log: 'text/plain',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/plain',
  tsx: 'text/plain',
  jsx: 'text/plain',
  py: 'text/x-python',
  java: 'text/plain',
  c: 'text/plain',
  cpp: 'text/plain',
  h: 'text/plain',
  cs: 'text/plain',
  go: 'text/plain',
  rs: 'text/plain',
  sql: 'text/plain',
  // audio / video
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  // archives
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
};

export function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

/** Returns the MIME type for an allowed file, or null if the type is not allowed. */
export function mimeTypeFor(filename: string): string | null {
  return MIME_BY_EXTENSION[getExtension(filename)] ?? null;
}

export function allowedExtensions(): string[] {
  return Object.keys(MIME_BY_EXTENSION);
}

export type PreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'none';

// Only these are allowed to render inline in the browser. SVG and HTML are
// deliberately missing: they can contain scripts, so they are shown as text.
const INLINE_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/x-icon']);
const INLINE_VIDEO = new Set(['video/mp4', 'video/webm']);
const INLINE_AUDIO = new Set(['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/flac']);
const TEXT_TYPES = new Set(['application/json', 'application/xml', 'application/yaml', 'image/svg+xml']);

export function previewKindFor(mimeType: string): PreviewKind {
  if (INLINE_IMAGE.has(mimeType)) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (INLINE_VIDEO.has(mimeType)) return 'video';
  if (INLINE_AUDIO.has(mimeType)) return 'audio';
  if (mimeType.startsWith('text/') || TEXT_TYPES.has(mimeType)) return 'text';
  return 'none';
}
