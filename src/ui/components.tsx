import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
