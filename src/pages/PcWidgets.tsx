// Widgets extra do Resumo do PC (Personalizar > Adicionar widget): contas, limites do mês e assistente.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Account, Budget, Category, Transfer } from '../db/database';
import { accountBalanceCents } from '../core/accounts';
import { Ic, CatIcon, catLabel } from '../ui/fx';
import { L } from '../i18n/phrases';

const live = <T extends { deletedAt: string | null }>(r: T[]) => r.filter((x) => x.deletedAt === null);
const WALLET = 'M3 7h18v12H3zM3 7l3-4h12l3 4M16 13h2';
const LIMIT = 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7v5l3 2';
const SPARK = 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z';
const SEND = 'M4 12l16-8-6 16-2-7z';

function Head({ icon, title, to, link }: { icon: string; title: string; to: string; link: string }) {
  return <div className="pco-mhead"><span className="pco-mic"><Ic d={icon} size={18} /></span><h3>{title}</h3><Link to={to} className="mv-link">{link}</Link></div>;
}

export function AccountsWidget({ money }: { money: (c: number) => string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Array<{ a: Account; bal: number }>>([]);
  useEffect(() => {
    (async () => {
      const accs = live(await db.accounts.toArray()), txs = live(await db.transactions.toArray());
      const trs = live(await db.transfers.toArray()) as Transfer[], sals = live(await db.salaries.toArray());
      const n = new Date();
      const sal = sals.filter((x) => x.year * 100 + x.month <= n.getFullYear() * 100 + n.getMonth() + 1).reduce((a, x) => a + x.amountCents, 0);
      setRows(accs.map((a) => ({ a, bal: accountBalanceCents(a, txs, accs, sal, trs) })));
    })().catch(() => {});
  }, []);
  return (
    <section className="mv-card pco-w">
      <Head icon={WALLET} title={t('pco.accounts')} to="/contas" link={t('blk.seeAll')} />
      <div className="pco-wlist">
        {rows.length === 0 && <p className="fx-muted">{t('pco.noAccounts')}</p>}
        {rows.map(({ a, bal }) => (
          <div key={a.id} className={'pco-acc ' + a.type}>
            <span className="pco-acc-dot" />
            <span className="pco-acc-main"><b>{a.name}</b><small>{t('pco.accType_' + a.type)}</small></span>
            <b className={a.type === 'debt' || bal < 0 ? 'fx-neg' : ''}>{money(bal)}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

export function LimitsWidget({ money, y, m }: { money: (c: number) => string; y: number; m: number }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Array<{ b: Budget; c?: Category; spent: number }>>([]);
  useEffect(() => {
    (async () => {
      const [bs, cs, txs] = [live(await db.budgets.toArray()), live(await db.categories.toArray()), live(await db.transactions.toArray())];
      const pref = `${y}-${String(m + 1).padStart(2, '0')}`;
      setRows(bs.filter((b) => b.year === y && b.month === m + 1).map((b) => ({
        b, c: cs.find((c) => c.id === b.categoryId),
        spent: txs.filter((x) => x.type === 'expense' && x.categoryId === b.categoryId && x.date.startsWith(pref)).reduce((a, x) => a + x.amountCents, 0),
      })).sort((p, q) => q.spent / q.b.limitCents - p.spent / p.b.limitCents));
    })().catch(() => {});
  }, [y, m]);
  return (
    <section className="mv-card pco-w">
      <Head icon={LIMIT} title={L('Limites do mês')} to="/orcamentos" link={rows.length ? t('blk.seeAll') : L('Novo limite')} />
      <div className="pco-wlist">
        {rows.length === 0 && <p className="fx-muted">{L('Sem limites este mês')}</p>}
        {rows.map(({ b, c, spent }) => {
          const r = b.limitCents > 0 ? spent / b.limitCents : 0;
          return (
            <div key={b.id} className="pco-lim">
              <CatIcon cat={c ?? {}} size={32} />
              <span className="pco-acc-main"><b>{c ? catLabel(t, c) : '—'}</b><small>{money(spent)} / {money(b.limitCents)}</small>
                <i className="pco-limbar"><i className={r >= 1 ? 'bad' : r >= 0.8 ? 'warn' : ''} style={{ width: `${Math.min(100, r * 100)}%` }} /></i></span>
              <b className={r >= 1 ? 'fx-neg' : ''}>{Math.round(r * 100)}%</b>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function AssistantWidget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const go = (text: string) => navigate('/assistente?q=' + encodeURIComponent(text));
  const ex = [t('assistant.ex1'), t('assistant.ex2'), t('assistant.ex3')];
  return (
    <section className="mv-card pco-w pco-ai">
      <Head icon={SPARK} title={t('assistant.title')} to="/assistente" link={L('Abrir')} />
      <p className="fx-muted pco-ai-sub">{L('Pergunta qualquer coisa sobre o teu dinheiro.')}</p>
      <div className="pco-ai-ex">{ex.map((e) => <button key={e} type="button" onClick={() => go(e)}>{e}</button>)}</div>
      <form className="pco-ai-in" onSubmit={(e) => { e.preventDefault(); if (q.trim()) go(q.trim()); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('assistant.placeholder')} />
        <button type="submit" aria-label={t('assistant.send')} disabled={!q.trim()}><Ic d={SEND} size={16} /></button>
      </form>
    </section>
  );
}
