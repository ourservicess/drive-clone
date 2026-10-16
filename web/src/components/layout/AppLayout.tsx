import { useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { DriveProvider } from '../../context/DriveContext';
import { UploadPanel } from '../files/UploadPanel';
import { FullPageSpinner } from '../ui/Spinner';
import { NewMenu } from './NewMenu';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/** Layout for all logged-in pages. Redirects to /login when not signed in. */
export function AppLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;

  return (
    <DriveProvider>
      <div className="flex h-full flex-col">
        <Topbar onMenu={() => setSidebarOpen(true)} />
        <div className="flex min-h-0 flex-1">
          <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <main className="flex min-w-0 flex-1 flex-col rounded-tl-2xl bg-white px-3 pt-4 sm:mr-4 sm:rounded-t-2xl sm:px-5 lg:ml-0">
            <Outlet />
          </main>
        </div>
        <NewMenu variant="fab" />
        <UploadPanel />
      </div>
    </DriveProvider>
  );
}
