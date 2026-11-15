import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Category, Goal, Recurring, Group } from '../db/database';
import { newId } from '../db/database';
import { addGoal, contributeToGoal, listGoals, estimateGoalCompletion, addRecurring, expandRecurring, addGroup, listGroups } from '../core/finance';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { PageTitle } from './index';
import { Card, Button, ProgressBar } from '../ui/components';

export function Goals() {
  const { t } = useTranslation();
  const settings = loadSettings();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [recurrings, setRecurrings] = useState<Recurring[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [estimates, setEstimates] = useState<Record<string, { months: number | null; date: string | null }>>({});

  const refresh = async () => {
    const gs = await listGoals(db);
    setGoals(gs);
    const est: Record<string, { months: number | null; date: string | null }> = {};
    for (const g of gs) est[g.id] = await estimateGoalCompletion(db, g);
    setEstimates(est);
    setRecurrings(await db.recurrings.filter((r) => r.deletedAt === null).toArray());
    setGroups(await listGroups(db));
    setCats(await db.categories.filter((c) => c.deletedAt === null).toArray());
  };

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, []);

  const createGoal = async () => {
    const name = (document.getElementById('goal-name') as HTMLInputElement)?.value || '';
    const targetRaw = (document.getElementById('goal-target') as HTMLInputElement)?.value || '';
    const start = (document.getElementById('goal-start') as HTMLInputElement)?.value || new Date().toISOString().slice(0, 10);
    const targetDate = (document.getElementById('goal-target-date') as HTMLInputElement)?.value || null;
    const cents = parseMoneyToCents(targetRaw);
    if (!name.trim() || cents === null || cents <= 0) {
      setError(t('transactions.amount') + '?');
      return;
    }
    await addGoal(db, name.trim(), cents, start, targetDate);
    setError(null);
    refresh();
  };

  const contribute = async (goalId: string) => {
    const raw = (document.getElementById(`goal-contribute-${goalId}`) as HTMLInputElement)?.value || '';
    const cents = parseMoneyToCents(raw);
    if (cents === null || cents <= 0) return;
    await contributeToGoal(db, goalId, cents);
    refresh();
  };

  const createRecurring = async () => {
    const desc = (document.getElementById('rec-description') as HTMLInputElement)?.value || '';
    const amountRaw = (document.getElementById('rec-amount') as HTMLInputElement)?.value || '';
    const categoryId = (document.getElementById('rec-category') as HTMLSelectElement)?.value || '';
    const frequency = ((document.getElementById('rec-frequency') as HTMLSelectElement)?.value || 'monthly') as Recurring['frequency'];
    const nextDate = (document.getElementById('rec-next-date') as HTMLInputElement)?.value || new Date().toISOString().slice(0, 10);
    const endDate = (document.getElementById('rec-end-date') as HTMLInputElement)?.value || null;
    const cents = parseMoneyToCents(amountRaw);
    if (!desc.trim() || cents === null || cents <= 0 || !categoryId) {
      setError(t('transactions.amount') + '?');
      return;
    }
    await addRecurring(db, { type: 'expense', categoryId, description: desc.trim(), amountCents: cents, currency: settings.currency, frequency, nextDate, endDate });
    setError(null);
    refresh();
  };

  const expandNow = async () => {
    const until = new Date().toISOString().slice(0, 10);
    const pending = await expandRecurring(db, until);
    if (pending.length === 0) return;
    for (const tx of pending) {
      await db.transactions.add({ ...tx, id: newId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null });
    }
    refresh();
  };

  const createGroup = async () => {
    const name = (document.getElementById('group-name') as HTMLInputElement)?.value || '';
    if (!name.trim()) return;
    await addGroup(db, name.trim(), '#60A5FA');
    refresh();
  };

  return (
    <div className="page">
      <PageTitle titleKey="goals.title" />
      {error && <p className="error">{error}</p>}

      <Card>
        <h3>{t('goals.addGoal')}</h3>
        <div className="budget-row-form">
          <input id="goal-name" type="text" placeholder={t('goals.name')} />
          <input id="goal-target" type="text" placeholder={t('goals.target')} />
          <input id="goal-start" type="date" />
          <input id="goal-target-date" type="date" placeholder={t('goals.targetDate')} />
          <Button label={t('goals.addGoal')} onClick={createGoal} />
        </div>
        {goals.length === 0 && <p>{t('goals.noGoals')}</p>}
        {goals.map((g) => {
          const pct = g.targetCents > 0 ? Math.min(100, (g.currentCents / g.targetCents) * 100) : 0;
          return (
            <div className="budget-row" key={g.id}>
              <div className="budget-row-head">
                <span>{g.name}</span>
                <span>{formatMoney(g.currentCents, settings.currency, settings.language)} / {formatMoney(g.targetCents, settings.currency, settings.language)}</span>
              </div>
              <ProgressBar value={pct} max={100} />
              {estimates[g.id] && (
                <p>
                  {estimates[g.id].months === null
                    ? t('goals.estimateNone')
                    : `${t('goals.estimateLabel')} ${estimates[g.id].months} · ${t('goals.estimateDate')}: ${estimates[g.id].date}`}
                </p>
              )}
              <div className="budget-row-form">
                <input id={`goal-contribute-${g.id}`} type="text" placeholder={t('goals.amount')} />
                <Button label={t('goals.contribute')} onClick={() => contribute(g.id)} />
              </div>
            </div>
          );
        })}
      </Card>

      <Card>
        <h3>{t('goals.recurringTitle')}</h3>
        <div className="budget-row-form">
          <input id="rec-description" type="text" placeholder={t('transactions.description')} />
          <input id="rec-amount" type="text" placeholder={t('goals.amount')} />
          <select id="rec-category">
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.nameKey ? t(c.nameKey) : c.name}</option>
            ))}
          </select>
          <select id="rec-frequency">
            <option value="weekly">{t('goals.weekly')}</option>
            <option value="monthly">{t('goals.monthly')}</option>
            <option value="yearly">{t('goals.yearly')}</option>
          </select>
          <input id="rec-next-date" type="date" />
          <input id="rec-end-date" type="date" placeholder={t('goals.endDate')} />
          <Button label={t('goals.addRecurring')} onClick={createRecurring} />
        </div>
        {recurrings.length === 0 && <p>{t('goals.noGroups')}</p>}
        {recurrings.map((r) => (
          <div className="budget-row" key={r.id}>
            <div className="budget-row-head">
              <span>{r.description}</span>
              <span>{formatMoney(r.amountCents, settings.currency, settings.language)} · {t(`goals.${r.frequency}`)} · {t('goals.nextDate')}: {r.nextDate}</span>
            </div>
          </div>
        ))}
        <Button label={t('goals.addRecurring')} onClick={expandNow} />
      </Card>

      <Card>
        <h3>{t('goals.groupsTitle')}</h3>
        <div className="budget-row-form">
          <input id="group-name" type="text" placeholder={t('goals.groupName')} />
          <Button label={t('goals.addGroup')} onClick={createGroup} />
        </div>
        {groups.length === 0 && <p>{t('goals.noGroups')}</p>}
        {groups.map((g) => (
          <div className="budget-row" key={g.id}>
            <div className="budget-row-head">
              <span>{g.name}</span>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
