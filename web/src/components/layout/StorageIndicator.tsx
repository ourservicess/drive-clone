import { Cloud } from 'lucide-react';
import { useDrive } from '../../context/DriveContext';
import { formatBytes } from '../../lib/format';

export function StorageIndicator() {
  const { usage } = useDrive();
  if (!usage) return null;

  const percent = Math.min(100, (usage.used / usage.quota) * 100);
  const color = percent > 90 ? 'bg-red-500' : percent > 75 ? 'bg-amber-500' : 'bg-brand-500';

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-sm text-slate-700">
        <Cloud className="size-4" aria-hidden />
        Storage ({Math.round(percent)}% full)
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div className={`h-full ${color}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {formatBytes(usage.used)} of {formatBytes(usage.quota)} used
      </p>
    </div>
  );
}
