import { Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client';
import { filesApi } from '../../api/endpoints';
import type { FileItem, Preview } from '../../api/types';
import { formatBytes } from '../../lib/format';
import { Button, IconButton } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { FileIcon } from './FileIcon';

interface Props {
  file: FileItem | null;
  onClose: () => void;
  onDownload: (file: FileItem) => void;
}

/**
 * Full-screen viewer. Images/PDF/video/audio load from a short-lived R2 URL.
 * Text (including HTML and SVG source) is rendered inside <pre> as plain text,
 * so uploaded active content is never executed in our page.
 */
export function PreviewModal({ file, onClose, onDownload }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setPreview(null);
    setError(null);
    filesApi
      .preview(file.id)
      .then((p) => !cancelled && setPreview(p))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      document.removeEventListener('keydown', onKey);
    };
  }, [file, onClose]);

  if (!file) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${file.name}`}
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/90"
    >
      <header className="flex items-center gap-3 px-4 py-3 text-white">
        <FileIcon mimeType={file.mimeType} />
        <h2 className="flex-1 truncate text-sm font-medium">{file.name}</h2>
        <IconButton label="Download" onClick={() => onDownload(file)} className="text-white hover:bg-white/10">
          <Download className="size-5" />
        </IconButton>
        <IconButton label="Close preview" onClick={onClose} className="text-white hover:bg-white/10" autoFocus>
          <X className="size-5" />
        </IconButton>
      </header>

      <div
        className="flex min-h-0 flex-1 items-center justify-center p-4"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        {error ? (
          <p className="rounded-lg bg-white px-6 py-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : !preview ? (
          <Spinner className="size-10 text-white" />
        ) : preview.kind === 'image' ? (
          <img src={preview.url} alt={file.name} className="max-h-full max-w-full object-contain" />
        ) : preview.kind === 'pdf' ? (
          <iframe src={preview.url} title={file.name} className="size-full max-w-5xl rounded bg-white" />
        ) : preview.kind === 'video' ? (
          <video src={preview.url} controls autoPlay className="max-h-full max-w-full">
            <track kind="captions" />
          </video>
        ) : preview.kind === 'audio' ? (
          <div className="rounded-xl bg-white p-6">
            <audio src={preview.url} controls autoPlay />
          </div>
        ) : preview.kind === 'text' ? (
          <div className="flex size-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white">
            {preview.truncated && (
              <p className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-800">
                Only the first 1 MB is shown. Download the file to see all of it.
              </p>
            )}
            <pre className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-800">
              {preview.content}
            </pre>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-white px-10 py-8 text-center">
            <FileIcon mimeType={file.mimeType} className="size-16" />
            <div>
              <p className="font-medium text-slate-800">No preview available</p>
              <p className="text-sm text-slate-500">{formatBytes(file.size)}</p>
            </div>
            <Button onClick={() => onDownload(file)}>
              <Download className="size-4" aria-hidden /> Download
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
