import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Transaction, Category, Group } from '../db/database';
import { addTransaction, softDelete, activeCategories, addCategory, filterTransactions, listGroups } from '../core/finance';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { PageTitle } from './index';
import { Card, Button, Input } from '../ui/components';

const catLabel = (t: (k: string) => string, c: Category): string => (c.nameKey ? t(c.nameKey) : c.name);

export function Transactions() {
  const { t } = useTranslation();
  const settings = loadSettings();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [txs, setTxs] = useState<Transaction[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  // filters (SPEC §6.2): month, category, text
  const [filterMonth, setFilterMonth] = useState<number>(month);
  const [filterCat, setFilterCat] = useState('');
  const [filterText, setFilterText] = useState('');
  const [filterGroup, setFilterGroup] = useState('');

  // table sorting: column + direction
  const [sortCol, setSortCol] = useState<'date' | 'amount'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // form state
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(now.toISOString().slice(0, 10));
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [categoryId, setCategoryId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);

  // category form
  const [newCatName, setNewCatName] = useState('');
  const [catError, setCatError] = useState<string | null>(null);

  const refresh = async () => {
    const rows = await filterTransactions(db, { year, month: filterMonth, categoryId: filterCat || undefined, text: filterText, groupId: filterGroup || undefined });
    setTxs(rows);
    setCats(await activeCategories(db));
    setGroups(await listGroups(db));
    if (!categoryId && cats.length === 0) {
      const first = await activeCategories(db);
      if (first.length > 0) setCategoryId(first[0].id);
    }
  };

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [filterMonth, filterCat, filterText, filterGroup]);

  const submit = async () => {
    setError(null);
    const cents = parseMoneyToCents(amount);
    if (cents === null || cents <= 0) {
      setError(t('transactions.amount') + '?');
      return;
    }
    if (!categoryId) return;
    try {
      await addTransaction(db, {
        date,
        type,
        categoryId,
        description: description.trim(),
        amountCents: cents,
        currency: settings.currency,
        groupId: groupId || undefined,
      });
      setDescription('');
      setAmount('');
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async (id: string) => {
    await softDelete(db, 'transactions', id);
    await refresh();
  };

  const addNewCategory = async () => {
    setCatError(null);
    const name = newCatName.trim();
    if (!name) return;
    try {
      const cat = await addCategory(db, { name, color: '#9CA3AF', icon: '', order: cats.length });
      setNewCatName('');
      setCategoryId(cat.id);
      await refresh();
    } catch (e) {
      setCatError(t('transactions.maxCategories'));
    }
  };

  return (
    <div>
      <PageTitle titleKey="transactions.title" />

      <Card title={t('transactions.addTransaction')}>
        {error && <p className="stat-label">{error}</p>}
        <Input label={t('transactions.description')} value={description} onChange={setDescription} placeholder={t('demo.placeholderExample')} />
        <Input label={t('transactions.amount')} value={amount} onChange={setAmount} placeholder="12,50" />
        <Input label={t('transactions.date')} value={date} onChange={setDate} type="date" />
        <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
          <button type="button" className={`tab${type === 'expense' ? ' active' : ''}`} onClick={() => setType('expense')}>
            {t('transactions.typeExpense')}
          </button>
          <button type="button" className={`tab${type === 'income' ? ' active' : ''}`} onClick={() => setType('income')}>
            {t('transactions.typeIncome')}
          </button>
        </div>
        <label style={{ display: 'block', margin: '8px 0' }}>
          <span className="stat-label">{t('transactions.category')}</span>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {catLabel(t, c)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'block', margin: '8px 0' }}>
          <span className="stat-label">{t('goals.groupName')}</span>
          <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">—</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </label>
        <Button label={t('common.add')} variant="primary" onClick={submit} />
      </Card>

      <Card title={t('transactions.manageCategories')}>
        {catError && <p className="stat-label">{catError}</p>}
        <Input label={t('transactions.newCategoryName')} value={newCatName} onChange={setNewCatName} />
        <Button label={t('common.add')} onClick={addNewCategory} />
      </Card>

      <Card title={t('transactions.filterMonth')}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label>
            <span className="stat-label">{t('transactions.filterMonth')}</span>
            <select className="input" data-testid="filter-month" value={filterMonth} onChange={(e) => setFilterMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="stat-label">{t('transactions.filterCategory')}</span>
            <select className="input" data-testid="filter-cat" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
              <option value="">{t('transactions.allCategories')}</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>{catLabel(t, c)}</option>
              ))}
            </select>
          </label>
          <Input label={t('transactions.filterText')} value={filterText} onChange={setFilterText} />
          <label>
            <span className="stat-label">{t('goals.groupsTitle')}</span>
            <select className="input" data-testid="filter-group" value={filterGroup} onChange={(e) => setFilterGroup(e.target.value)}>
              <option value="">—</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {txs.length === 0 ? (
        <p className="stat-label">{t('transactions.empty')}</p>
      ) : (
        <div className="tx-table-wrap">
          <table className="tx-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => { setSortCol('date'); setSortDir(sortCol === 'date' && sortDir === 'desc' ? 'asc' : 'desc'); }}>
                  {t('transactions.date')} {sortCol === 'date' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th>{t('transactions.description')}</th>
                <th>{t('transactions.category')}</th>
                <th>{t('transactions.typeExpense')}</th>
                <th className="sortable" onClick={() => { setSortCol('amount'); setSortDir(sortCol === 'amount' && sortDir === 'desc' ? 'asc' : 'desc'); }}>
                  {t('transactions.amount')} {sortCol === 'amount' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...txs].sort((a, b) => {
                const cmp = sortCol === 'date' ? a.date.localeCompare(b.date) : a.amountCents - b.amountCents;
                return sortDir === 'asc' ? cmp : -cmp;
              }).map((tx) => {
                const cat = cats.find((c) => c.id === tx.categoryId);
                return (
                  <tr key={tx.id}>
                    <td>{tx.date}</td>
                    <td>{tx.description || (cat ? catLabel(t, cat) : '')}</td>
                    <td>{cat ? catLabel(t, cat) : ''}</td>
                    <td>{tx.type === 'income' ? t('transactions.typeIncome') : t('transactions.typeExpense')}</td>
                    <td className={tx.type === 'income' ? 'positive' : ''}>
                      {formatMoney(tx.amountCents, tx.currency, settings.language)}
                    </td>
                    <td>
                      <Button label={t('common.delete')} variant="danger" onClick={() => remove(tx.id)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
