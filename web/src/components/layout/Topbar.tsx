import { Cloud, LogOut, Menu, Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ContextMenu } from '../files/ContextMenu';
import { IconButton } from '../ui/Button';

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const onSearchPage = location.pathname === '/search';
  const [query, setQuery] = useState(onSearchPage ? (params.get('q') ?? '') : '');
  const [userMenu, setUserMenu] = useState<{ x: number; y: number } | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Keep the box in sync when navigating (e.g. leaving the search page clears it).
  useEffect(() => {
    setQuery(onSearchPage ? (params.get('q') ?? '') : '');
  }, [onSearchPage, params]);

  const goSearch = (q: string, replace: boolean) => {
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`, { replace });
  };

  const onChange = (value: string) => {
    setQuery(value);
    clearTimeout(debounce.current);
    // Search as you type (after a short pause), replacing history entries.
    debounce.current = setTimeout(() => goSearch(value, onSearchPage), 350);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    clearTimeout(debounce.current);
    goSearch(query, onSearchPage);
  };

  const initial = user?.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <header className="flex items-center gap-2 bg-surface px-2 py-2 sm:gap-4 sm:px-4">
      <IconButton label="Open menu" onClick={onMenu} className="lg:hidden">
        <Menu className="size-5" />
      </IconButton>
      <div className="hidden w-60 items-center gap-2 pl-2 sm:flex">
        <Cloud className="size-8 text-brand-500" aria-hidden />
        <span className="text-xl text-slate-700">Drive</span>
      </div>

      <form role="search" onSubmit={onSubmit} className="max-w-3xl flex-1">
        <div className="flex items-center gap-2 rounded-full bg-slate-200/70 px-4 py-2.5 focus-within:bg-white focus-within:shadow-md">
          <Search className="size-5 text-slate-500" aria-hidden />
          <label htmlFor="global-search" className="sr-only">
            Search in Drive
          </label>
          <input
            id="global-search"
            type="search"
            value={query}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Search in Drive"
            maxLength={100}
            autoComplete="off"
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-500 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                clearTimeout(debounce.current);
              }}
              className="rounded-full p-0.5 text-slate-500 hover:bg-slate-300/60"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </form>

      <button
        type="button"
        aria-label={`Account: ${user?.name ?? ''}`}
        aria-haspopup="menu"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setUserMenu({ x: rect.right - 220, y: rect.bottom + 6 });
        }}
        className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-medium text-white"
      >
        {initial}
      </button>

      {userMenu && user && (
        <ContextMenu
          x={userMenu.x}
          y={userMenu.y}
          label="Account"
          onClose={() => setUserMenu(null)}
          actions={[
            {
              label: `Sign out (${user.email})`,
              icon: LogOut,
              onSelect: () => void logout().then(() => navigate('/login')),
            },
          ]}
        />
      )}
    </header>
  );
}
