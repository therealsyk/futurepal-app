import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Category } from '../db/database';
import { activeCategories, setBudget, budgetUsage } from '../core/finance';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { FREE_LIMITS, withinFreeLimit } from '../core/plan';
import { catLabel, catFitsKind, CategorySelect, Field, PageHead, MonthNav, EmptyState, Ic, ICON, Sheet } from '../ui/fx';

type Usage = { limitCents: number; spentCents: number; remainingCents: number; overBudget: boolean };

export function Budgets() {
  const { t } = useTranslation();
  const settings = loadSettings();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [cats, setCats] = useState<Category[]>([]);
  const [usage, setUsage] = useState<Record<string, Usage>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // Novo orçamento: escolher a categoria e o limite
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const money = (c: number) => formatMoney(c, settings.currency, settings.language);
  const monthNames = t('calendar.monthNames', { returnObjects: true }) as string[];

  const refresh = async () => {
    const active = await activeCategories(db);
    setCats(active);
    const u: Record<string, Usage> = {};
    for (const c of active) u[c.id] = await budgetUsage(db, c.id, year, month);
    setUsage(u);
  };
  useEffect(() => { refresh().catch((e) => setError(String(e))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [year, month]);

  const shift = (d: number) => {
    let m = month + d, y = year;
    if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
    setMonth(m); setYear(y);
  };

  const save = async (id: string) => {
    const cents = parseMoneyToCents(drafts[id] || '');
    if (cents === null || cents <= 0) { setError(t('transactions.amountInvalid')); return; }
    if (!(usage[id]?.limitCents > 0) && !withinFreeLimit('budgets', Object.values(usage).filter((u) => u.limitCents > 0).length)) { setError(t('plus.limitBudgets', { n: FREE_LIMITS.budgets })); return; }
    await setBudget(db, id, cents, year, month);
    setError(null); setDrafts((d) => ({ ...d, [id]: '' }));
    await refresh();
  };

  const remove = async (id: string) => {
    const rows = (await db.budgets.toArray()).filter((b) => b.deletedAt === null && b.categoryId === id && b.year === year && b.month === month);
    for (const b of rows) await db.budgets.update(b.id, { deletedAt: new Date().toISOString() });
    await refresh();
  };

  // Só aparecem as categorias com orçamento neste mês; as outras adicionam-se com "Adicionar orçamento".
  const list = cats.map((c) => ({ c, u: usage[c.id] ?? { limitCents: 0, spentCents: 0, remainingCents: 0, overBudget: false } }))
    .filter((x) => x.u.limitCents > 0);
  const totalLimit = list.reduce((s, x) => s + x.u.limitCents, 0);
  const totalSpent = list.reduce((s, x) => s + x.u.spentCents, 0);
  const over = list.filter((x) => x.u.spentCents > x.u.limitCents).length;
  const free = cats.filter((c) => catFitsKind(c, 'expense') && !(usage[c.id]?.limitCents > 0));

  const openAdd = () => { setNewCat(free[0]?.id ?? ''); setNewAmount(''); setAddError(null); setAdding(true); };
  const addBudget = async () => {
    const cents = parseMoneyToCents(newAmount);
    if (!newCat) { setAddError(t('budgets.pickCategory')); return; }
    if (cents === null || cents <= 0) { setAddError(t('transactions.amountInvalid')); return; }
    if (!withinFreeLimit('budgets', list.length)) { setAddError(t('plus.limitBudgets', { n: FREE_LIMITS.budgets })); return; }
    await setBudget(db, newCat, cents, year, month);
    setAdding(false);
    await refresh();
  };

  return (
    <div className="fx-page">
      <PageHead title={t('budgets.title')} sub={t('budgets.subtitle')}>
        <MonthNav label={`${monthNames[month - 1]} ${year}`} onPrev={() => shift(-1)} onNext={() => shift(1)} />
        <button type="button" className="fx-btn primary" onClick={openAdd} disabled={free.length === 0} data-testid="budget-add"><Ic d={ICON.plus} size={16} />{t('budgets.addNew')}</button>
      </PageHead>
      {error && <p className="fx-error">{error}</p>}

      <div className="fx-kpis">
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('budgets.totalLimit')}</div><div className="fx-kpi-value"><span>{money(totalLimit)}</span></div></div>
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('budgets.spent')}</div><div className="fx-kpi-value"><span>{money(totalSpent)}</span></div><div className="fx-kpi-sub">{totalLimit > 0 ? `${Math.round((totalSpent / totalLimit) * 100)}%` : '—'}</div></div>
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('budgets.left')}</div><div className="fx-kpi-value"><span className={totalLimit - totalSpent < 0 ? 'fx-neg' : 'fx-pos'}>{money(totalLimit - totalSpent)}</span></div></div>
        <div className="fx-card fx-kpi"><div className="fx-kpi-label">{t('budgets.overCount')}</div><div className="fx-kpi-value"><span className={over ? 'fx-neg' : ''}>{over}</span></div></div>
      </div>

      {list.length === 0 ? (
        <div className="fx-card"><EmptyState icon={ICON.wallet} title={t('budgets.noBudgets')} sub={t('budgets.noBudgetsSub')}
          action={<button type="button" className="fx-btn primary" onClick={openAdd} disabled={free.length === 0}><Ic d={ICON.plus} size={16} />{t('budgets.addNew')}</button>} /></div>
      ) : (
        <div className="fx-budget-grid">
          {list.map(({ c, u }) => {
            const pct = u.limitCents > 0 ? Math.min(100, (u.spentCents / u.limitCents) * 100) : 0;
            return (
              <div className="fx-card fx-budget" key={c.id}>
                <div className="fx-acc-top">
                  <div className="fx-avatar" style={{ background: c.color || 'var(--accent)', color: '#fff' }}>{catLabel(t, c).charAt(0).toUpperCase()}</div>
                  <div className="fx-acc-name"><b>{catLabel(t, c)}</b>
                    <span className={u.overBudget ? 'fx-neg' : ''}>{`${money(u.spentCents)} / ${money(u.limitCents)}`}</span></div>
                  {<button type="button" className="fx-round sm" onClick={() => remove(c.id)} aria-label={t('budgets.delete')}><Ic d={ICON.trash} size={15} /></button>}
                </div>
                <div className="fx-track" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><i className={u.overBudget ? 'over' : ''} style={{ width: `${pct}%` }} /></div>
                <div className="fx-inline">
                  <input className="fx-input" inputMode="decimal" placeholder={t('budgets.limit')} value={drafts[c.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [c.id]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') save(c.id); }} aria-label={`${t('budgets.limit')} ${catLabel(t, c)}`} />
                  <button type="button" className="fx-btn" onClick={() => save(c.id)}>{t('budgets.update')}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title={t('budgets.addNew')}
        footer={<><span style={{ flex: 1 }} /><button type="button" className="fx-btn" onClick={() => setAdding(false)}>{t('common.cancel')}</button><button type="button" className="fx-btn primary" onClick={addBudget} data-testid="budget-save">{t('common.add')}</button></>}>
        {addError && <p className="fx-error">{addError}</p>}
        <Field label={t('transactions.category')}>
          <CategorySelect cats={free} value={newCat} onChange={setNewCat} ariaLabel={t('transactions.category')} />
        </Field>
        <Field label={t('budgets.monthlyLimit', { month: `${monthNames[month - 1]} ${year}` })}>
          <input className="fx-input big" inputMode="decimal" placeholder="0,00" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addBudget(); }} />
        </Field>
      </Sheet>
    </div>
  );
}
