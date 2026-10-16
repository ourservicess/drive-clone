import { Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client';
import { filesApi } from '../../api/endpoints';
import type { FileItem, Preview } from '../../api/types';
import { IconButton } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { FileIcon } from './FileIcon';
import { PreviewBody } from './PreviewBody';

interface Props {
  file: FileItem | null;
  onClose: () => void;
  onDownload: (file: FileItem) => void;
}

/** Full-screen viewer for the owner's own files. */
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
        ) : (
          <PreviewBody
            preview={preview}
            name={file.name}
            mimeType={file.mimeType}
            size={file.size}
            onDownload={() => onDownload(file)}
          />
        )}
      </div>
    </div>
  );
}
