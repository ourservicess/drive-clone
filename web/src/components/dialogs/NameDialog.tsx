import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../../api/client';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface Props {
  open: boolean;
  title: string;
  initialName: string;
  confirmLabel: string;
  /** For files, pre-select only the part before the extension (like Drive). */
  selectBaseName?: boolean;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}

/** Used for "New folder" and "Rename". */
export function NameDialog({ open, title, initialName, confirmLabel, selectBaseName, onSubmit, onClose }: Props) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setError(null);
    // Wait for the modal to focus the input, then select the name.
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      const dot = initialName.lastIndexOf('.');
      input.setSelectionRange(0, selectBaseName && dot > 0 ? dot : initialName.length);
    });
  }, [open, initialName, selectBaseName]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name cannot be empty');
      return;
    }
    if (/[/\\]/.test(trimmed)) {
      setError('Name cannot contain / or \\');
      return;
    }
    setBusy(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <form onSubmit={submit} noValidate>
        <label htmlFor="item-name" className="sr-only">
          Name
        </label>
        <input
          id="item-name"
          ref={inputRef}
          value={name}
          maxLength={255}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'item-name-error' : undefined}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 focus:outline-none"
        />
        {error && (
          <p id="item-name-error" className="mt-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-5 pb-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
