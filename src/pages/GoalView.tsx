// Metas: cartão da lista (anel com a percentagem) e página de uma meta, com tudo o que se pode fazer nela.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db/app-db';
import type { Account, Goal } from '../db/database';
import { contributeToGoal, removeGoalEntry, withdrawFromGoal } from '../core/finance';
import { joinDesc, splitDesc } from '../core/debtPlan';
import { parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { appConfirm } from '../ui/confirm';
import { AmountField } from '../ui/formFields';
import { fill } from '../ui/AccountPlan';
import { useMissing, FormError } from '../ui/missing';
import { Ic, ICON } from '../ui/fx';
import { GoalRing } from '../ui/GoalRing';
import { PC_MOBILE } from '../core/uiMode';
import { L } from '../i18n/phrases';
import { BottomSheet } from './SimplePages';
import { CALENDAR, GTile } from './Split';
import { DayRows, SecHead } from './DebtBoost';

const I = {
  add: 'M12 5v14M5 12h14', take: 'M5 12h14', edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4', swap: 'M7 7h12l-3-3M17 17H5l3 3',
  flag: 'M6 21V4h11l-2 4 2 4H6', clock: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7v5l3 2',
};

export interface GoalInfo { cur: number; r: number; eta: string; per: number; done: boolean; when: { ok: boolean; short: string; long: string } | null; long: string }

export function GoalCard({ g, acc, icon, info, money, onOpen, i }: { g: Goal; acc?: Account; icon?: string; info: GoalInfo; money: (c: number) => string; onOpen: () => void; i: number }) {
  return (
    <button type="button" className="mv-card gl-card" style={{ '--i': i } as CSSProperties} onClick={onOpen}>
      <GoalRing r={info.r} size={86} debt={acc?.type === 'debt'} />
      <span className="gl-main">
        {acc && <span className={'goal-acc t-' + acc.type}><Ic d={icon!} size={14} />{acc.type === 'debt' ? L('Conta de dívida') : L('Conta de poupança')}</span>}
        <b className="gl-name">{g.name}</b>
        <span className="gl-money"><b className={info.cur < 0 ? 'fx-neg' : ''}>{money(info.cur)}</b> {L('de')} {money(g.targetCents)}</span>
        <span className="gl-chips">
          {info.done ? <em className="ok">{L('Objetivo atingido 🎉')}</em> : info.eta ? <em><Ic d={I.flag} size={13} />{info.eta}</em> : <em className="dim">{L('Ainda não dá para prever')}</em>}
          {g.paused && (!g.paused.until || g.paused.until >= new Date().toISOString().slice(0, 10)) ? <em className="paused"><Ic d="M8 5v14M16 5v14" size={13} />{L('Em pausa')}</em>
            : info.when && <em className={info.when.ok ? 'ok' : 'bad'}><Ic d={I.clock} size={13} />{info.when.ok ? L('A tempo') : L('Atrasada')}</em>}
        </span>
      </span>
      <span className="gl-go"><Ic d={ICON.right} size={18} /></span>
    </button>
  );
}

/** Juntar ou tirar dinheiro. */
function MoveSheet({ g, take, money, onClose, onDone }: { g: Goal; take: boolean; money: (c: number) => string; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState(''), [err, setErr] = useState('');
  const c = Math.abs(parseMoneyToCents(v || '0') ?? 0), missing = useMissing(), left = Math.max(0, g.targetCents - g.currentCents);
  const miss = missing([['v', L('o valor'), c > 0]]);
  const save = async () => {
    if (!miss.check()) return;
    if (take && c > g.currentCents) { setErr(fill(L('Só tens {m} nesta meta.'), { m: money(g.currentCents) })); return; }
    await (take ? withdrawFromGoal(db, g.id, c) : contributeToGoal(db, g.id, c));
    onDone();
  };
  const quick = take ? [g.currentCents] : [...[1000, 2500, 5000, 10000].filter((x) => x < left), ...(left > 0 ? [left] : [])];
  return (
    <BottomSheet title={take ? L('Tirar dinheiro') : L('Juntar dinheiro')} onClose={onClose}>
      <div className="acc-form">
        {miss.note}{err && <FormError text={err} />}
        <AmountField value={v} onChange={(x) => { setV(x); setErr(''); }} currency={loadSettings().currency} kind={take ? 'expense' : 'income'} cls={miss.cls('v')} autoFocus={PC_MOBILE} />
        <div className="gl-quick">{quick.map((q) => <button key={q} type="button" className={q === c ? 'on' : ''} onClick={() => { setV(String(q / 100).replace('.', ',')); setErr(''); }}>{take ? `${L('Tudo')} · ${money(q)}` : q === left ? `${L('Tudo o que falta')} · ${money(q)}` : money(q)}</button>)}</div>
        <p className="gl-hint">{L('Fica anotado na meta. O saldo das tuas contas não muda.')}</p>
        <button type="button" className="tx-addbtn" onClick={save}>{take ? L('Tirar dinheiro') : L('Juntar dinheiro')}</button>
      </div>
    </BottomSheet>
  );
}

export function GoalView({ g, acc, info, extra, accounts, valueOf, money, date, onBack, onEdit, reload }: {
  extra?: ReactNode; g: Goal; acc?: Account; info: GoalInfo; accounts: Account[]; valueOf: (a: Account) => number; money: (c: number) => string; date: (iso: string) => string; onBack: () => void; onEdit: () => void; reload: () => void;
}) {
  const [move, setMove] = useState<'' | 'add' | 'take'>(''), [all, setAll] = useState(false);
  const debt = acc?.type === 'debt', linked = accounts.filter((a) => g.accountIds?.includes(a.id)), hand = !g.accountIds?.length;
  const left = Math.max(0, g.targetCents - info.cur), note = splitDesc(g.notes), monthly = note.plan?.monthlyCents ?? 0;
  const log = (g.contributions ?? []).map((c, idx) => ({ ...c, idx })).reverse();
  const plans = [3, 6, 12, 24].map((n) => ({ n, m: Math.ceil(left / n / 100) * 100 }));
  const setPlan = async (m: number) => {
    if (!(await appConfirm(fill(L('Passar a juntar {m} por mês nesta meta?'), { m: money(m) }), { ok: L('Sim') }))) return;
    await db.goals.update(g.id, { notes: joinDesc(note.text, { monthlyCents: m, startCents: 0 }), updatedAt: new Date().toISOString() });
    reload();
  };
  const del = async () => {
    if (!(await appConfirm(`${L('Apagar meta')} "${g.name}"?`, { danger: true }))) return;
    const now = new Date().toISOString();
    await db.goals.update(g.id, { deletedAt: now, updatedAt: now });
    onBack(); reload();
  };
  const delEntry = async (idx: number, c: number) => {
    if (!(await appConfirm(fill(L('Apagar este registo de {m}?'), { m: money(Math.abs(c)) }), { danger: true }))) return;
    await removeGoalEntry(db, g.id, idx); reload();
  };
  return (
    <div className="fx-page mv sh gl-page">
      <header className="mv-head"><button type="button" className="mv-sq" onClick={onBack} aria-label={L('Voltar')}><Ic d={ICON.left} size={20} /></button><h1 className="sh-title">{g.name}</h1></header>
      <section className="mv-hero sh-hero gl-hero">
        <GoalRing r={info.r} size={176} debt={debt}><b>{Math.round(info.r * 100)}%</b><small>{info.done ? '🎉' : L('completo')}</small></GoalRing>
        <div className="gl-sum">
          <div className="gl-have"><small>{debt ? L('Já pagaste') : L('Já tens')}</small><b className={info.cur < 0 ? 'fx-neg' : 'fx-pos'}>{money(info.cur)}</b><small>{L('de')} {money(g.targetCents)}</small></div>
          {!acc && linked.length > 0 && <div className="gl-accs">{linked.map((a2) => <span key={a2.id} className="gl-note gl-acc"><Ic d={ICON.wallet} size={14} /><span>{a2.name}</span><b className={valueOf(a2) < 0 ? 'fx-neg' : 'fx-pos'}>{money(valueOf(a2))}</b></span>)}</div>}
          {note.text && <p className="gl-note" title={L('Notas')}><Ic d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" size={14} /><span>{note.text}</span></p>}
          <div className="gl-acts">
            {hand ? <>
              <button type="button" className="gl-act main" onClick={() => setMove('add')}><Ic d={I.add} size={18} />{L('Juntar')}</button>
              <button type="button" className="gl-act" disabled={g.currentCents <= 0} onClick={() => setMove('take')}><Ic d={I.take} size={18} />{L('Tirar')}</button>
            </> : linked[0] && <Link className="gl-act main" to={`/transacoes?nova=1&para=${linked[0].id}`}><Ic d={I.swap} size={18} />{debt ? L('Abater') : L('Juntar')}</Link>}
            {acc ? <Link className="gl-act" to={'/contas' + (acc.type === 'debt' || acc.type === 'savings' ? `?tab=${acc.type}` : '')}><Ic d={ICON.wallet} size={18} />{L('Ver conta')}</Link> : <button type="button" className="gl-act" onClick={onEdit}><Ic d={I.edit} size={18} />{L('Alterar')}</button>}
          </div>
        </div>
      </section>
      <div className="gx-tiles even">
        <GTile d="M12 19V5M5 12l7-7 7 7" tone={left > 0 ? 'neg' : 'pos'} label={debt ? L('Falta pagar') : L('Falta')} value={money(left)} />
        <GTile d={CALENDAR} label={L('Por mês')} value={info.per > 0 ? money(info.per) : '—'} />
        <GTile d={I.flag} label={debt ? L('Acabas em') : L('Chegas lá em')} value={info.done ? L('Já chegaste') : info.eta || '—'} />
        <GTile d={I.clock} label={L('Data limite')} value={g.targetDate ? date(g.targetDate) : L('Sem data')} />
      </div>
      {!debt && <section className="mv-card gl-sec">
        <h2>{L('Previsão')}</h2>
        <p className="fx-muted">{info.long}</p>
        {info.when && <p className={'sh-alert' + (info.when.ok ? ' ok' : '')}>{info.when.long}</p>}
      </section>}
      {extra}
      {!acc && left > 0 && <section className="mv-card gl-sec">
        <h2>{L('Quando queres lá chegar?')}</h2>
        <p className="gl-sub">{L('Carrega numa opção para juntares esse valor todos os meses.')}</p>
        <div className="gl-plans gp">{plans.map((p, i) => {
          const on = monthly === p.m;
          const end = new Date(); end.setMonth(end.getMonth() + p.n);
          return (
            <button key={p.n} type="button" className={'gp-opt' + (on ? ' on' : '')} style={{ ['--i' as string]: i, ['--speed' as string]: 1 - i * 0.22 }} onClick={() => setPlan(p.m)} aria-pressed={on}>
              <span className="gp-top"><span className="gp-ic"><Ic d={['M13 2 4 14h7l-1 8 9-12h-7z', 'M12 6v6l4 2M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z', 'M5 5h14v15H5zM5 10h14M9 3v4M15 3v4', 'M3 17l6-6 4 4 8-8M14 7h7v7'][i] ?? 'M12 6v6l4 2'} size={16} /></span>
                <small>{p.n === 12 ? L('Em 1 ano') : p.n === 24 ? L('Em 2 anos') : fill(L('Em {d} meses'), { d: String(p.n) })}</small>
                {on && <span className="gp-check"><Ic d="M20 6 9 17l-5-5" size={13} /></span>}</span>
              <b className="gp-val">{money(p.m)}<em>/{L('mês')}</em></b>
              <span className="gp-track"><i /></span>
              <small className="gp-end">{L('Chegas lá em')} {end.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</small>
            </button>
          );
        })}</div>
      </section>}
      {hand && log.length > 0 && <section className="mv-card gl-sec">
        <SecHead title={L('O que já juntaste')} more={log.length > 5 && <button type="button" className="gl-seemore" onClick={() => setAll(!all)}>{all ? L('Ver menos') : `${L('Ver mais')} (${log.length})`}<Ic d={all ? 'M6 15l6-6 6 6' : 'M9 6l6 6-6 6'} size={15} /></button>} />
        <DayRows rows={(all ? log : log.slice(0, 5)).map((c) => ({ ...c, id: String(c.idx) }))} lang={loadSettings().language} render={(c) => (
          <div key={c.id} className="sh-tx gl-tx">
            <span className={'txs-tric' + (c.cents < 0 ? ' out' : '')}><Ic d={c.cents < 0 ? I.take : I.add} size={17} /></span>
            <span className="sh-tx-main"><b>{c.cents < 0 ? L('Tirar dinheiro') : L('Juntar dinheiro')}</b><small>{g.name}</small></span>
            <b className={c.cents < 0 ? 'fx-neg' : 'fx-pos'}>{c.cents > 0 ? '+' : ''}{money(c.cents)}</b>
            <button type="button" className="gl-x" onClick={() => delEntry(c.idx, c.cents)} aria-label={L('Apagar')}><Ic d={ICON.trash} size={16} /></button>
          </div>
        )} />
      </section>}
      {!acc && <div className="gx-end gl-end"><button type="button" className="gx-rm" onClick={del}><Ic d={ICON.trash} size={18} />{L('Apagar meta')}</button></div>}
      {move && <MoveSheet g={g} take={move === 'take'} money={money} onClose={() => setMove('')} onDone={() => { setMove(''); reload(); }} />}
    </div>
  );
}
