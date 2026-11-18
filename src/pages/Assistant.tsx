import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSupabase } from '../auth/supabase';
import { useAuth } from '../auth/AuthContext';
import { db } from '../db/app-db';
import type { Category, Transaction } from '../db/database';
import { activeCategories, addTransaction, periodSummary } from '../core/finance';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { dayTransactions, matchCategory, normalizeIntent, normalizeReceipt, quickIntent, shrinkImage, spendSummary, type Intent } from '../core/assistant';
import { catLabel, Field, Ic, PageHead, Sheet } from '../ui/fx';
import { Locked } from './Premium';

// Assistente FuturePal: perguntas sobre despesas/poupança e fotos de faturas.
// A IA (Edge Function "ai-ask") só interpreta a pergunta ou lê a foto; as contas são feitas aqui.

type Msg = { from: 'me' | 'bot'; text: string };
const CAMERA = 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8';
const SEND = 'M4 12l16-8-6 16-2-7z';

export function AssistantPage() {
  const { t } = useTranslation();
  return (
    <div className="fx-page">
      <PageHead title={t('assistant.title')} sub={t('assistant.sub')} />
      <Locked feature="assistant"><AssistantInner /></Locked>
    </div>
  );
}

function AssistantInner() {
  const { t } = useTranslation();
  const auth = useAuth();
  const s = loadSettings();
  const money = (c: number) => formatMoney(c, s.currency, s.language);
  const fmtDate = (d: string) => d.split('-').reverse().join('/');
  const [msgs, setMsgs] = useState<Msg[]>([{ from: 'bot', text: t('assistant.hello') }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [cats, setCats] = useState<Category[]>([]);
  const [left, setLeft] = useState<{ questions: number; photos: number } | null>(null);
  const [draft, setDraft] = useState<{ description: string; amount: string; date: string; categoryId: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { activeCategories(db).then(setCats).catch(() => {}); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  const labeled = cats.map((c) => ({ id: c.id, label: catLabel(t, c) }));
  const catName = (id: string) => labeled.find((c) => c.id === id)?.label ?? '—';
  const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD local
  const say = (m: Msg) => setMsgs((x) => [...x, m]);

  if (!getSupabase() || !auth.user) {
    return <div className="fx-card"><p>{t('assistant.needLogin')}</p><Link to="/definicoes" className="fx-btn primary">{t('family.goLogin')}</Link></div>;
  }

  /** Chama a Edge Function e traduz os erros conhecidos. */
  const callAi = async (body: Record<string, unknown>): Promise<unknown | null> => {
    const sb = getSupabase()!;
    const { data, error } = await sb.functions.invoke('ai-ask', { body: { ...body, today, lang: s.language, categories: labeled.map((c) => c.label) } });
    let res = data as { ok?: boolean; error?: string; result?: unknown; remaining?: { questions: number; photos: number } } | null;
    if (error) { try { res = await (error as { context?: Response }).context?.json(); } catch { res = null; } }
    if (!res?.ok) {
      const code = res?.error ?? 'ai_error';
      say({ from: 'bot', text: t('assistant.err_' + (['coming_soon', 'no_subscription', 'quota', 'paused', 'bad_image'].includes(code) ? code : 'ai_error')) });
      return null;
    }
    if (res.remaining) setLeft(res.remaining);
    return res.result ?? null;
  };

  /** Responde com os dados do aparelho. */
  const answer = async (it: Intent): Promise<string> => {
    const txs: Transaction[] = (await db.transactions.toArray()).filter((x) => x.deletedAt === null);
    const period = it.from === it.to ? fmtDate(it.from) : t('assistant.range', { from: fmtDate(it.from), to: fmtDate(it.to) });
    if (it.type === 'day') {
      const list = dayTransactions(txs, it.from);
      const exp = list.filter((x) => x.type === 'expense');
      if (list.length === 0) return t('assistant.dayNone', { date: period });
      const lines = list.slice(0, 8).map((x) => `• ${x.description || catName(x.categoryId)}: ${x.type === 'income' ? '+' : '−'}${money(x.amountCents)}`);
      return [t('assistant.dayYes', { date: period, count: exp.length, total: money(exp.reduce((a, x) => a + x.amountCents, 0)) }), ...lines].join('\n');
    }
    if (it.type === 'savings') {
      const p = await periodSummary(db, it.from, it.to);
      const lines = [t('assistant.savings', { period, income: money(p.incomeCents), spent: money(p.totalSpentCents), saved: money(p.savingsCents) })];
      if (p.incomeCents > 0) lines.push(t('assistant.savingsPct', { pct: Math.round(p.pctSavings * 100) }));
      if (p.incomeCents === 0) lines.push(t('assistant.noIncome'));
      return lines.join('\n');
    }
    const cat = it.type === 'category' ? matchCategory(it.category, labeled) : null;
    if (it.type === 'category' && !cat) return t('assistant.noCategory', { name: it.category ?? '' });
    const sum = spendSummary(txs, it.from, it.to, cat?.id);
    if (sum.count === 0) return t('assistant.noSpend', { period });
    const head = cat
      ? t('assistant.catSpent', { name: cat.label, period, total: money(sum.totalCents), count: sum.count })
      : t('assistant.spent', { period, total: money(sum.totalCents), count: sum.count, avg: money(sum.avgPerDayCents) });
    if (cat) return head;
    const top = sum.byCategory.slice(0, it.type === 'top' ? 5 : 3).map((c) => `• ${catName(c.categoryId)}: ${money(c.cents)} (${Math.round((c.cents / sum.totalCents) * 100)}%)`);
    return [head, t('assistant.topCats'), ...top].join('\n');
  };

  const ask = async (q: string) => {
    q = q.trim();
    if (!q || busy) return;
    setText('');
    say({ from: 'me', text: q });
    setBusy(true);
    try {
      let it = quickIntent(q, today); // perguntas simples: sem IA, sem custo
      if (!it) {
        const raw = await callAi({ mode: 'intent', text: q });
        if (raw === null) return;
        it = normalizeIntent(raw, today);
      }
      say({ from: 'bot', text: it.type === 'unknown' ? t('assistant.unknown') : await answer(it) });
    } catch {
      say({ from: 'bot', text: t('assistant.err_ai_error') });
    } finally { setBusy(false); }
  };

  const photo = async (file: File | undefined) => {
    if (!file || busy) return;
    say({ from: 'me', text: t('assistant.photoSent') });
    setBusy(true);
    try {
      const image = await shrinkImage(file);
      const raw = await callAi({ mode: 'receipt', image });
      if (raw === null) return;
      const r = normalizeReceipt(raw, today);
      if (!r) { say({ from: 'bot', text: t('assistant.photoFail') }); return; }
      const cat = matchCategory(r.category, labeled) ?? labeled.find((c) => /outr|other/i.test(c.label)) ?? labeled[0];
      setDraft({ description: r.description, amount: (r.amountCents / 100).toFixed(2).replace('.', ','), date: r.date, categoryId: cat?.id ?? '' });
      say({ from: 'bot', text: t('assistant.photoRead', { total: money(r.amountCents), date: fmtDate(r.date) }) });
    } catch {
      say({ from: 'bot', text: t('assistant.photoFail') });
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const saveDraft = async () => {
    if (!draft) return;
    const cents = parseMoneyToCents(draft.amount) ?? 0;
    if (cents <= 0 || !draft.categoryId) return;
    await addTransaction(db, { date: draft.date, type: 'expense', categoryId: draft.categoryId, description: draft.description, amountCents: cents, currency: s.currency });
    say({ from: 'bot', text: t('assistant.added', { total: money(cents), category: catName(draft.categoryId), date: fmtDate(draft.date) }) });
    setDraft(null);
  };

  const examples = [t('assistant.ex1'), t('assistant.ex2'), t('assistant.ex3'), t('assistant.ex4')];

  return (
    <div className="as-wrap">
      <div className="fx-card as-chat">
        {msgs.map((m, i) => <div key={i} className={'as-msg ' + m.from}>{m.text}</div>)}
        {busy && <div className="as-msg bot as-typing">…</div>}
        <div ref={endRef} />
      </div>
      {msgs.length <= 1 && (
        <div className="as-examples">
          {examples.map((e) => <button key={e} type="button" className="pm-chip" onClick={() => ask(e)}>{e}</button>)}
        </div>
      )}
      <form className="as-input" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <button type="button" className="fx-btn" title={t('assistant.photo')} aria-label={t('assistant.photo')} disabled={busy} onClick={() => fileRef.current?.click()}><Ic d={CAMERA} /></button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => photo(e.target.files?.[0])} />
        <input className="fx-input" value={text} maxLength={500} placeholder={t('assistant.placeholder')} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="fx-btn primary" disabled={busy || !text.trim()} aria-label={t('assistant.send')}><Ic d={SEND} /></button>
      </form>
      <p className="fx-muted fx-small">{t('assistant.privacy')}{left ? ' ' + t('assistant.left', { q: left.questions, p: left.photos }) : ''}</p>

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={t('assistant.confirmTitle')}
        footer={<><span style={{ flex: 1 }} /><button type="button" className="fx-btn" onClick={() => setDraft(null)}>{t('common.cancel')}</button><button type="button" className="fx-btn primary" onClick={saveDraft}>{t('common.add')}</button></>}>
        {draft && <>
          <p className="fx-muted fx-small">{t('assistant.confirmSub')}</p>
          <Field label={t('family.what')}><input className="fx-input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
          <div className="fx-two">
            <Field label={t('family.amount')}><input className="fx-input" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} /></Field>
            <Field label={t('family.date')}><input className="fx-input" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
          </div>
          <Field label={t('assistant.category')}>
            <select className="fx-input" value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
              {labeled.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
        </>}
      </Sheet>
    </div>
  );
}
