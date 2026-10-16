import { Clock, CloudUpload, HardDrive, Star, Trash2, X, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { IconButton } from '../ui/Button';
import { NewMenu } from './NewMenu';
import { StorageIndicator } from './StorageIndicator';

const links: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/drive', label: 'My Drive', icon: HardDrive },
  { to: '/recent', label: 'Recent', icon: Clock },
  { to: '/starred', label: 'Starred', icon: Star },
  { to: '/uploads', label: 'Uploads', icon: CloudUpload },
  { to: '/trash', label: 'Trash', icon: Trash2 },
];

/** Left navigation. On small screens it slides in as a drawer. */
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={onClose} aria-hidden />}
      <aside
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-surface pt-3 transition-transform lg:static lg:z-auto lg:translate-x-0 ${
          open ? 'translate-x-0 shadow-xl' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 pb-3 lg:hidden">
          <span className="text-lg font-medium text-slate-700">Drive</span>
          <IconButton label="Close menu" onClick={onClose}>
            <X className="size-5" />
          </IconButton>
        </div>

        <div className="px-3 pb-4">
          <NewMenu />
        </div>

        <nav className="flex-1 space-y-0.5 pr-3">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-4 rounded-r-full py-2 pl-6 text-sm transition-colors ${
                  isActive ? 'bg-brand-100 font-medium text-brand-700' : 'text-slate-700 hover:bg-slate-200/60'
                }`
              }
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>

        <StorageIndicator />
      </aside>
    </>
  );
}
