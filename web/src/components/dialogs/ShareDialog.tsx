import { Check, Copy, Globe, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client';
import { sharesApi } from '../../api/endpoints';
import type { FileItem, Share } from '../../api/types';
import { useDrive } from '../../context/DriveContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

/** "Anyone with the link can view" settings for one file. */
export function ShareDialog({ file, onClose }: { file: FileItem | null; onClose: () => void }) {
  const { refresh } = useDrive();
  const { toast } = useToast();
  const [share, setShare] = useState<Share | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setLoading(true);
    setCopied(false);
    sharesApi
      .get(file.id)
      .then((res) => !cancelled && setShare(res.share))
      .catch((err) => !cancelled && toast(errorMessage(err), 'error'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [file, toast]);

  if (!file) return null;
  const link = share ? `${window.location.origin}/s/${share.token}` : '';

  const change = async (task: () => Promise<Share | null>) => {
    setBusy(true);
    try {
      setShare(await task());
      refresh(); // updates the "shared" icon on the file
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Could not copy automatically. Select the link and copy it.', 'error');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Share "${file.name}"`}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {loading ? (
        <div className="flex justify-center py-8 text-brand-500">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-start gap-3">
            <div
              className={`flex size-10 shrink-0 items-center justify-center rounded-full ${share ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}
            >
              {share ? <Globe className="size-5" aria-hidden /> : <Lock className="size-5" aria-hidden />}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-800">
                {share ? 'Anyone with the link can view' : 'Only you can access this file'}
              </p>
              <p className="text-xs text-slate-500">
                {share
                  ? 'People with the link can open a preview in their browser without signing in.'
                  : 'Turn on link sharing to let others preview it.'}
              </p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <span className="sr-only">Anyone with the link can view</span>
              <input
                type="checkbox"
                role="switch"
                className="peer sr-only"
                checked={!!share}
                disabled={busy}
                onChange={(e) =>
                  change(async () => {
                    if (e.target.checked) return (await sharesApi.save(file.id, false)).share;
                    await sharesApi.remove(file.id);
                    return null;
                  })
                }
              />
              <span className="h-6 w-11 rounded-full bg-slate-300 transition-colors peer-checked:bg-brand-500 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
            </label>
          </div>

          {share && (
            <>
              <div className="flex gap-2">
                <label htmlFor="share-link" className="sr-only">
                  Share link
                </label>
                <input
                  id="share-link"
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                />
                <Button variant="secondary" onClick={copy} className="!px-3">
                  {copied ? <Check className="size-4 text-green-600" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>

              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-brand-500"
                  checked={share.allowDownload}
                  disabled={busy}
                  onChange={(e) => {
                    const allow = e.target.checked;
                    void change(async () => (await sharesApi.save(file.id, allow)).share);
                  }}
                />
                <span>
                  <span className="font-medium text-slate-800">Allow viewers to download</span>
                  <span className="block text-xs text-slate-500">
                    When off, viewers only get a preview with no download button. (Anyone who can see a file can still
                    take a screenshot or save what is shown.)
                  </span>
                </span>
              </label>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
