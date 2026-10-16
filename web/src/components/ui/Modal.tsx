import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconButton } from './Button';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' };

/**
 * Accessible dialog: closes on Escape or backdrop click, moves focus inside
 * when opened, keeps Tab inside, and returns focus where it was when closed.
 */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'input, button:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    // Prefer the first text field, otherwise the first button.
    (panel?.querySelector<HTMLElement>('input, textarea') ?? focusables()[0])?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab') {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex max-h-[90vh] w-full ${widths[size]} flex-col rounded-2xl bg-white shadow-xl`}
      >
        <div className="flex items-center justify-between gap-2 px-6 pt-5 pb-2">
          <h2 id={titleId} className="text-lg font-medium text-slate-900">
            {title}
          </h2>
          <IconButton label="Close dialog" onClick={onClose} className="-mr-2">
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-6 py-2">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-6 pt-3 pb-5">{footer}</div>}
      </div>
    </div>
  );
}
