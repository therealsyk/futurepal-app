import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Category } from '../db/database';
import { activeCategories, setBudget, budgetUsage } from '../core/finance';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { PageTitle } from './index';
import { Card, Button, ProgressBar } from '../ui/components';

export function Budgets() {
  const { t } = useTranslation();
  const settings = loadSettings();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [cats, setCats] = useState<Category[]>([]);
  const [usage, setUsage] = useState<Record<string, { limitCents: number; spentCents: number; remainingCents: number; overBudget: boolean }>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const active = await activeCategories(db);
    setCats(active);
    const budgets = (await db.budgets.toArray()).filter((b) => b.deletedAt === null && b.year === year && b.month === month);
    const lim: Record<string, number> = {};
    for (const b of budgets) lim[b.categoryId] = b.limitCents;
    const u: Record<string, { limitCents: number; spentCents: number; remainingCents: number; overBudget: boolean }> = {};
    for (const c of active) u[c.id] = await budgetUsage(db, c.id, year, month);
    setUsage(u);
  };

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, []);

  const submitLimit = async (categoryId: string) => {
    const raw = document.getElementById(`budget-limit-${categoryId}`) as HTMLInputElement | null;
    if (!raw) return;
    const cents = parseMoneyToCents(raw.value);
    if (cents === null || cents <= 0) {
      setError(t('transactions.amount') + '?');
      return;
    }
    await setBudget(db, categoryId, cents, year, month);
    setError(null);
    refresh();
  };

  const removeLimit = async (categoryId: string) => {
    const budgets = (await db.budgets.toArray()).filter((b) => b.deletedAt === null && b.categoryId === categoryId && b.year === year && b.month === month);
    for (const b of budgets) await db.budgets.update(b.id, { deletedAt: new Date().toISOString() });
    refresh();
  };

  return (
    <div className="page">
      <PageTitle titleKey="budgets.title" />
      {error && <p className="error">{error}</p>}
      <Card>
        <h3>{t('budgets.addBudget')}</h3>
        {cats.length === 0 && <p>{t('budgets.noBudgets')}</p>}
        <div className="budget-list">
          {cats.map((c) => {
            const label = c.nameKey ? t(c.nameKey) : c.name;
            const u = usage[c.id] ?? { limitCents: 0, spentCents: 0, remainingCents: 0, overBudget: false };
            return (
              <div className="budget-row" key={c.id}>
                <div className="budget-row-head">
                  <span>{label}</span>
                  {u.limitCents > 0 ? (
                    <span className={u.overBudget ? 'over' : ''}>
                      {formatMoney(u.spentCents, settings.currency, settings.language)}
                      {' · '}
                      {u.overBudget ? t('budgets.over') : `${formatMoney(u.remainingCents, settings.currency, settings.language)} ${t('budgets.left')}`}
                    </span>
                  ) : null}
                </div>
                {u.limitCents > 0 && <ProgressBar value={u.spentCents} max={u.limitCents} />}
                <div className="budget-row-form">
                  <input id={`budget-limit-${c.id}`} type="text" placeholder={t('budgets.limit')} />
                  <Button label={t('budgets.addBudget')} onClick={() => submitLimit(c.id)} />
                  {u.limitCents > 0 && (
                    <Button label={t('budgets.delete')} onClick={() => removeLimit(c.id)} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
