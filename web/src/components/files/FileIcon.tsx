import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Presentation,
  type LucideIcon,
} from 'lucide-react';

const CODE_TYPES = ['application/json', 'application/xml', 'application/yaml', 'text/html', 'text/css', 'text/javascript', 'text/x-python'];

function iconFor(mimeType: string): { Icon: LucideIcon; color: string } {
  if (mimeType.startsWith('image/')) return { Icon: FileImage, color: 'text-rose-500' };
  if (mimeType.startsWith('video/')) return { Icon: FileVideo, color: 'text-red-600' };
  if (mimeType.startsWith('audio/')) return { Icon: FileAudio, color: 'text-violet-500' };
  if (mimeType === 'application/pdf') return { Icon: FileText, color: 'text-red-500' };
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv')
    return { Icon: FileSpreadsheet, color: 'text-green-600' };
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint'))
    return { Icon: Presentation, color: 'text-amber-500' };
  if (mimeType.includes('word') || mimeType.includes('opendocument.text') || mimeType === 'application/rtf')
    return { Icon: FileText, color: 'text-brand-500' };
  if (CODE_TYPES.includes(mimeType)) return { Icon: FileCode, color: 'text-slate-600' };
  if (mimeType.startsWith('text/')) return { Icon: FileText, color: 'text-slate-500' };
  if (/zip|rar|7z|tar|gzip/.test(mimeType)) return { Icon: FileArchive, color: 'text-amber-700' };
  return { Icon: File, color: 'text-slate-500' };
}

export function FileIcon({ mimeType, className = 'size-5' }: { mimeType: string; className?: string }) {
  const { Icon, color } = iconFor(mimeType);
  return <Icon className={`${className} ${color} shrink-0`} aria-hidden />;
}

export function FolderIcon({ className = 'size-5' }: { className?: string }) {
  return <Folder className={`${className} shrink-0 fill-slate-500 text-slate-500`} aria-hidden />;
}
