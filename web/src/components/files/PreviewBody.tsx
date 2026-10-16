import { Download } from 'lucide-react';
import type { Preview } from '../../api/types';
import { formatBytes } from '../../lib/format';
import { Button } from '../ui/Button';
import { FileIcon } from './FileIcon';

interface Props {
  preview: Preview;
  name: string;
  mimeType: string;
  size: number;
  /** null = no download allowed (view-only share link) */
  onDownload: (() => void) | null;
}

/**
 * Shows a file preview. Images/PDF/video/audio load from a short-lived link;
 * text (including HTML and SVG source) is shown inside <pre> as plain text,
 * so uploaded active content is never executed.
 * Used by the in-app viewer and by the public share page.
 */
export function PreviewBody({ preview, name, mimeType, size, onDownload }: Props) {
  const viewOnly = onDownload === null;

  switch (preview.kind) {
    case 'image':
      return (
        <img
          src={preview.url}
          alt={name}
          className="max-h-full max-w-full object-contain"
          // In view-only mode, discourage "Save image as…" (cannot be fully prevented).
          onContextMenu={viewOnly ? (e) => e.preventDefault() : undefined}
          draggable={!viewOnly}
        />
      );
    case 'pdf':
      // "#toolbar=0" hides the download/print bar in Chrome's and Edge's PDF viewer.
      return (
        <iframe
          src={viewOnly ? `${preview.url}#toolbar=0` : preview.url}
          title={name}
          className="size-full max-w-5xl rounded bg-white"
        />
      );
    case 'video':
      return (
        <video
          src={preview.url}
          controls
          autoPlay
          className="max-h-full max-w-full"
          controlsList={viewOnly ? 'nodownload' : undefined}
          onContextMenu={viewOnly ? (e) => e.preventDefault() : undefined}
        >
          <track kind="captions" />
        </video>
      );
    case 'audio':
      return (
        <div className="rounded-xl bg-white p-6">
          <audio src={preview.url} controls autoPlay controlsList={viewOnly ? 'nodownload' : undefined} />
        </div>
      );
    case 'text':
      return (
        <div className="flex size-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white">
          {preview.truncated && (
            <p className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-800">
              Only the first 1 MB is shown.{viewOnly ? '' : ' Download the file to see all of it.'}
            </p>
          )}
          <pre className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-800">
            {preview.content}
          </pre>
        </div>
      );
    default:
      return (
        <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl bg-white px-10 py-8 text-center">
          <FileIcon mimeType={mimeType} className="size-16" />
          <div>
            <p className="font-medium text-slate-800">No preview available</p>
            <p className="text-sm text-slate-500">{formatBytes(size)}</p>
            {viewOnly && (
              <p className="mt-2 text-sm text-slate-500">
                This type of file can't be shown in the browser, and downloading is turned off.
              </p>
            )}
          </div>
          {onDownload && (
            <Button onClick={onDownload}>
              <Download className="size-4" aria-hidden /> Download
            </Button>
          )}
        </div>
      );
  }
}
