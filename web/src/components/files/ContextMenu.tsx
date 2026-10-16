import type { LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  dividerBefore?: boolean;
}

interface Props {
  x: number;
  y: number;
  actions: MenuAction[];
  onClose: () => void;
  label: string;
}

/**
 * Floating menu used for right-click and the "more actions" button.
 * Keyboard: arrow keys move, Enter selects, Escape closes.
 */
export function ContextMenu({ x, y, actions, onClose, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu fully inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [x, y]);

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 min-w-52 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl"
    >
      {actions.map((action) => (
        <div key={action.label}>
          {action.dividerBefore && <div className="my-1.5 border-t border-slate-200" role="separator" />}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              action.onSelect();
            }}
            className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none ${action.danger ? 'text-red-600' : 'text-slate-700'}`}
          >
            <action.icon className="size-4" aria-hidden />
            {action.label}
          </button>
        </div>
      ))}
    </div>
  );
}
