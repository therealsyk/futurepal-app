// Resumo do PC (pré-visualização ?pc=mobile): organização da imagem de referência, com as peças da app de telemóvel.
//  Em cima: Resumo mensal / Resumo anual + período + conta.
//  1.ª linha: Análise de rendimentos (gráfico do PC) | 3 caixas (Rendimento, Gastei, Saldo — no ano: Ganhei, Gastei, Poupei)
//  2.ª linha: Últimos movimentos | Para onde foi o dinheiro | Calendário de gastos
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Transaction } from '../db/database';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { Ic, ICON } from '../ui/fx';
import { AccountBar } from '../ui/AccountBar';
import { OverviewChart } from './Dashboard';
import { SimpleHome } from './SimpleHome';
import { SimpleOverview } from './SimplePages';

const IC = {
  income: 'M12 19V5M5 12l7-7 7 7',
  spent: 'M12 5v14M5 12l7 7 7-7',
  saved: 'M19 7a3 3 0 0 0-3-2H9a6 6 0 0 0-6 6c0 2 1 3.5 2 4.5V19h3v-2h5v2h3v-3a6 6 0 0 0 2-3h2V9h-2zM15 10h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
};

function Metric({ icon, tone, title, value, valueClass, delta, deltaGoodUp, prevName, sub, bar }: {
  icon: string; tone: 'inc' | 'exp' | 'sav'; title: string; value: string; valueClass?: string;
  delta: number | null; deltaGoodUp: boolean; prevName: string; sub?: string; bar: number;
}) {
  const pct = delta === null ? null : Math.round(delta * 100);
  const good = pct === null || pct === 0 ? null : (pct > 0) === deltaGoodUp;
  return (
    <section className={'mv-card pco-metric ' + tone}>
      <div className="pco-mhead">
        <span className="pco-mic"><Ic d={icon} size={18} /></span>
        <h3>{title}</h3>
        {pct !== null && <span className={'pco-delta ' + (good === null ? 'same' : good ? 'good' : 'bad')}>{pct > 0 ? '+' : ''}{pct}% <small>vs {prevName}</small></span>}
      </div>
      <strong className={'pco-value ' + (valueClass ?? '')}>{value}</strong>
      {sub && <small className="pco-sub">{sub}</small>}
      <div className="pco-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, Math.min(100, bar * 100))}%` }} /></div>
    </section>
  );
}

export function PcOverview() {
  const { t } = useTranslation();
  const s = loadSettings();
  const money = (c: number) => formatMoney(c, s.currency, s.language);
  const now = new Date();
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [cur, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [txs, setTxs] = useState<Transaction[]>([]);
  useEffect(() => { db.transactions.toArray().then((r) => setTxs(r.filter((x) => x.deletedAt === null))).catch(() => {}); }, []);

  const shift = (d: number) => setCur((c) => (mode === 'year' ? { y: c.y + d, m: c.m } : { y: c.y + Math.floor((c.m + d) / 12), m: ((c.m + d) % 12 + 12) % 12 }));
  const key = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;
  const sum = (pref: string) => {
    let inc = 0, exp = 0;
    for (const x of txs) if (x.date.startsWith(pref)) { if (x.type === 'income') inc += x.amountCents; else exp += x.amountCents; }
    return { inc, exp };
  };
  const yearly = mode === 'year';
  const pref = yearly ? String(cur.y) : key(cur.y, cur.m);
  const prevPref = yearly ? String(cur.y - 1) : key(cur.m === 0 ? cur.y - 1 : cur.y, (cur.m + 11) % 12);
  const a = sum(pref), p = sum(prevPref);
  const left = a.inc - a.exp, prevLeft = p.inc - p.exp;
  const delta = (n: number, b: number) => (b === 0 ? null : (n - b) / Math.abs(b));
  const isNowMonth = cur.y === now.getFullYear() && cur.m === now.getMonth();
  const days = isNowMonth ? now.getDate() : new Date(cur.y, cur.m + 1, 0).getDate();
  const months = cur.y === now.getFullYear() ? now.getMonth() + 1 : 12;
  const prevName = yearly ? String(cur.y - 1) : new Date(cur.y, cur.m - 1, 1).toLocaleDateString(s.language, { month: 'long' });
  const label = yearly ? String(cur.y) : new Date(cur.y, cur.m, 1).toLocaleDateString(s.language, { month: 'long', year: 'numeric' });

  // gráfico: os 12 meses do ano escolhido
  const series = Array.from({ length: 12 }, (_, i) => {
    const v = sum(key(cur.y, i));
    const mName = new Date(cur.y, i, 1).toLocaleDateString(s.language, { month: 'short' }).replace('.', '');
    return { label: mName, tick: mName, earning: v.inc, spending: v.exp };
  });
  const upTo = cur.y < now.getFullYear() ? 11 : cur.y === now.getFullYear() ? now.getMonth() : 0;
  const ratio = (x: number) => (a.inc > 0 ? x / a.inc : 0);

  return (
    <div className="fx-page pco">
      <header className="pco-head">
        <div className="pco-title">
          <div className="sh-seg pco-seg" role="tablist" aria-label="Resumo">
            <button type="button" role="tab" aria-selected={!yearly} className={!yearly ? 'on' : ''} onClick={() => setMode('month')}>Resumo mensal</button>
            <button type="button" role="tab" aria-selected={yearly} className={yearly ? 'on' : ''} onClick={() => setMode('year')}>Resumo anual</button>
          </div>
          <div className="sh-monthnav pco-nav">
            <button type="button" className="mv-chev" onClick={() => shift(-1)} aria-label={yearly ? 'Ano anterior' : 'Mês anterior'}><Ic d={ICON.left} size={18} /></button>
            <span className="mv-month">{label.charAt(0).toUpperCase() + label.slice(1)}</span>
            <button type="button" className="mv-chev" onClick={() => shift(1)} aria-label={yearly ? 'Ano seguinte' : 'Mês seguinte'}><Ic d={ICON.right} size={18} /></button>
          </div>
        </div>
        <AccountBar />
      </header>

      <div className="pco-grid">
        <section className="mv-card pco-chart">
          <div className="pco-mhead"><span className="pco-mic"><Ic d={IC.chart} size={18} /></span><h3>Análise de rendimentos</h3>
            <span className="pco-legend"><i className="inc" />Rendimentos <i className="exp" />Despesas</span></div>
          <OverviewChart series={series} upTo={upTo} money={money} t={t} />
        </section>

        <div className="pco-metrics">
          <Metric icon={IC.income} tone="inc" title={yearly ? 'Ganhei este ano' : 'Rendimento este mês'} value={money(a.inc)} valueClass="fx-pos"
            delta={delta(a.inc, p.inc)} deltaGoodUp prevName={prevName} bar={a.inc > 0 ? 1 : 0} />
          <Metric icon={IC.spent} tone="exp" title={yearly ? 'Gastei este ano' : 'Já gastei'} value={money(a.exp)} valueClass={a.exp > 0 ? 'fx-neg' : ''}
            delta={delta(a.exp, p.exp)} deltaGoodUp={false} prevName={prevName} bar={ratio(a.exp)}
            sub={yearly ? `Em média ${money(Math.round(a.exp / months))} por mês` : `Em média ${money(Math.round(a.exp / days))} por dia`} />
          <Metric icon={IC.saved} tone="sav" title={yearly ? 'Poupei este ano' : 'Ainda tenho'} value={money(left)} valueClass={left < 0 ? 'fx-neg' : 'fx-pos'}
            delta={delta(left, prevLeft)} deltaGoodUp prevName={prevName} bar={ratio(Math.max(0, left))}
            sub={yearly ? `Em média ${money(Math.round(left / months))} por mês` : undefined} />
        </div>

        <div className="pco-latest"><SimpleHome key={'l' + mode + pref} embed={{ mode, y: cur.y, m: cur.m, part: 'latest' }} /></div>
        <div className="pco-cats"><SimpleOverview key={'c' + mode + pref} yearly={yearly} embed={{ y: cur.y, m: cur.m, part: 'cats' }} /></div>
        <div className="pco-cal"><SimpleOverview key={'k' + mode + pref} yearly={yearly} embed={{ y: cur.y, m: cur.m, part: 'cal' }} /></div>
      </div>
    </div>
  );
}
