import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase, hasSupabaseConfig } from './supabase';
import { listenForOAuthCallbacks } from './oauth';

interface AuthState {
  configured: boolean; // há URL + chave do Supabase no .env
  ready: boolean; // já se leu a sessão guardada
  session: Session | null;
  user: User | null;
}

const AuthCtx = createContext<AuthState>({ configured: false, ready: true, session: null, user: null });

// Mantém a sessão do Supabase (guardada no localStorage pelo próprio supabase-js)
// e avisa a app quando a pessoa entra ou sai.
export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = hasSupabaseConfig();
  const [state, setState] = useState<AuthState>({ configured, ready: !configured, session: null, user: null });

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let alive = true;
    sb.auth.getSession().then(({ data }) => {
      if (alive) setState({ configured, ready: true, session: data.session, user: data.session?.user ?? null });
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setState({ configured, ready: true, session, user: session?.user ?? null });
    });
    // Login social no Windows/telemóvel: o fornecedor volta à app por um link (futurepal://… / com.futurepal.app://…).
    const stopOAuth = listenForOAuthCallbacks((msg) => { try { sessionStorage.setItem('wallet.oauthError', msg); } catch { /* sem storage */ } });
    return () => { alive = false; sub.subscription.unsubscribe(); stopOAuth(); };
  }, [configured]);

  return <AuthCtx.Provider value={state}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthCtx);
}
