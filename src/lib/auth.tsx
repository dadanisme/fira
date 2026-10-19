import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';
import { recordSignIn, watchMembership } from '../data/members';
import { auth, OWNER_EMAIL } from './firebase';

type AuthState = { status: 'loading' } | { status: 'signedOut'; error?: string } | { status: 'signedIn'; user: User };

const UserContext = createContext<User | null>(null);

function isOwner(user: User): boolean {
  return user.emailVerified && user.email?.toLowerCase() === OWNER_EMAIL.toLowerCase();
}

/**
 * Auth gate: renders children for the owner (VITE_OWNER_EMAIL) and for verified Google accounts
 * the owner invited (a `members/{email}` doc, see src/data/members.ts). Membership is watched
 * live, so removing a member signs them out at once. Anyone else is signed out again and shown
 * an error on the sign-in screen.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let stopMembership: (() => void) | undefined;
    const stopAuth = onAuthStateChanged(auth, (user) => {
      stopMembership?.();
      stopMembership = undefined;
      if (!user) {
        setState((s) => ({ status: 'signedOut', error: s.status === 'signedOut' ? s.error : undefined }));
        return;
      }
      if (isOwner(user)) {
        setState({ status: 'signedIn', user });
        recordSignIn(user, true).catch(reportError);
        return;
      }
      const reject = () => {
        stopMembership?.();
        stopMembership = undefined;
        setState({ status: 'signedOut', error: `${user.email ?? 'This account'} hasn't been invited to fira.` });
        void signOut(auth);
      };
      if (!user.email || !user.emailVerified) return reject();
      let recorded = false;
      stopMembership = watchMembership(user.email, (member) => {
        if (!member) return reject();
        setState((s) => (s.status === 'signedIn' && s.user === user ? s : { status: 'signedIn', user }));
        if (!recorded) {
          recorded = true;
          recordSignIn(user, false).catch(reportError);
        }
      });
    });
    return () => {
      stopAuth();
      stopMembership?.();
    };
  }, []);

  if (state.status === 'loading') return null;
  if (state.status === 'signedOut') {
    return <SignIn error={state.error} onError={(error) => setState({ status: 'signedOut', error })} />;
  }
  return <UserContext.Provider value={state.user}>{children}</UserContext.Provider>;
}

/** The signed-in user (owner or member). Only valid below AuthProvider. */
export function useUser(): User {
  const user = useContext(UserContext);
  if (!user) throw new Error('useUser must be used below AuthProvider');
  return user;
}

/** Whether the signed-in user is the owner (who alone manages members). Only valid below AuthProvider. */
export function useIsOwner(): boolean {
  return isOwner(useUser());
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
