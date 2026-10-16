import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { SESSION_EXPIRED_EVENT } from '../api/client';
import { authApi } from '../api/endpoints';
import type { User } from '../api/types';
import { useToast } from './ToastContext';

interface AuthApi {
  user: User | null;
  /** true while we ask the server "who am I?" on first load */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // The session cookie is HttpOnly (JavaScript cannot read it), so we ask the
  // server whether we are logged in.
  useEffect(() => {
    authApi
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const userRef = useRef(user);
  userRef.current = user;

  // Any API call that gets "401 UNAUTHENTICATED" fires this event.
  useEffect(() => {
    const onExpired = () => {
      if (!userRef.current) return;
      toast('Your session has expired. Please log in again.', 'error');
      setUser(null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [toast]);

  const login = useCallback(async (email: string, password: string) => {
    setUser((await authApi.login(email, password)).user);
  }, []);

  const signup = useCallback(async (name: string, email: string, password: string) => {
    setUser((await authApi.signup(name, email, password)).user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, loading, login, signup, logout }), [user, loading, login, signup, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
