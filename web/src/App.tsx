import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { LoginPage, SignupPage } from './pages/AuthPages';
import { DrivePage } from './pages/DrivePage';
import { RecentPage } from './pages/RecentPage';
import { SearchPage } from './pages/SearchPage';
import { SharedFilePage } from './pages/SharedFilePage';
import { UploadsPage } from './pages/UploadsPage';
import { StarredPage } from './pages/StarredPage';
import { TrashPage } from './pages/TrashPage';

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            {/* Public share links - no login needed. */}
            <Route path="/s/:token" element={<SharedFilePage />} />
            {/* Everything below requires login (AppLayout redirects otherwise). */}
            <Route element={<AppLayout />}>
              <Route path="/drive" element={<DrivePage />} />
              <Route path="/drive/folders/:folderId" element={<DrivePage />} />
              <Route path="/recent" element={<RecentPage />} />
              <Route path="/starred" element={<StarredPage />} />
              <Route path="/trash" element={<TrashPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/uploads" element={<UploadsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/drive" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
