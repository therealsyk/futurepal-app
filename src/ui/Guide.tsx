// Depois do setup: guia passo a passo (conta, despesa e, se a pessoa quiser, o resto da app) e o lembrete para criar conta.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import i18next from 'i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { hasSupabaseConfig } from '../auth/supabase';
import { track } from '../core/onboarding';
import { needsFirstAccount } from '../core/accounts';
import { db } from '../db/app-db';
import { L } from '../i18n/phrases';
import { LoginForm } from '../pages/Login';
import { BottomSheet } from '../pages/SimplePages';
import { boldTerms } from './boldTerms';
import { Ic, ICON } from './fx';
import { openTxForm } from './TxForm';

type Stage = 'acc' | 'accnav' | 'acc1' | 'askExp' | 'expnav' | 'exp' | 'askMore' | 'more';
const KEY = 'wallet.guide', GUIDE_EVENT = 'wallet:guide';
export const guideStage = (): Stage | null => { try { return localStorage.getItem(KEY) as Stage | null; } catch { return null; } };
export function setGuide(s: Stage | null): void { try { if (s) localStorage.setItem(KEY, s); else localStorage.removeItem(KEY); } catch { /* sem storage */ } window.dispatchEvent(new Event(GUIDE_EVENT)); }
/** Há um guia a decorrer: as outras dicas e avisos esperam. */
export const guiding = (): boolean => guideStage() !== null;

/** t = título, d = ícone, tap = mostra a mão a tocar no sítio. */
interface StepDef { sel: string; t: () => string; d: string; text: () => string; path?: string; tap?: boolean; menu?: 'short' | 'all' }
const I = {
  tag: 'M4 4h8l8 8-8 8-8-8zM8.5 8.5h.01', money: 'M3 6h18v12H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6.5 12h.01M17.5 12h.01', pen: 'M4 20l1-5L16 4l4 4L9 19zM14 6l4 4', ok: 'M4 12.5l5.5 5.5L20 7', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', cal: 'M5 5h14v15H5zM5 10h14M8 3v4M16 3v4', rec: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3', list: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', home: 'M3 11l9-8 9 8M5 9.5V20h14V9.5M10 20v-6h4v6', goal: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z', lim: 'M12 3a9 9 0 1 0 9 9h-9zM15 3.5V9h5.5A9 9 0 0 0 15 3.5z', grp: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6.5 6.5 0 0 1 3.5 6', sal: 'M3 7h18v12H3zM3 11h18M7 15h3', ai: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15v5M15.5 17.5h5', help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7M12 17h.01',
};
const HAND = 'M22 14a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15V4a2 2 0 0 1 4 0v5.5V9a2 2 0 0 1 4 0v1a2 2 0 0 1 4 0v1a1.9 1.9 0 0 1 3 1.5z';
/** "Metas: diz quanto…" → "Diz quanto…" (o nome já está no título) */
const after = (x: string) => { const y = x.replace(/^[^:.]{2,16}: ?/, ''); return y.charAt(0).toUpperCase() + y.slice(1); };
const row = (n: number | 'last') => `.fx-sheet .tx-rows > .tx-row:${n === 'last' ? 'last-child' : `nth-child(${n})`}`;
const ACC: StepDef[] = [
  { sel: '.bs-sheet .acc-kind', t: () => L('Tipo de conta'), d: I.tag, tap: true, text: () => L('Escolhe o tipo: Gastos para o dia a dia, Poupança para juntar, Dívidas para empréstimos.') },
  { sel: '.bs-sheet .tx-amt', t: () => L('Valor'), d: I.money, tap: true, text: () => L('Escreve quanto dinheiro tens nessa conta. Se não souberes, deixa 0.') },
  { sel: '.bs-sheet .tx-rows > .tx-row:nth-child(1)', t: () => L('Nome da conta'), d: I.pen, tap: true, text: () => L('Dá-lhe um nome, por exemplo o do teu banco.') },
  { sel: '.bs-sheet .tx-addbtn', t: () => L('Criar conta'), d: I.ok, tap: true, text: () => L('Toca em Criar conta. Depois encontras tudo na página Contas.') },
];
const EXP: StepDef[] = [
  { sel: '.fx-sheet .tx-amt', t: () => L('Valor'), d: I.money, tap: true, text: () => L('Escreve quanto gastaste.') },
  { sel: row(1), t: () => L('Descrição'), d: I.pen, tap: true, text: () => L('Se quiseres, diz o que foi. Por exemplo: almoço.') },
  { sel: row(2), t: () => L('Categoria'), d: I.grid, tap: true, text: () => L('Escolhe onde gastaste. Vês e crias categorias em Menu › Categorias.') },
  { sel: row(3), t: () => L('Conta'), d: ICON.wallet, tap: true, text: () => L('De que conta saiu o dinheiro? Mudas e crias contas na página Contas.') },
  { sel: row(5), t: () => L('Data'), d: I.cal, tap: true, text: () => L('Quando foi? Hoje já vem escolhido. Por dia, vês tudo no Calendário.') },
  { sel: row('last'), t: () => L('Recorrente'), d: I.rec, tap: true, text: () => L('Repete-se todos os meses? Liga isto e acompanha na página Recorrentes.') },
  { sel: '.fx-sheet .tx-addbtn, .fx-sheet-foot .fx-btn.primary', t: () => L('Guardar'), d: I.ok, tap: true, text: () => L('Toca aqui para guardar. Está feito!') },
];
const pc = () => window.innerWidth > 768;
const BAR = ['/', '/transacoes', '/orcamentos', '/contas'];
/** Onde se encontra a página: barra de baixo ou Menu no telemóvel, barra da esquerda no PC. */
function nav(path: string, key: string): StepDef {
  const bar = !pc() && BAR.includes(path), side = pc();
  return {
    sel: side ? `.fx-rail a[href="#${path}"]` : bar ? `.mb-tabbar a[href="#${path}"]` : `.mb-tile[data-go="${path}"]`,
    t: () => L('Onde encontrar'), d: 'M12 21s7-6.3 7-11.5A7 7 0 0 0 5 9.5C5 14.7 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', tap: true, menu: side || bar ? undefined : 'all',
    text: () => (side ? L('Toca em {x}, no menu à esquerda.') : bar ? L('Toca em {x}, na barra de baixo.') : L('Está no Menu. Toca em {x}.')).replace('{x}', i18next.t(key)),
  };
}
const MENU: StepDef[] = [
  { path: '/', sel: '.mv-menu', t: () => L('Menu'), d: I.grid, tap: true, text: () => L('No Início, toca em Menu. É por aqui que encontras as outras páginas.') },
  { sel: '.mb-allbtn', t: () => L('Menu'), d: I.grid, tap: true, menu: 'short', text: () => L('Toca em {x} para veres o resto.').replace('{x}', i18next.t('simple.allFeatures')) },
];
const ACCNAV = (): StepDef[] => [nav('/contas', 'nav.accounts'), { path: '/contas', sel: '.fx-page > .sh-btn.in', t: () => L('Criar conta'), d: ICON.wallet, tap: true, text: () => L('Sempre que quiseres uma conta nova, toca em Criar conta.') }];
const EXPNAV = (): StepDef[] => [{ path: pc() ? '/' : undefined, sel: pc() ? '.pc-fab' : '.mb-plus', t: () => L('Nova transação'), d: ICON.plus, tap: true, text: () => (pc() ? L('Sempre que gastares dinheiro, toca no botão + do Início.') : L('Sempre que gastares dinheiro, toca no botão + em baixo.')) }];
const MORE = (): StepDef[] => [
  nav('/transacoes', 'nav.transactions'),
  { path: '/transacoes', sel: '.txs-search, .fx-search', t: () => L('Transações'), d: I.list, text: () => L('Aqui vês e procuras todas as tuas transações.') },
];
const REST = (): StepDef[] => [
  { path: '/', sel: '.sh-hero, .pco-metric', t: () => L('Início'), d: I.home, text: () => L('No Início vês quanto tens, quanto gastaste e quanto sobra.') },
  nav('/contas', 'nav.accounts'),
  { path: '/contas', sel: '.fx-page > .sh-btn.in', t: () => L('Contas'), d: ICON.wallet, text: () => L('Aqui vês quanto tens em cada conta e crias contas novas.') },
  ...(pc() ? [] : MENU),
  nav('/metas', 'nav.goals'),
  { path: '/metas', sel: '.fx-page > .sh-pill', t: () => L('Metas'), d: I.goal, text: () => after(L('Metas: diz quanto queres juntar e a app mostra quando lá chegas.')) },
  nav('/orcamentos', 'simple.tabLimits'),
  { path: '/orcamentos', sel: '.fx-page > .sh-pill', t: () => L('Limites'), d: I.lim, text: () => after(L('Limites: escolhe o máximo a gastar numa categoria. A app avisa quando estiveres perto.')) },
  nav('/grupos', 'simple.groups'),
  { path: '/grupos', sel: '.fx-page > .sh-btn.in', t: () => L('Grupos'), d: I.grp, text: () => after(L('Grupos: junta as despesas de uma viagem ou jantar e divide-as com outras pessoas.')) },
  nav('/subscricoes', 'nav.recurring'),
  { path: '/subscricoes', sel: '.fx-page > .sh-pill', t: () => L('Recorrentes'), d: I.rec, text: () => after(L('Recorrentes: vê o que se repete todos os meses e quanto podias poupar.')) },
  nav('/salarios', 'nav.salaries'),
  { path: '/salarios', sel: '.sal-add', t: () => L('Salários'), d: I.sal, text: () => after(L('Salários: escreve o que recebes para saberes quanto te sobra.')) },
  nav('/categorias', 'nav.categories'),
  { path: '/categorias', sel: '.fx-head .fx-btn.primary', t: () => L('Categorias'), d: I.grid, text: () => after(L('Categorias: cria as tuas, com nome, ícone e cor.')) },
  nav('/calendario', 'nav.calendar'),
  { path: '/calendario', sel: '.sh-cal, .fx-cal, .mv-card', t: () => L('Calendário'), d: I.cal, text: () => after(L('Calendário: quanto gastaste em cada dia.')) },
  nav('/assistente', 'plus.short_assistant'),
  { path: '/assistente', sel: '.ai-top', t: () => L('Assistente'), d: I.ai, text: () => after(L('Assistente: pergunta o que quiseres sobre o teu dinheiro.')) },
  nav('/ajuda', 'nav.help'),
  { path: '/ajuda', sel: '.hp-list', t: () => L('Ajuda'), d: I.help, text: () => L('E se tiveres dúvidas, a Ajuda está sempre no menu. É tudo!') },
];

function Ask({ d, title, text, yes, no, onYes, onNo }: { d: string; title: string; text: string; yes: string; no: string; onYes: () => void; onNo: () => void }) {
  return createPortal(<div className="spi-back gd-ask"><div className="spi-card" role="dialog" aria-modal="true" aria-label={title}><span className="on-logo sm"><Ic d={d} size={34} /></span><h2>{title}</h2><p>{text}</p><button type="button" className="ob-cta" onClick={onYes}>{yes}</button><button type="button" className="on-skip" onClick={onNo}>{no}</button></div></div>, document.body);
}

/** Explica um passo de cada vez, com um anel à volta do sítio certo. while: seletor que tem de existir (a janela aberta). */
function Coach({ steps: def, host, onEnd }: { steps: StepDef[] | (() => StepDef[]); host?: string; onEnd: (closed: boolean) => void }) {
  const navigate = useNavigate();
  const [steps] = useState<StepDef[]>(def);
  const [up, setUp] = useState(!host); // com janela: só aparece quando ela abre
  const [i, setI] = useState(0), [r, setR] = useState<DOMRect | null>(null);
  const s = steps[i];
  useEffect(() => { if (s.path) navigate(s.path); window.dispatchEvent(s.menu ? new CustomEvent('wallet:open-more', { detail: s.menu }) : new Event('wallet:close-more')); }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let seen = false, n = 0, moved = false;
    const id = setInterval(() => {
      n++;
      if (host) { const is = !!document.querySelector(host); if (is) { seen = true; setUp(true); } else if (!seen && document.querySelector('.fa-form')) n = 0; if ((seen && !is) || (!seen && n > 40)) { clearInterval(id); onEnd(true); return; } }
      const el = document.querySelector<HTMLElement>(s.sel);
      if (el && !moved) { moved = true; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      const b = el?.getBoundingClientRect();
      setR(b && b.width > 0 ? b : null);
    }, 120);
    return () => clearInterval(id);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = i === steps.length - 1, box = useRef<HTMLElement>(null);
  const [h, setH] = useState(190);
  useEffect(() => { if (box.current) setH(box.current.offsetHeight); });
  // onde fica a janela: nas páginas, colada ao sítio com uma seta; nos formulários, fora dos campos
  const vw = window.innerWidth, vh = window.innerHeight, w = Math.min(390, vw - 28), gap = 22, foot = vw < 769 && !host ? 96 : 14;
  let top = vh - h - foot, left = (vw - w) / 2, side: 'up' | 'down' | null = null;
  if (r && host) {
    if (r.left > w + 40) { left = r.left - w - gap; top = r.top + r.height / 2 - h / 2; }
    else if (vw - r.right > w + 40) { left = r.right + gap; top = r.top + r.height / 2 - h / 2; }
    else if (r.top > h + 34) top = 16;
  } else if (r && vw > 768 && r.right < 130) { left = r.right + gap; top = r.top + r.height / 2 - h / 2; } else if (r) {
    left = r.left + r.width / 2 - w / 2;
    if (vh - r.bottom > h + gap + foot) { top = r.bottom + gap; side = 'up'; } else if (r.top > h + gap + 10) { top = r.top - h - gap; side = 'down'; }
  }
  left = Math.max(14, Math.min(left, vw - w - 14)); top = Math.max(12, Math.min(top, vh - h - 12));
  useEffect(() => () => { window.dispatchEvent(new Event('wallet:close-more')); }, []);
  useEffect(() => { // tocar mesmo no sítio indicado também avança
    if (!s.tap || host) return;
    const on = (e: MouseEvent) => { if ((e.target as Element | null)?.closest?.(s.sel)) setTimeout(next, 250); };
    document.addEventListener('click', on, true);
    return () => document.removeEventListener('click', on, true);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = () => (last ? onEnd(true) : setI(i + 1)), canNext = !last || !host;
  if (!up) return null;
  return createPortal(<>
    {r ? <i className="gd-ring" aria-hidden="true" style={{ left: r.left - 6, top: r.top - 6, width: r.width + 12, height: r.height + 12 }} /> : <i className="gd-dim" aria-hidden="true" />}
    {r && s.tap && <span key={'h' + i} className="gd-hand" aria-hidden="true" style={{ left: Math.min(r.left + Math.min(r.width * 0.72, r.width - 20), vw - 50), top: Math.min(r.top + r.height / 2, vh - 46) }}><i /><svg viewBox="0 0 24 24" width="34" height="34"><path d={HAND} /></svg></span>}
    <aside ref={box} className="gd-card" role="dialog" aria-label={s.t()} style={{ top, left, width: w }}>
      {side && r && <i className={'gd-tail ' + side} aria-hidden="true" style={{ left: Math.max(26, Math.min(r.left + r.width / 2 - left, w - 26)) }} />}
      <div className="gd-bar" aria-hidden="true">{steps.map((_, k) => <i key={k} className={k <= i ? 'on' : ''} />)}</div>
      <div className="gd-in" key={i} aria-live="polite">
        <span className="gd-ic"><svg viewBox="0 0 24 24" width="28" height="28"><path pathLength={1} d={s.d} /></svg></span>
        <div><h3>{s.t()}</h3><p>{boldTerms(s.text())}</p></div>
      </div>
      <div className="gd-foot">
        <span>{i + 1}/{steps.length}</span>
        {i > 0 && <button type="button" className="gd-back" onClick={() => setI(i - 1)} aria-label={L('Voltar')}><Ic d={ICON.left} size={20} /></button>}
        {canNext && <button type="button" className="gd-next" onClick={next}>{last ? L('Concluir') : L('Seguinte')}<Ic d={last ? I.ok : 'M5 12h14M13 6l6 6-6 6'} size={18} /></button>}
      </div>
      <button type="button" className="tipb-x" onClick={() => onEnd(false)} aria-label={L('Fechar')}><Ic d={ICON.close} size={16} /></button>
    </aside>
  </>, document.body);
}

export function Guide() {
  const navigate = useNavigate();
  const [st, setSt] = useState<Stage | null>(guideStage);
  const [list, setList] = useState(false); // depois da despesa: mostrar onde estão as transações
  useEffect(() => { const on = () => setSt(guideStage()); window.addEventListener(GUIDE_EVENT, on); return () => window.removeEventListener(GUIDE_EVENT, on); }, []);
  useEffect(() => { document.documentElement.classList.toggle('guiding', st !== null); }, [st]); // os outros avisos esperam
  const go = (s: Stage | null) => { track('tip_guide_' + (s ?? 'end').toLowerCase()); setGuide(s); };
  const W = ICON.wallet, R = 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', S = 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z';
  // o que já foi feito no setup não se volta a pedir
  const [ok, setOk] = useState<Stage | null>(null);
  useEffect(() => {
    if (st !== 'acc' && st !== 'askExp') return;
    let on = true;
    (st === 'acc' ? needsFirstAccount(db).then((x) => !x) : db.transactions.filter((x) => x.deletedAt === null).count().then((n) => n > 0)).catch(() => false).then((has) => {
      if (!on) return;
      if (!has) setOk(st); else if (st === 'acc') go('askExp'); else { setList(true); go('exp'); }
    });
    return () => { on = false; };
  }, [st]); // eslint-disable-line react-hooks/exhaustive-deps
  if ((st === 'acc' || st === 'askExp') && ok !== st) return null;
  if (st === 'acc') return <Ask d={W} title={L('Vamos criar a primeira conta?')} text={L('Pode ser o teu banco, um cartão ou dinheiro. Assim sabes sempre quanto tens.')} yes={L('Vamos criar')} no={L('Fica para mais tarde')} onNo={() => go('askExp')}
    onYes={() => go('accnav')} />;
  // espera pela janela que a pessoa possa ter acabado de abrir; só a abre se ainda não estiver aberta
  const then = (sel: string, open: () => void, s: Stage) => { setTimeout(() => { if (!document.querySelector(sel) && !document.querySelector('.fa-form')) open(); go(s); }, 450); };
  if (st === 'accnav') return <Coach key="accnav" steps={ACCNAV} onEnd={(ok) => (ok ? then('.bs-sheet', () => document.querySelector<HTMLElement>('.fx-page > .sh-btn.in')?.click(), 'acc1') : go('askExp'))} />;
  if (st === 'expnav') return <Coach key="expnav" steps={EXPNAV} onEnd={(ok) => (ok ? then('.fx-sheet', () => openTxForm({ type: 'expense' }), 'exp') : go('askMore'))} />;
  if (st === 'acc1') return <Coach key="acc" steps={ACC} host=".bs-sheet" onEnd={() => go('askExp')} />;
  if (st === 'askExp') return <Ask d={R} title={L('Queres saber como adicionar a primeira despesa?')} text={L('É rápido: mostramos-te campo a campo.')} yes={L('Vamos adicionar')} no={L('Fica para mais tarde')} onNo={() => go('askMore')} onYes={() => go('expnav')} />;
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
