import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import * as XLSX from 'xlsx';
import { db } from '../db/app-db';
import type { Category, Transaction } from '../db/database';
import { activeCategories, addTransaction, setSalary } from '../core/finance';
import { syncSalaryTransactions } from '../core/salaryTx';
import { listAccounts, ensureDefaultAccount } from '../core/accounts';
import { formatMoney } from '../core/money';
import { loadSettings } from '../core/settings';
import { chat, isConfigured, loadAiConfig } from '../core/ai';
import {
  bestTable, decodeText, parseOFX, parseQIF, rowsFromText, pdfText, suggestCategory, dupKey, rowsFromAiJson, detectSalaryRows,
  AI_EXTRACT_PROMPT, type StatementRow,
} from '../core/statementImport';
import { CategorySelect, catLabel, Ic, ICON } from '../ui/fx';

// Importar extrato bancário / documento -> pré-visualização -> transações.
type Line = StatementRow & { key: string; selected: boolean; dup: boolean; categoryId: string };
type Phase = 'pick' | 'reading' | 'review' | 'done';

const ACCEPT = '.csv,.txt,.xlsx,.xls,.ods,.ofx,.qfx,.qif,.pdf,image/*';

export function ImportStatement({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation();
  const settings = loadSettings();
  const money = (c: number) => formatMoney(c, settings.currency, settings.language);
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('pick');
  const [drag, setDrag] = useState(false);
  const [fileName, setFileName] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [accountId, setAccountId] = useState('');
  const [message, setMessage] = useState('');
  const [aiSource, setAiSource] = useState<{ text?: string; image?: string } | null>(null);
  const [positiveAre, setPositiveAre] = useState<'expense' | 'income'>('expense');
  const [imported, setImported] = useState(0);
  const ai = loadAiConfig();
  const aiReady = isConfigured(ai);

  useEffect(() => {
    (async () => {
      setCats(await activeCategories(db));
      await ensureDefaultAccount(db, settings.currency, t('accounts.mainName')); // app nova: ainda sem contas
      const accs = (await listAccounts(db)).filter((a) => a.type !== 'debt');
      setAccounts(accs);
      setAccountId((accs.find((a) => a.isDefault) ?? accs[0])?.id ?? '');
    })().catch(() => {});
  }, []);

  const hasUnsigned = lines.some((l) => l.signed === false);

  async function toLines(rows: StatementRow[]) {
    const existing = (await db.transactions.toArray()).filter((x: Transaction) => x.deletedAt === null);
    const seen = new Set(existing.map(dupKey));
    const history = existing.map((x) => ({ description: x.description, categoryId: x.categoryId }));
    const byName = (name?: string) => {
      if (!name) return undefined;
      const n = name.toLowerCase();
      return cats.find((c) => catLabel(t, c).toLowerCase() === n || c.name.toLowerCase() === n)?.id;
    };
    const inFile = new Set<string>();
    // Salários: pelas palavras ou por se repetirem todos os meses; vão para a aba Salários.
    const typed = rows.map((r) => ({ ...r, type: r.signed === false ? positiveAre : r.type }));
    const salaryIdx = detectSalaryRows(typed);
    const salaryCat = cats.find((c) => c.nameKey === 'catSalary')?.id;
    // meses que já têm salário na aba Salários: o salário do extrato desse mês seria repetido
    const salaryMonths = new Set((await db.salaries.toArray()).filter((x) => x.deletedAt === null && x.amountCents > 0).map((x) => `${x.year}-${String(x.month).padStart(2, '0')}`));
    return typed.map((r, i) => {
      const type = r.type;
      const key = dupKey(r);
      const isSalary = type === 'income' && salaryIdx.has(i) && !!salaryCat;
      const dup = seen.has(key) || (isSalary && salaryMonths.has(r.date.slice(0, 7)));
      inFile.add(key);
      const categoryId = isSalary ? salaryCat! : byName(r.category) ?? suggestCategory(r.description, type, cats, history) ?? cats[0]?.id ?? '';
      return { ...r, type, key: key + '#' + i, dup, selected: !dup, categoryId };
    });
  }

  async function show(rows: StatementRow[], source?: { text?: string; image?: string }) {
    if (rows.length === 0) {
      setAiSource(source ?? null);
      setMessage(source ? (aiReady ? t('importer.noRowsTryAi') : t('importer.noRowsNoAi')) : t('importer.noRows'));
      setPhase('pick');
      return;
    }
    setLines(await toLines(rows));
    setMessage('');
    setPhase('review');
  }

  async function onFile(file: File) {
    setFileName(file.name); setMessage(''); setAiSource(null); setPhase('reading');
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    try {
      if (file.type.startsWith('image/')) {
        const image = await new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = ko; r.readAsDataURL(file); });
        if (aiReady) { await runAi({ image }); return; }
        await show([], { image });
        return;
      }
      const buf = await file.arrayBuffer();
      if (ext === 'ofx' || ext === 'qfx') { await show(parseOFX(decodeText(buf))); return; }
      if (ext === 'qif') { await show(parseQIF(decodeText(buf))); return; }
      if (ext === 'pdf') {
        const text = await pdfText(buf);
        await show(rowsFromText(text), { text });
        return;
      }
      if (ext === 'txt') { const text = decodeText(buf); await show(rowsFromText(text), { text }); return; }
      // CSV: descodificado aqui (UTF-8 ou Windows-1252) e lido como texto, sem o SheetJS adivinhar datas/números.
      // Excel/ODS: todas as folhas; fica a que tiver mais movimentos.
      const wb = ext === 'csv'
        ? XLSX.read(decodeText(buf), { type: 'string', raw: true })
        : XLSX.read(buf, { type: 'array', cellDates: true });
      const tables = wb.SheetNames.map((n) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true, blankrows: false }));
      const rows = bestTable(tables);
      if (rows.length) { await show(rows); return; }
      await show([], { text: XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]) });
    } catch (err) {
      setMessage(t('importer.readError', { error: String((err as Error)?.message ?? err) }));
      setPhase('pick');
    }
  }

  async function runAi(source: { text?: string; image?: string }) {
    setPhase('reading'); setMessage(t('importer.aiWorking'));
    try {
      const content = source.image
        ? [{ type: 'text' as const, text: AI_EXTRACT_PROMPT }, { type: 'image' as const, dataUrl: source.image }]
        : AI_EXTRACT_PROMPT + '\n\nDOCUMENT:\n' + (source.text ?? '').slice(0, 60000);
      const reply = await chat(ai, [{ role: 'user', content }], 4000);
      const rows = rowsFromAiJson(reply);
      if (rows.length === 0) { setMessage(t('importer.aiNothing')); setPhase('pick'); return; }
      await show(rows);
    } catch (err) {
      setMessage(t('importer.aiError', { error: String((err as Error)?.message ?? err) }));
      setPhase('pick');
    }
  }

  function flipUnsigned(v: 'expense' | 'income') {
    setPositiveAre(v);
    setLines((ls) => ls.map((l) => (l.signed === false ? { ...l, type: v } : l)));
  }

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const selected = useMemo(() => lines.filter((l) => l.selected), [lines]);
  const totals = useMemo(() => ({
    out: selected.filter((l) => l.type === 'expense').reduce((a, l) => a + l.amountCents, 0),
    in: selected.filter((l) => l.type === 'income').reduce((a, l) => a + l.amountCents, 0),
  }), [selected]);

  async function doImport() {
    let n = 0;
    // Salários: somados por mês e guardados na aba Salários (que cria a transação de rendimento).
    // Um mês que já tenha salário não é mexido, para não duplicar.
    const salaryCat = cats.find((c) => c.nameKey === 'catSalary')?.id;
    const isSal = (l: Line) => l.type === 'income' && !!salaryCat && l.categoryId === salaryCat;
    const perMonth = new Map<string, number>();
    for (const l of selected.filter(isSal)) perMonth.set(l.date.slice(0, 7), (perMonth.get(l.date.slice(0, 7)) ?? 0) + l.amountCents);
    if (perMonth.size) {
      const have = new Set((await db.salaries.toArray()).filter((x) => x.deletedAt === null && x.amountCents > 0).map((x) => `${x.year}-${String(x.month).padStart(2, '0')}`));
      for (const [ym, cents] of perMonth) {
        if (have.has(ym)) continue;
        await setSalary(db, +ym.slice(0, 4), +ym.slice(5, 7), cents);
        n++;
      }
      await syncSalaryTransactions(db).catch(() => {});
    }
    for (const l of selected) {
      if (isSal(l)) continue;
      try {
        await addTransaction(db, { date: l.date, type: l.type, categoryId: l.categoryId, description: l.description, amountCents: l.amountCents, currency: settings.currency, accountId: accountId || undefined });
        n++;
      } catch { /* linha inválida: ignora e continua */ }
    }
    setImported(n);
    setPhase('done');
    onDone?.();
  }

  if (phase === 'done') {
    return (
      <div className="im-done" role="status">
        <span className="im-done-ic"><Ic d={ICON.check} size={28} /></span>
        <b>{t('importer.doneTitle', { count: imported })}</b>
        <span className="fx-muted">{t('importer.doneSub')}</span>
        <button type="button" className="fx-btn" onClick={() => { setLines([]); setPhase('pick'); }}>{t('importer.another')}</button>
      </div>
    );
  }

  if (phase !== 'review') {
    return (
      <div className="im-pick">
        <button type="button" className={'im-drop' + (drag ? ' drag' : '') + (phase === 'reading' ? ' busy' : '')} onClick={() => fileRef.current?.click()} disabled={phase === 'reading'}
          onDragOver={(e) => { e.preventDefault(); if (!drag) setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }} data-testid="import-drop">
          <span className="im-orb" aria-hidden="true">
            {phase === 'reading' ? <i className="im-spin" /> : <Ic d="M12 16V4M7 9l5-5 5 5M4 20h16" size={26} />}
          </span>
          <b>{phase === 'reading' ? t('importer.reading', { name: fileName }) : t('importer.pick')}</b>
          <span className="im-fmts">{t('importer.formats').split(/,\s*|\s+(?:ou|or|o)\s+/).filter(Boolean).map((f, i) => <em key={f} style={{ '--i': i } as CSSProperties}>{f}</em>)}</span>
        </button>
        <input ref={fileRef} hidden type="file" accept={ACCEPT} data-testid="import-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        {message && <p className="im-msg" role="status"><Ic d="M12 8v5M12 16h.01M12 3l9 16H3z" size={16} />{message}</p>}
        {aiSource && aiReady && <button type="button" className="fx-btn primary" onClick={() => runAi(aiSource)}>{t('importer.useAi')}</button>}
        <div className="im-tips">
          {[
            ['M3 21h18M5 21V10M19 21V10M12 3 3 8h18zM9 21v-6h6v6', t('importer.tipBank')],
            ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z', t('importer.tipAi') + (aiReady ? '' : ' ' + t('importer.tipAiOff'))],
            ['M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5zM12 15v2', t('importer.tipPrivacy')],
          ].map(([d, txt], i) => <div key={i} className="im-tip" style={{ '--i': i } as CSSProperties}><span className="im-tic"><Ic d={d} size={17} /></span><p>{txt}</p></div>)}
        </div>
        <p className="im-local"><span className="im-lock"><Ic d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4" size={15} /></span>{t('importer.localOnly')}</p>
      </div>
    );
  }

  return (
    <div className="im-review">
      <div className="im-bar">
        <span><b>{fileName}</b> · {t('importer.found', { count: lines.length })}{lines.some((l) => l.dup) ? ' · ' + t('importer.dups', { count: lines.filter((l) => l.dup).length }) : ''}</span>
        <label className="im-acc">{t('importer.account')}
          <select className="fx-input pill" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>
      {hasUnsigned && (
        <div className="im-note">
          <span>{t('importer.unsigned')}</span>
          <div className="fx-seg sm" role="group">
            <button type="button" className={positiveAre === 'expense' ? 'on' : ''} onClick={() => flipUnsigned('expense')}>{t('importer.asExpense')}</button>
            <button type="button" className={positiveAre === 'income' ? 'on' : ''} onClick={() => flipUnsigned('income')}>{t('importer.asIncome')}</button>
          </div>
        </div>
      )}
      <div className="im-table" role="table" aria-label={t('importer.preview')}>
        <div className="im-row head" role="row">
          <span><input type="checkbox" aria-label={t('importer.selectAll')} checked={selected.length === lines.length} onChange={(e) => setLines((ls) => ls.map((l) => ({ ...l, selected: e.target.checked })))} /></span>
          <span>{t('transactions.date')}</span><span>{t('transactions.description')}</span><span>{t('transactions.category')}</span><span>{t('importer.type')}</span><span className="num">{t('transactions.amount')}</span>
        </div>
        {lines.map((l) => (
          <div key={l.key} className={'im-row' + (l.selected ? '' : ' off') + (l.dup ? ' dup' : '')} role="row">
            <span><input type="checkbox" checked={l.selected} onChange={(e) => update(l.key, { selected: e.target.checked })} aria-label={l.description} /></span>
            <span className="im-date">{l.date}</span>
            <span className="im-desc">{l.description}{l.dup && <em>{t('importer.dupTag')}</em>}</span>
            <span><CategorySelect cats={cats} value={l.categoryId} onChange={(v) => update(l.key, { categoryId: v })} ariaLabel={t('transactions.category')} /></span>
            <span>
              <button type="button" className={'im-type ' + l.type} onClick={() => update(l.key, { type: l.type === 'expense' ? 'income' : 'expense' })}>
                {l.type === 'expense' ? t('importer.expense') : t('importer.income')}
              </button>
            </span>
            <span className={'num ' + (l.type === 'income' ? 'fx-pos' : '')}>{(l.type === 'income' ? '+' : '−') + money(l.amountCents)}</span>
          </div>
        ))}
      </div>
      <div className="im-foot">
        <span className="fx-muted fx-small">{t('importer.summary', { count: selected.length, out: money(totals.out), in: money(totals.in) })}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="fx-btn" onClick={() => { setLines([]); setPhase('pick'); }}>{t('common.cancel')}</button>
        <button type="button" className="fx-btn primary" disabled={selected.length === 0 || !accountId} onClick={doImport} data-testid="import-confirm">{t('importer.import', { count: selected.length })}</button>
      </div>
    </div>
  );
}
