import { Cloud, Download, Link2Off } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../api/client';
import { publicApi } from '../api/endpoints';
import type { Preview, PublicFile } from '../api/types';
import { FileIcon } from '../components/files/FileIcon';
import { PreviewBody } from '../components/files/PreviewBody';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { formatBytes, formatDateTime } from '../lib/format';

/**
 * Public page for "anyone with the link" (/s/:token). Works without logging in.
 * Shows a preview; the Download button only appears if the owner allowed it.
 */
export function SharedFilePage() {
  const { token = '' } = useParams();
  const [file, setFile] = useState<PublicFile | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([publicApi.file(token), publicApi.preview(token)])
      .then(([info, p]) => {
        if (cancelled) return;
        setFile(info.file);
        setPreview(p);
        document.title = `${info.file.name} - Drive`;
      })
      .catch((err) => {
        if (cancelled) return;
        const notFound = err instanceof ApiError && (err.status === 404 || err.status === 400);
        setError({ notFound, message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const download = async () => {
    setDownloading(true);
    try {
      const { url } = await publicApi.download(token);
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setError({ notFound: false, message: errorMessage(err) });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-slate-900">
      <header className="flex items-center gap-3 bg-slate-950 px-4 py-3 text-white">
        <Link to="/" className="flex items-center gap-2" aria-label="Drive home">
          <Cloud className="size-6 text-blue-400" aria-hidden />
        </Link>
        {file ? (
          <>
            <FileIcon mimeType={file.mimeType} />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-medium">{file.name}</h1>
              <p className="truncate text-xs text-slate-400">
                Shared by {file.ownerName} · {formatBytes(file.size)} · {formatDateTime(file.createdAt)}
              </p>
            </div>
            {file.allowDownload ? (
              <Button onClick={download} loading={downloading} className="!px-4">
                <Download className="size-4" aria-hidden /> Download
              </Button>
            ) : (
              <span className="hidden rounded-full bg-white/10 px-3 py-1 text-xs text-slate-300 sm:inline">View only</span>
            )}
          </>
        ) : (
          <span className="flex-1 text-sm text-slate-300">Drive</span>
        )}
      </header>

      <main className="flex min-h-0 flex-1 items-center justify-center p-4">
        {error ? (
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl bg-white px-8 py-8 text-center" role="alert">
            <Link2Off className="size-10 text-slate-400" aria-hidden />
            <h2 className="font-medium text-slate-800">
              {error.notFound ? 'This link is not available' : 'Something went wrong'}
            </h2>
            <p className="text-sm text-slate-500">
              {error.notFound
                ? 'The file may have been deleted, or the owner turned off link sharing.'
                : error.message}
            </p>
          </div>
        ) : !file || !preview ? (
          <Spinner className="size-10 text-white" />
        ) : (
          <PreviewBody
            preview={preview}
            name={file.name}
            mimeType={file.mimeType}
            size={file.size}
            onDownload={file.allowDownload ? download : null}
          />
        )}
      </main>
    </div>
  );
}
