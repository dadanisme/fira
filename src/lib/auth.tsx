import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';
import { syncAccount } from '../data/workspaces';
import { auth } from './firebase';

type AuthState = { status: 'loading' } | { status: 'signedOut'; error?: string } | { status: 'signedIn'; user: User };

const UserContext = createContext<User | null>(null);

/**
 * Auth gate: any Google account with a verified email gets in; there is no allow-list.
 * Access is per workspace (a `workspaces/{wid}/members/{uid}` doc, see WorkspaceRoute).
 * After sign-in it refreshes the user's profile on their member docs once per session
 * (`syncAccount`).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        if (!user) {
          setState((s) => ({ status: 'signedOut', error: s.status === 'signedOut' ? s.error : undefined }));
          return;
        }
        if (!user.email || !user.emailVerified) {
          setState({ status: 'signedOut', error: `${user.email ?? 'This account'} has no verified email address.` });
          void signOut(auth);
          return;
        }
        setState((s) => (s.status === 'signedIn' && s.user === user ? s : { status: 'signedIn', user }));
        syncAccount().catch(reportError);
      }),
    [],
  );

  if (state.status === 'loading') return null;
  if (state.status === 'signedOut') {
    return <SignIn error={state.error} onError={(error) => setState({ status: 'signedOut', error })} />;
  }
  return <UserContext.Provider value={state.user}>{children}</UserContext.Provider>;
}

/** The signed-in user. Only valid below AuthProvider. */
export function useUser(): User {
  const user = useContext(UserContext);
  if (!user) throw new Error('useUser must be used below AuthProvider');
  return user;
}

export function signOutUser(): Promise<void> {
  return signOut(auth);
}

function SignIn({ error, onError }: { error?: string; onError: (message: string) => void }) {
  const signIn = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      if (e instanceof FirebaseError && e.code === 'auth/popup-closed-by-user') return;
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-sidebar p-6">
      <div className="flex w-72 flex-col items-center gap-4 rounded-xl border border-line bg-surface p-8 text-center shadow-card">
        <div className="flex flex-col items-center gap-3">
          <Logo size={48} />
          <div className="text-xl font-semibold tracking-tight">fira</div>
        </div>
        <p className="text-fg-muted">Your board and docs, fast.</p>
        <Button variant="primary" className="w-full" onClick={signIn}>
          Continue with Google
        </Button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}
