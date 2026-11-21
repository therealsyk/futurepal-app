import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase, hasSupabaseConfig } from './supabase';
import { listenForOAuthCallbacks } from './oauth';
import { rememberSession, savedAccounts, switchToAccount } from './savedAccounts';

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
    sb.auth.getSession().then(async ({ data }) => {
      let session = data.session;
      // After an app update the WebView localStorage can be wiped, losing the Supabase
      // session even though account tokens were saved in wallet.savedAccounts. Try to
      // restore the most recently used account before falling back to guest mode.
      if (!session) {
        const last = savedAccounts()[0];
        if (last && await switchToAccount(sb, last.id)) {
          session = (await sb.auth.getSession()).data.session;
        }
      }
      if (alive) setState({ configured, ready: true, session, user: session?.user ?? null });
      rememberSession(session);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setState({ configured, ready: true, session, user: session?.user ?? null });
      rememberSession(session); // guarda/atualiza a sessão desta conta para "Trocar de conta"
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
