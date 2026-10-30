import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api } from '@/lib/api';
import { Button } from '@/components/ui/button';

type SessionState = 'loading' | 'signed-out' | 'signed-in' | 'unavailable';

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>('loading');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    const expired = () => { setState('signed-out'); setPassword(''); };
    window.addEventListener('doughray:session-expired', expired);
    api.getSession().then(() => { if (active) setState('signed-in'); }).catch((err: unknown) => {
      if (!active) return;
      if (err instanceof ApiError && err.status === 401) setState('signed-out');
      else { setError(err instanceof Error ? err.message : 'Unable to connect to Doughray.'); setState('unavailable'); }
    });
    return () => { active = false; window.removeEventListener('doughray:session-expired', expired); };
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    setPending(true); setError('');
    try { await api.login(password); setPassword(''); setState('signed-in'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign in.'); }
    finally { setPending(false); }
  }

  if (state === 'signed-in') return <>{children}</>;
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-5 rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Doughray</h1>
        {state === 'loading' ? <p>Checking your session…</p> : state === 'unavailable' ? (
          <><p role="alert">{error}</p><Button onClick={() => window.location.reload()}>Try again</Button></>
        ) : (
          <form onSubmit={login} className="space-y-4">
            <label htmlFor="owner-password" className="block text-sm font-medium">Owner password</label>
            <input id="owner-password" type="password" autoComplete="current-password" required value={password}
              onChange={(event) => setPassword(event.target.value)} className="w-full rounded-md border bg-background px-3 py-2" />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</Button>
          </form>
        )}
      </div>
    </main>
  );
}
