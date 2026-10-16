import { Cloud } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { Button } from '../components/ui/Button';
import { FullPageSpinner } from '../components/ui/Spinner';
import { useAuth } from '../context/AuthContext';

function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm ring-1 ring-slate-200 sm:p-10">
        <Cloud className="size-10 text-brand-500" aria-hidden />
        <h1 className="mt-4 text-2xl text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}

function Field(props: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={props.id} className="mb-1 block text-sm font-medium text-slate-700">
        {props.label}
      </label>
      <input
        id={props.id}
        type={props.type}
        value={props.value}
        required
        autoComplete={props.autoComplete}
        onChange={(e) => props.onChange(e.target.value)}
        aria-describedby={props.hint ? `${props.id}-hint` : undefined}
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 focus:outline-none"
      />
      {props.hint && (
        <p id={`${props.id}-hint`} className="mt-1 text-xs text-slate-500">
          {props.hint}
        </p>
      )}
    </div>
  );
}

function useRedirectTarget() {
  const location = useLocation();
  return (location.state as { from?: string } | null)?.from ?? '/drive';
}

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const target = useRedirectTarget();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <FullPageSpinner />;
  if (user) return <Navigate to={target} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate(target, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Sign in" subtitle="to continue to Drive">
      <form onSubmit={submit} className="space-y-5">
        <Field id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between pt-2">
          <Link to="/signup" className="text-sm font-medium text-brand-600 hover:underline">
            Create account
          </Link>
          <Button type="submit" loading={busy}>
            Sign in
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}

export function SignupPage() {
  const { user, loading, signup } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <FullPageSpinner />;
  if (user) return <Navigate to="/drive" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      await signup(name, email, password);
      navigate('/drive', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Create your account" subtitle="Store and access your files from anywhere">
      <form onSubmit={submit} className="space-y-5">
        <Field id="name" label="Name" type="text" value={name} onChange={setName} autoComplete="name" />
        <Field id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint="At least 8 characters"
        />
        <Field
          id="confirm"
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between pt-2">
          <Link to="/login" className="text-sm font-medium text-brand-600 hover:underline">
            Sign in instead
          </Link>
          <Button type="submit" loading={busy}>
            Create account
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
