import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Transaction, Category } from '../db/database';
import { transactionsOnDay, activeCategories } from '../core/finance';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { catLabel, PageHead, EmptyState, Ic, ICON } from '../ui/fx';

export default function DayDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ date: string }>();
  const settings = loadSettings();
  const [cats, setCats] = useState<Category[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);

  useEffect(() => { activeCategories(db).then(setCats); }, []);
  useEffect(() => { if (params.date) transactionsOnDay(db, params.date).then(setTxs); }, [params.date]);

  const dayLabel = (() => {
    if (!params.date) return '';
    const [y, m, d] = params.date.split('-').map(Number);
    return new Intl.DateTimeFormat(settings.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d));
  })();
  const money = (c: number) => formatMoney(c, settings.currency, settings.language);
  const catOf = (id: string) => cats.find((c) => c.id === id);
  const spent = txs.filter((x) => x.type === 'expense').reduce((s, x) => s + x.amountCents, 0);
  const earned = txs.filter((x) => x.type === 'income').reduce((s, x) => s + x.amountCents, 0);

  return (
    <div className="fx-page">
      <PageHead title={dayLabel} sub={t('calendar.dayDetailTitle')}>
        <button type="button" className="fx-btn" onClick={() => navigate('/calendario')}><Ic d={ICON.left} size={16} />{t('calendar.backToCalendar')}</button>
      </PageHead>
      <div className="fx-kpis" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('overview.expenses')}</div><div className="fx-kpi-value"><span>{money(spent)}</span></div></div>
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('overview.incomes')}</div><div className="fx-kpi-value"><span className="fx-pos">{money(earned)}</span></div></div>
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('calendar.dayTotal')}</div><div className="fx-kpi-value"><span className={earned - spent < 0 ? 'fx-neg' : ''}>{money(earned - spent)}</span></div></div>
      </div>
      <div className="fx-card">
        {txs.length === 0 ? <EmptyState icon={ICON.search} title={t('calendar.noExpenses')} /> : (
          <div className="fx-list">
            {txs.map((x) => {
              const c = catOf(x.categoryId);
              const label = c ? catLabel(t, c) : '';
              return (
                <div className="fx-item" key={x.id}>
                  <div className="fx-avatar" style={{ background: c?.color || 'var(--accent)', color: '#fff' }}>{label.charAt(0).toUpperCase() || '?'}</div>
                  <div className="fx-item-main"><b>{x.description || label}</b><span>{label}</span></div>
                  <span className={'fx-num ' + (x.type === 'income' ? 'fx-pos' : '')}>{x.type === 'income' ? '+' : '−'}{money(x.amountCents)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
