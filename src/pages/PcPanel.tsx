// PC (pré-visualização ?pc=mobile): um só Painel com o Início e o Resumo da app de telemóvel juntos,
// com Mês/Ano e as setas do período no topo. Os blocos são os mesmos do telemóvel (SimpleHome / SimpleOverview).
import { useState } from 'react';
import { loadSettings } from '../core/settings';
import { Ic, ICON } from '../ui/fx';
import { SimpleHome, type HomePart } from './SimpleHome';
import { SimpleOverview, type OverviewPart } from './SimplePages';

export function PcPanel() {
  const now = new Date();
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [cur, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const lang = loadSettings().language;
  const shift = (d: number) => setCur((c) => (mode === 'year' ? { y: c.y + d, m: c.m } : { y: c.y + Math.floor((c.m + d) / 12), m: ((c.m + d) % 12 + 12) % 12 }));
  const label = mode === 'year' ? String(cur.y) : new Date(cur.y, cur.m, 1).toLocaleDateString(lang, { month: 'long', year: 'numeric' });
  const home = (part: HomePart) => <SimpleHome key={part + mode + cur.y + cur.m} embed={{ mode, y: cur.y, m: cur.m, part }} />;
  const over = (part: OverviewPart) => <SimpleOverview key={part + mode + cur.y + cur.m} yearly={mode === 'year'} embed={{ y: cur.y, m: cur.m, part }} />;

  return (
    <div className="fx-page pcp">
      <header className="pcp-head">
        <h1>{mode === 'month' ? 'Este mês' : 'O ano todo'}</h1>
        <div className="sh-seg pcp-seg" role="tablist" aria-label="Período">
          <button type="button" role="tab" aria-selected={mode === 'month'} className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>Mês</button>
          <button type="button" role="tab" aria-selected={mode === 'year'} className={mode === 'year' ? 'on' : ''} onClick={() => setMode('year')}>Ano</button>
        </div>
        <div className="sh-monthnav pcp-nav">
          <button type="button" className="mv-chev" onClick={() => shift(-1)} aria-label={mode === 'month' ? 'Mês anterior' : 'Ano anterior'}><Ic d={ICON.left} size={18} /></button>
          <span className="mv-month">{label.charAt(0).toUpperCase() + label.slice(1)}</span>
          <button type="button" className="mv-chev" onClick={() => shift(1)} aria-label={mode === 'month' ? 'Mês seguinte' : 'Ano seguinte'}><Ic d={ICON.right} size={18} /></button>
        </div>
      </header>

      <div className="pcp-grid">
        <div className="pcp-hero">{home('hero')}</div>
        <div className="pcp-chart">{over('chart')}</div>
        <div className="pcp-totals">{over('totals')}</div>
        <div className="pcp-lines">{over('lines')}</div>
        <div className="pcp-cal">{over('cal')}</div>
        <div className="pcp-cats">{over('cats')}</div>
        <div className="pcp-latest">{home('latest')}</div>
        <div className="pcp-goals">{home('goals')}</div>
        <div className="pcp-groups">{home('groups')}</div>
      </div>
    </div>
  );
}
