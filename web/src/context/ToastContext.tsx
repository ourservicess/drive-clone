import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Tone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

interface ToastApi {
  toast: (message: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: Tone = 'info') => {
      const id = nextId++;
      setToasts((list) => [...list.slice(-3), { id, message, tone }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 3500);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* aria-live makes screen readers announce new notifications */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 left-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
      >
        {toasts.map((t) => {
          const Icon = t.tone === 'error' ? CircleAlert : t.tone === 'success' ? CircleCheck : Info;
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className="animate-toast-in pointer-events-auto flex items-start gap-3 rounded-lg bg-slate-800 px-4 py-3 text-sm text-white shadow-lg"
            >
              <Icon
                className={`mt-0.5 size-4 shrink-0 ${t.tone === 'error' ? 'text-red-300' : t.tone === 'success' ? 'text-green-300' : 'text-blue-200'}`}
                aria-hidden
              />
              <span className="flex-1 break-words">{t.message}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="rounded p-0.5 text-slate-300 hover:text-white"
                aria-label="Dismiss notification"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
