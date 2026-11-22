// Depois do setup: guia passo a passo (conta, despesa e, se a pessoa quiser, o resto da app) e o lembrete para criar conta.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { hasSupabaseConfig } from '../auth/supabase';
import { track } from '../core/onboarding';
import { db } from '../db/app-db';
import { L } from '../i18n/phrases';
import { LoginForm } from '../pages/Login';
import { BottomSheet } from '../pages/SimplePages';
import { Ic, ICON } from './fx';
import { openTxForm } from './TxForm';

type Stage = 'acc' | 'acc1' | 'askExp' | 'exp' | 'askMore' | 'more';
const KEY = 'wallet.guide', GUIDE_EVENT = 'wallet:guide';
export const guideStage = (): Stage | null => { try { return localStorage.getItem(KEY) as Stage | null; } catch { return null; } };
export function setGuide(s: Stage | null): void { try { if (s) localStorage.setItem(KEY, s); else localStorage.removeItem(KEY); } catch { /* sem storage */ } window.dispatchEvent(new Event(GUIDE_EVENT)); }
/** Há um guia a decorrer: as outras dicas e avisos esperam. */
export const guiding = (): boolean => guideStage() !== null;

interface StepDef { sel: string; text: () => string; path?: string }
const row = (n: number | 'last') => `.fx-sheet .tx-rows > .tx-row:${n === 'last' ? 'last-child' : `nth-child(${n})`}`;
const ACC: StepDef[] = [
  { sel: '.bs-sheet .acc-kind', text: () => L('Escolhe o tipo: Gastos para o dia a dia, Poupança para juntar, Dívidas para empréstimos.') },
  { sel: '.bs-sheet .tx-amt', text: () => L('Escreve quanto dinheiro tens nessa conta. Se não souberes, deixa 0.') },
  { sel: '.bs-sheet .tx-rows > .tx-row:nth-child(1)', text: () => L('Dá-lhe um nome, por exemplo o do teu banco.') },
  { sel: '.bs-sheet .tx-addbtn', text: () => L('Toca em Criar conta. Depois encontras tudo na página Contas.') },
];
const EXP: StepDef[] = [
  { sel: '.fx-sheet .tx-amt', text: () => L('Escreve quanto gastaste.') },
  { sel: row(1), text: () => L('Se quiseres, diz o que foi. Por exemplo: almoço.') },
  { sel: row(2), text: () => L('Escolhe onde gastaste. Vês e crias categorias em Menu › Categorias.') },
  { sel: row(3), text: () => L('De que conta saiu o dinheiro? Mudas e crias contas na página Contas.') },
  { sel: row(5), text: () => L('Quando foi? Hoje já vem escolhido. Por dia, vês tudo no Calendário.') },
  { sel: row('last'), text: () => L('Repete-se todos os meses? Liga isto e acompanha na página Recorrentes.') },
  { sel: '.fx-sheet .tx-addbtn, .fx-sheet-foot .fx-btn.primary', text: () => L('Toca aqui para guardar. Está feito!') },
];
const MORE: StepDef[] = [
  { path: '/transacoes', sel: '.txs-search, .fx-search', text: () => L('Aqui vês e procuras todas as tuas transações.') },
];
const REST: StepDef[] = [
  { path: '/', sel: '.sh-hero, .pco-metric', text: () => L('No Início vês quanto tens, quanto gastaste e quanto sobra.') },
  { path: '/metas', sel: '.fx-page > .sh-pill', text: () => L('Metas: diz quanto queres juntar e a app mostra quando lá chegas.') },
  { path: '/orcamentos', sel: '.fx-page > .sh-pill', text: () => L('Limites: escolhe o máximo a gastar numa categoria. A app avisa quando estiveres perto.') },
  { path: '/grupos', sel: '.fx-page > .sh-btn.in', text: () => L('Grupos: junta as despesas de uma viagem ou jantar e divide-as com outras pessoas.') },
  { path: '/subscricoes', sel: '.fx-page > .sh-pill', text: () => L('Recorrentes: vê o que se repete todos os meses e quanto podias poupar.') },
  { path: '/salarios', sel: '.sal-add', text: () => L('Salários: escreve o que recebes para saberes quanto te sobra.') },
  { path: '/categorias', sel: '.fx-head .fx-btn.primary', text: () => L('Categorias: cria as tuas, com nome, ícone e cor.') },
  { path: '/calendario', sel: '.sh-cal, .fx-cal, .mv-card', text: () => L('Calendário: quanto gastaste em cada dia.') },
  { path: '/assistente', sel: '.ai-top', text: () => L('Assistente: pergunta o que quiseres sobre o teu dinheiro.') },
  { path: '/ajuda', sel: '.hp-list', text: () => L('E se tiveres dúvidas, a Ajuda está sempre no menu. É tudo!') },
];

function Ask({ d, title, text, yes, no, onYes, onNo }: { d: string; title: string; text: string; yes: string; no: string; onYes: () => void; onNo: () => void }) {
  return createPortal(<div className="spi-back gd-ask"><div className="spi-card" role="dialog" aria-modal="true" aria-label={title}><span className="on-logo sm"><Ic d={d} size={34} /></span><h2>{title}</h2><p>{text}</p><button type="button" className="ob-cta" onClick={onYes}>{yes}</button><button type="button" className="on-skip" onClick={onNo}>{no}</button></div></div>, document.body);
}

/** Explica um passo de cada vez, com um anel à volta do sítio certo. while: seletor que tem de existir (a janela aberta). */
function Coach({ steps, host, onEnd }: { steps: StepDef[]; host?: string; onEnd: (closed: boolean) => void }) {
  const navigate = useNavigate();
  const [i, setI] = useState(0), [r, setR] = useState<DOMRect | null>(null);
  const s = steps[i];
  useEffect(() => { if (s.path) navigate(s.path); }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let seen = false, n = 0, moved = false;
    const id = setInterval(() => {
      n++;
      if (host) { const up = !!document.querySelector(host); if (up) seen = true; if ((seen && !up) || (!seen && n > 40)) { clearInterval(id); onEnd(true); return; } }
      const el = document.querySelector<HTMLElement>(s.sel);
      if (el && !moved) { moved = true; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      const b = el?.getBoundingClientRect();
      setR(b && b.width > 0 ? b : null);
    }, 120);
    return () => clearInterval(id);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = i === steps.length - 1, low = !r || r.top + r.height / 2 < window.innerHeight * 0.52;
  return createPortal(<>
    {r && <i className="gd-ring" aria-hidden="true" style={{ left: r.left - 6, top: r.top - 6, width: r.width + 12, height: r.height + 12 }} />}
    <aside className={'gd-card' + (low ? ' low' : ' high')} role="dialog" aria-label={L('Ajuda')}>
      <button type="button" className="tipb-x" onClick={() => onEnd(false)} aria-label={L('Fechar')}><Ic d={ICON.close} size={16} /></button>
      <p key={i}>{s.text()}</p>
      <div><span className="gd-dots" aria-hidden="true">{steps.map((_, k) => <i key={k} className={k <= i ? 'on' : ''} />)}</span>
        {i > 0 && <button type="button" className="on-skip" onClick={() => setI(i - 1)}>{L('Voltar')}</button>}
        {(!last || !host) && <button type="button" className="tipb-do" onClick={() => (last ? onEnd(true) : setI(i + 1))}>{last ? L('Concluir') : L('Seguinte')}</button>}</div>
    </aside>
  </>, document.body);
}

export function Guide() {
  const navigate = useNavigate();
  const [st, setSt] = useState<Stage | null>(guideStage);
  const [list, setList] = useState(false); // depois da despesa: mostrar onde estão as transações
  useEffect(() => { const on = () => setSt(guideStage()); window.addEventListener(GUIDE_EVENT, on); return () => window.removeEventListener(GUIDE_EVENT, on); }, []);
  const go = (s: Stage | null) => { track('tip_guide_' + (s ?? 'end').toLowerCase()); setGuide(s); };
  const W = ICON.wallet, R = 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', S = 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z';
  if (st === 'acc') return <Ask d={W} title={L('Vamos criar a primeira conta?')} text={L('Pode ser o teu banco, um cartão ou dinheiro. Assim sabes sempre quanto tens.')} yes={L('Vamos criar')} no={L('Fica para mais tarde')} onNo={() => go('askExp')}
    onYes={() => { navigate('/contas'); go('acc1'); let n = 0; const id = setInterval(() => { const b = document.querySelector<HTMLElement>('.fx-page > .sh-btn.in'); if (b || ++n > 30) { clearInterval(id); b?.click(); } }, 150); }} />;
  if (st === 'acc1') return <Coach key="acc" steps={ACC} host=".bs-sheet" onEnd={() => go('askExp')} />;
  if (st === 'askExp') return <Ask d={R} title={L('Queres saber como adicionar a primeira despesa?')} text={L('É rápido: mostramos-te campo a campo.')} yes={L('Vamos adicionar')} no={L('Fica para mais tarde')} onNo={() => go('askMore')} onYes={() => { openTxForm({ type: 'expense' }); go('exp'); }} />;
  if (st === 'exp') return list ? <Coach key="list" steps={MORE} onEnd={() => { setList(false); go('askMore'); }} /> : <Coach key="exp" steps={EXP} host=".fx-sheet" onEnd={() => setList(true)} />;
  if (st === 'askMore') return <Ask d={S} title={L('Queres ver o resto da app?')} text={L('Mostramos-te metas, limites, grupos e o resto em menos de um minuto.')} yes={L('Continuar')} no={L('Descobrir sozinho')} onNo={() => { navigate('/'); go(null); }} onYes={() => go('more')} />;
  if (st === 'more') return <Coach key="more" steps={REST} onEnd={() => { navigate('/'); go(null); }} />;
  return null;
}

// ── lembrete para quem usa sem conta: aparece poucas vezes e cada vez mais espaçado
const NK = 'wallet.nudge', DAY = 86_400_000, GAPS = [2, 4, 7, 14, 30];
export function AccountNudge() {
  const auth = useAuth();
  const [show, setShow] = useState(false), [login, setLogin] = useState(false);
  useEffect(() => {
    if (auth.user || !hasSupabaseConfig()) return;
    const id = setTimeout(async () => {
      try {
        if (guiding() || sessionStorage.getItem(NK) || document.querySelector('[role="dialog"]')) return;
        const raw = JSON.parse(localStorage.getItem(NK) || 'null') as { n: number; next: number } | null;
        if (!raw) { localStorage.setItem(NK, JSON.stringify({ n: 0, next: Date.now() + DAY })); return; } // nunca no primeiro dia
        if (Date.now() < raw.next || (await db.transactions.count()) < 3) return;
        sessionStorage.setItem(NK, '1'); setShow(true);
      } catch { /* sem storage */ }
    }, 20_000);
    return () => clearTimeout(id);
  }, [auth.user]);
  const later = () => { try { const n = (JSON.parse(localStorage.getItem(NK) || '{"n":0}') as { n: number }).n; localStorage.setItem(NK, JSON.stringify({ n: n + 1, next: Date.now() + GAPS[Math.min(n, GAPS.length - 1)] * DAY })); } catch { /* sem storage */ } setShow(false); setLogin(false); };
  if (auth.user) return null;
  if (login) return <BottomSheet title={L('Criar conta')} onClose={later}><LoginForm initialMode="signup" onDone={() => setLogin(false)} /></BottomSheet>;
  if (!show) return null;
  const why: Array<[string, string]> = [['M7 18a4 4 0 0 1-.5-8 6 6 0 0 1 11.6 1.5A3.5 3.5 0 0 1 17.5 18M12 12v8M9 15l3-3 3 3', L('As tuas despesas ficam guardadas na nuvem.')], ['M4 5h11v10H4zM2 19h14M18 9h4v11h-4z', L('Vês tudo no telemóvel e no computador.')], ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4', L('Se perderes o aparelho, não perdes nada.')]];
  return createPortal(<aside className="nt-pop gd-nudge" role="dialog" aria-label={L('Protege o que já registaste')}><h3>{L('Protege o que já registaste')}</h3>{why.map(([d, x]) => <p key={x}><span className="pco-mic"><Ic d={d} size={18} /></span>{x}</p>)}<div className="rc-popbtns"><button type="button" className="no gd-no" onClick={later}>{L('Agora não')}</button><button type="button" className="yes" onClick={() => { setShow(false); setLogin(true); }}>{L('Criar conta')}</button></div></aside>, document.body);
}
