import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Transaction, Category } from '../db/database';
import { transactionsOnDay, activeCategories } from '../core/finance';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';

// Prompt 5: clicking a calendar day opens the expense detail for that day.
export default function DayDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ date: string }>();
  const [settings, setSettings] = useState(loadSettings());
  const [cats, setCats] = useState<Category[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);

  useEffect(() => {
    setSettings(loadSettings());
    activeCategories(db).then(setCats);
  }, []);

  useEffect(() => {
    if (!params.date) return;
    transactionsOnDay(db, params.date).then(setTxs);
  }, [params.date]);

  const dayLabel = (() => {
    if (!params.date) return '';
    const [y, m, d] = params.date.split('-').map(Number);
    return new Intl.DateTimeFormat(settings.language, { day: 'numeric', month: 'long', year: 'numeric' })
      .format(new Date(y, m - 1, d));
  })();

  const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? '';
  const total = txs.reduce((sum, tx) => sum + (tx.type === 'expense' ? tx.amountCents : -tx.amountCents), 0);

  return (
    <div>
      <div className="day-detail-head">
        <button className="btn btn-ghost" onClick={() => navigate('/calendario')}>
          ← {t('calendar.backToCalendar')}
        </button>
        <h1 className="page-title">{t('calendar.dayDetailTitle')}</h1>
        <p className="muted">{dayLabel}</p>
      </div>

      <div className="card">
        {txs.length === 0 ? (
          <p className="empty">{t('calendar.noExpenses')}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('transactions.date')}</th>
                <th>{t('transactions.description')}</th>
                <th>{t('transactions.category')}</th>
                <th>{t('transactions.type')}</th>
                <th className="num">{t('transactions.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {txs.map((tx) => (
                <tr key={tx.id}>
                  <td>{tx.date}</td>
                  <td>{tx.description || t('common.noData')}</td>
                  <td>{catName(tx.categoryId)}</td>
                  <td>{tx.type === 'income' ? t('transactions.typeIncome') : t('transactions.typeExpense')}</td>
                  <td className={`num ${tx.type === 'expense' ? 'amount-negative' : 'amount-positive'}`}>
                    {formatMoney(tx.amountCents, settings.currency, settings.language)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>{t('calendar.dayTotal', 'Total do dia')}</td>
                <td className={`num ${total < 0 ? 'amount-negative' : 'amount-positive'}`}>
                  {formatMoney(total, settings.currency, settings.language)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
