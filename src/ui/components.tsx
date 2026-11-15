import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../core/money';

// Percent change helper for the chart tooltip (integer-safe, rounds to 1 decimal).
function pctDelta(now: number, prev: number): number {
  if (!prev) return 0;
  return Math.round(((now - prev) / prev) * 1000) / 10;
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="card">
      {title ? <h2 className="card-title">{title}</h2> : null}
      {children}
    </div>
  );
}

export function StatTile({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className={`stat-value${tone ? ' ' + tone : ''}`}>{value}</span>
    </div>
  );
}

export function OverviewGrid({ tiles }: { tiles: Array<{ label: string; value: string; tone?: 'positive' | 'negative' }> }) {
  return (
    <div className="overview-grid">
      {tiles.map((tile, i) => (
        <div key={i} className="stat-tile">
          <span className="stat-label">{tile.label}</span>
          <span className={`stat-value${tile.tone ? ' ' + tile.tone : ''}`}>{tile.value}</span>
        </div>
      ))}
    </div>
  );
}

export function CategoryRow({ name, left }: { name: string; left: string }) {
  return (
    <div className="category-row">
      <span className="category-name">{name}</span>
      <span className="category-left">{left}</span>
    </div>
  );
}

function smoothPath(points: [number, number][]) {
  if (!points.length) return '';
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
  }
  return d;
}

export function LineChart({ rows, currency, language, incomeLabel = 'Income' }: {
  rows: { label: string; income: number; expense: number }[];
  currency: string;
  language: string;
  incomeLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 260, PAD_X = 14, TOP = 26, BOTTOM = 34;
  const maxVal = Math.max(...rows.map((r) => Math.max(r.income, r.expense)), 1);
  const x = (i: number) =>
    rows.length === 1 ? W / 2 : PAD_X + i * ((W - PAD_X * 2) / (rows.length - 1));
  const y = (v: number) => BOTTOM + (1 - v / maxVal) * (H - TOP - BOTTOM);
  const incomePts = rows.map((r, i) => [x(i), y(r.income)] as [number, number]);
  const expensePts = rows.map((r, i) => [x(i), y(r.expense)] as [number, number]);
  const incomePath = smoothPath(incomePts);
  const expensePath = smoothPath(expensePts);
  const hatchArea = rows.length > 1
    ? `${incomePath} L ${x(rows.length - 1)} ${H - BOTTOM} L ${x(0)} ${H - BOTTOM} Z`
    : '';

  return (
    <div className="line-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="line-chart" role="img">
        <defs>
          <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse"
                   patternTransform="rotate(-45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="#ec6a8f" strokeWidth="1.5" opacity=".3"/>
          </pattern>
        </defs>

        {/* gridlines */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PAD_X} y1={y(maxVal * f)} x2={W - PAD_X} y2={y(maxVal * f)}
                stroke="rgba(148,163,199,.10)" strokeWidth="1"/>
        ))}

        {/* hatched area under the income curve */}
        {hatchArea && <path d={hatchArea} fill="url(#hatch)"/>}

        {/* smooth curves: expense (blue), income (pink) */}
        <path d={expensePath} fill="none" stroke="#4aa8ff" strokeWidth="2.5" opacity=".9"/>
        <path d={incomePath} fill="none" stroke="#ec6a8f" strokeWidth="2.5"/>

        {/* hover point + tooltip */}
        {hover !== null && (
          <g>
            <line x1={x(hover)} y1={TOP - 8} x2={x(hover)} y2={H - BOTTOM + 6}
                  stroke="rgba(255,255,255,.3)" strokeDasharray="4 4"/>
            <circle cx={x(hover)} cy={y(rows[hover].income)} r={5} fill="#ec6a8f"
                    stroke="#fff" strokeWidth="1.5"/>
            <foreignObject x={Math.min(Math.max(x(hover) - 95, 4), W - 194)} y={20} width={190} height={120}>
              <div className="chart-tip">
                <span className="tip-label">{rows[hover].label}</span>
                <p><i className="dot pink"/> {incomeLabel}</p>
                <strong>{formatMoney(rows[hover].income, currency, language)}</strong>
                {hover > 0 && rows[hover - 1].income > 0 && (
                  <em className={`delta ${rows[hover].income >= rows[hover - 1].income ? 'up' : 'down'}`}>
                    {pctDelta(rows[hover].income, rows[hover - 1].income)}%
                  </em>
                )}
              </div>
            </foreignObject>
          </g>
        )}

        {/* invisible hover targets per data point */}
        {rows.map((r, i) => (
          <rect key={r.label} x={x(i) - (W - PAD_X * 2) / (2 * Math.max(rows.length - 1, 1))}
                y={0} width={(W - PAD_X * 2) / Math.max(rows.length - 1, 1)} height={H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}/>
        ))}
      </svg>
      <div className="chart-xlabels">
        {rows.map((r, i) => (
          <span key={r.label} className={hover === i ? 'active' : ''}>{r.label}</span>
        ))}
      </div>
    </div>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = value > max;
  return (
    <div className={`progress-bar${over ? ' over' : ''}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: pct + '%' }} />
    </div>
  );
}

export function Button({ label, variant, disabled, onClick }: { label: string; variant?: 'primary' | 'danger'; disabled?: boolean; onClick?: () => void }) {
  const cls = variant ? `button ${variant}` : 'button';
  return (
    <button type="button" className={cls} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}

export function Input({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label style={{ display: 'block', margin: '8px 0' }}>
      <span className="stat-label">{label}</span>
      <input className="input" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{title}</h2>
        {children}
        <div style={{ marginTop: 12 }}>
          <Button label={t('common.close')} onClick={onClose} />
        </div>
      </div>
    </div>
  );
}

export function TabBar({ tabs, active, onSelect }: { tabs: string[]; active: string; onSelect: (tab: string) => void }) {
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={tab === active}
          className={`tab${tab === active ? ' active' : ''}`}
          onClick={() => onSelect(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

export interface DonutSlice { label: string; value: number; color: string }

export function DonutChart({ slices }: { slices: DonutSlice[] }) {
  const { t } = useTranslation();
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return <p className="stat-label">{t('common.noData')}</p>;

  const r = 60;
  const cx = 70;
  const cy = 70;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const arcs = slices.map((s) => {
    const frac = Math.max(0, s.value) / total;
    const dash = frac * circumference;
    const arc = { color: s.color, dash, offset };
    offset += dash;
    return arc;
  });

  return (
    <div className="donut-wrap">
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Donut chart">
        {arcs.map((a, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={a.color}
            stroke-width="24"
            stroke-dasharray={`${a.dash} ${circumference - a.dash}`}
            stroke-dashoffset={-a.offset}
          />
        ))}
      </svg>
      <ul className="donut-legend">
        {slices.map((s) => (
          <li key={s.label}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label} — {Math.round((s.value / total) * 100)}%
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DemoPage() {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState(t('demo.tabMonth'));
  return (
    <div>
      <Card title={t('demo.statTile')}>
        <StatTile label={t('demo.totalSpent')} value={t('demo.exampleAmount')} tone="negative" />
      </Card>
      <Card title={t('demo.progressBar')}>
        <ProgressBar value={70} max={100} />
        <div style={{ height: 8 }} />
        <ProgressBar value={120} max={100} />
      </Card>
      <Card title={t('demo.buttonsInput')}>
        <Button label={t('demo.primary')} variant="primary" />
        <Button label={t('demo.danger')} variant="danger" />
        <Input label={t('demo.description')} value="" onChange={() => {}} placeholder={t('demo.placeholderExample')} />
      </Card>
      <Card title={t('demo.tabBar')}>
        <TabBar tabs={[t('demo.tabMonth'), t('demo.tabYear'), t('demo.tab30'), t('demo.tab60'), t('demo.tab90')]} active={tab} onSelect={setTab} />
      </Card>
      <Card title={t('demo.donutChart')}>
        <DonutChart
          slices={[
            { label: t('demo.catHome'), value: 400, color: '#2dd4bf' },
            { label: t('demo.catFood'), value: 300, color: '#f87171' },
            { label: t('demo.catTransport'), value: 200, color: '#fbbf24' },
          ]}
        />
      </Card>
      <Button label={t('demo.openModal')} onClick={() => setModalOpen(true)} />
      <Modal title={t('demo.modalTitle')} open={modalOpen} onClose={() => setModalOpen(false)}>
        <p>{t('demo.modalBody')}</p>
      </Modal>
    </div>
  );
}
