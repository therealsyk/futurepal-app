// Dicas curtas na primeira visita a cada página (uma de cada vez, no topo, sem tapar nada) e o centro de ajuda.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { db } from '../db/app-db';
import { closeTip, did, growFrom, resetTips, tipSeen, tipsOn, TIPS_EVENT } from '../core/onboarding';
import { L } from '../i18n/phrases';
import { Ic, ICON } from './fx';
import { boldTerms } from './boldTerms';
import { guideStarted, guiding, resumeGuide } from './Guide';
import { openTxForm, useTxSaved } from './TxForm';

interface Stats { n: number; exp: number; inc: number; months: number; goals: number; accounts: number; limits: number }
interface Tip { id: string; text: () => string; cta: () => string; run?: () => void; when?: (s: Stats) => boolean }
const press = (sel: string) => () => { document.querySelector<HTMLElement>(sel)?.click(); };

/** Por página, por ordem: aparece a primeira que ainda faz sentido e não foi fechada. */
const tips = (go: (p: string) => void): Record<string, Tip[]> => ({
  '/': [
    { id: 'home', text: () => L('Aqui vês o resumo do mês: gastos, rendimentos e saldo.'), cta: () => L('Entendi') },
    { id: 'income', text: () => L('Adiciona o teu rendimento para veres quanto te sobra.'), cta: () => L('Adicionar rendimento'), run: () => openTxForm({ type: 'income' }), when: (s) => s.exp > 0 && s.inc === 0 },
    { id: 'goalnext', text: () => L('Cria uma meta para transformares o que sobra em poupança.'), cta: () => L('Criar meta'), run: () => go('/metas'), when: (s) => s.inc > 0 && s.goals === 0 },
    { id: 'cats', text: () => L('Cria categorias para perceberes onde gastas mais.'), cta: () => L('Ver categorias'), run: () => go('/categorias'), when: (s) => s.exp >= 3 && !did('category') },
    { id: 'limitnext', text: () => L('Define um limite mensal para uma categoria.'), cta: () => L('Criar limite'), run: () => go('/orcamentos'), when: (s) => s.exp >= 5 && s.limits === 0 },
    { id: 'filter', text: () => L('Compara este mês com o anterior ou escolhe um período em Filtrar.'), cta: () => L('Entendi'), when: (s) => s.months >= 2 },
  ],
  '/transacoes': [{ id: 'tx', text: () => L('Toca em + para registar uma despesa.'), cta: () => L('Adicionar despesa'), run: () => openTxForm({ type: 'expense' }), when: () => !did('expense') }],
  '/categorias': [{ id: 'catpage', text: () => L('Cria categorias para perceberes onde gastas mais.'), cta: () => L('Entendi') }],
  '/contas': [{ id: 'acc', text: () => L('Adiciona uma conta para separares pagamentos por banco, cartão ou dinheiro.'), cta: () => L('Criar conta'), run: press('.fx-page > .sh-btn.in'), when: (s) => s.accounts < 2 }],
  '/salarios': [{ id: 'sal', text: () => L('Adiciona o teu salário ou rendimentos extra para calcularmos quanto podes poupar.'), cta: () => L('Adicionar rendimento'), run: () => openTxForm({ type: 'income' }), when: (s) => s.inc === 0 }],
  '/orcamentos': [{ id: 'lim', text: () => L('Define um limite mensal para uma categoria. A app avisa quando estiveres perto.'), cta: () => L('Criar limite'), run: press('.fx-page > .sh-pill'), when: (s) => s.limits === 0 }],
  '/metas': [{ id: 'goal', text: () => L('Cria uma meta para transformares o que sobra em poupança.'), cta: () => L('Criar meta'), run: press('.fx-page > .sh-pill'), when: (s) => s.goals === 0 }],
  '/grupos': [{ id: 'grp', text: () => L('Cria um grupo, adiciona pessoas e divide despesas automaticamente.'), cta: () => L('Criar grupo'), run: press('.fx-page > .sh-btn.in'), when: () => !did('group') }],
  '/subscricoes': [{ id: 'rec', text: () => L('Marca despesas que se repetem todos os meses, como renda ou subscrições, para preveres quanto sobra.'), cta: () => L('Novo recorrente'), run: press('.fx-page > .sh-pill'), when: () => !did('recurring') }],
});

export function PageTip() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [s, setS] = useState<Stats | null>(null);
  const [, tick] = useState(0);
  const load = () => {
    if (!tipsOn()) return;
    Promise.all([db.transactions.toArray(), db.goals.toArray(), db.accounts.toArray(), db.budgets.toArray()]).then(([t, g, a, b]) => {
      const live = t.filter((x) => x.deletedAt === null);
      growFrom(live.length);
      setS({ n: live.length, exp: live.filter((x) => x.type === 'expense').length, inc: live.filter((x) => x.type === 'income').length, months: new Set(live.map((x) => x.date.slice(0, 7))).size, goals: g.filter((x) => x.deletedAt === null).length, accounts: a.filter((x) => x.deletedAt === null).length, limits: b.filter((x) => x.deletedAt === null).length });
    }).catch(() => {});
  };
  useEffect(load, [pathname]);
  useTxSaved(load);
  useEffect(() => { const on = () => { tick((n) => n + 1); load(); }; window.addEventListener(TIPS_EVENT, on); window.addEventListener('wallet:guide', on); return () => { window.removeEventListener(TIPS_EVENT, on); window.removeEventListener('wallet:guide', on); }; }, []);
  const tip = tipsOn() && !guiding() && s ? tips((p) => navigate(p))[pathname]?.find((x) => !tipSeen(x.id) && (!x.when || x.when(s))) : undefined;
  if (!tip) return null;
  return (
    <aside key={tip.id} className="tipb" role="note">
      <span className="tipb-ic"><Ic d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" size={20} /></span>
      <p>{tip.text()}</p>
      <button type="button" className="tipb-do" onClick={() => { closeTip(tip.id, 'do'); tip.run?.(); }}>{tip.cta()}</button>
      <button type="button" className="tipb-x" onClick={() => closeTip(tip.id, 'close')} aria-label={L('Fechar')}><Ic d={ICON.close} size={16} /></button>
    </aside>
  );
}

const ARTICLES: Array<[string, string, string[]]> = [
  ['M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', 'Como adicionar despesas', ['Toca no botão + em baixo.', 'Escreve o valor e escolhe a categoria.', 'Toca em Adicionar despesa.']],
  ['M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4z', 'Como criar categorias', ['Abre Categorias no menu.', 'Toca em Nova categoria.', 'Dá-lhe um nome, um ícone e uma cor.']],
  [ICON.wallet, 'Como criar contas', ['Abre Contas.', 'Toca em Criar conta e escolhe o tipo.', 'Escreve o nome e quanto tens.']],
  ['M3 7h18v12H3zM3 11h18M7 15h3', 'Como adicionar salários e rendimentos', ['Abre Salários no menu.', 'Escreve o valor no mês, ou toca em Adicionar salário ou extra.', 'O valor passa a contar no resumo.']],
  ['M12 3a9 9 0 1 0 9 9h-9zM15 3.5V9h5.5A9 9 0 0 0 15 3.5z', 'Como criar limites de gastos', ['Abre Limites.', 'Toca em Novo limite.', 'Escolhe a categoria e o máximo por mês.']],
  ['M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z', 'Como criar metas', ['Abre Metas no menu.', 'Toca em Criar meta e diz quanto queres juntar.', 'Vai juntando dinheiro e vê quanto falta.']],
  ['M12 3l9 5-9 5-9-5zM3 13l9 5 9-5', 'Como usar grupos', ['Abre Grupos e toca em Novo grupo.', 'Liga a divisão e convida as pessoas.', 'Adiciona despesas: cada um vê a sua parte.']],
  ['M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3', 'Como marcar despesas recorrentes', ['Ao adicionar uma despesa, liga Recorrente.', 'Escolhe de quanto em quanto tempo se repete.', 'Vê todas na página Recorrentes.']],
  ['M4 5h16l-6 8v5l-4 2v-7z', 'Como filtrar por período', ['No topo, escolhe Mensal ou Anual.', 'Usa as setas para mudar de mês ou ano.', 'Toca no filtro para escolher outras datas.']],
  ['M4 20V10M10 20V4M16 20v-7M22 20H2', 'Como interpretar o Início', ['O valor grande é o que ainda tens neste mês.', 'A barra mostra quanto do rendimento já gastaste.', 'As comparações são com o mês ou ano anterior.']],
];

export function HelpPage() {
  const [open, setOpen] = useState<number | null>(null), [reset, setReset] = useState(false);
  return (
    <div className="fx-page mv sh hp-page">
      <header className="mv-head"><h1 className="sh-title">{L('Ajuda')}</h1></header>
      <div className="hp-list">{ARTICLES.map(([d, title, steps], i) => (
        <section key={title} className={'mv-card hp-item' + (open === i ? ' open' : '')}>
          <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}><span className="pco-mic"><Ic d={d} size={19} /></span><b>{L(title)}</b><Ic d={ICON.down} size={18} /></button>
          <div className={'acc-exp' + (open === i ? ' open' : '')} aria-hidden={open !== i}><div><ol>{steps.map((x, k) => <li key={x}><i>{k + 1}</i><span>{boldTerms(L(x))}</span></li>)}</ol></div></div>
        </section>
      ))}</div>
      <button type="button" className="ob-cta lg-go hp-tour" onClick={resumeGuide}>{guideStarted() ? L('Continuar a visita guiada') : L('Fazer a visita guiada')}<Ic d="M5 12h14M13 6l6 6-6 6" size={18} /></button>
      <button type="button" className="gl-act hp-reset" disabled={reset} onClick={() => { resetTips(); setReset(true); }}>{reset ? L('As dicas vão voltar a aparecer') : L('Mostrar as dicas outra vez')}</button>
    </div>
  );
}
