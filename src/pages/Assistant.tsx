import { LockedPreview } from '../ui/LockedPreview';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSupabase } from '../auth/supabase';
import { useAuth } from '../auth/AuthContext';
import { db } from '../db/app-db';
import type { Category, Transaction } from '../db/database';
import { activeCategories, addTransaction, periodSummary } from '../core/finance';
import { formatMoney, parseMoneyToCents } from '../core/money';
import { loadSettings } from '../core/settings';
import { dayTransactions, matchCategory, normalizeIntent, normalizeReceipt, quickIntent, shrinkImage, spendSummary, type Intent } from '../core/assistant';
import { chat, isConfigured, loadAiConfig, type AiConfig, type ChatMessage } from '../core/ai';
import { catFitsKind, catLabel, Field, Ic, Sheet } from '../ui/fx';
import { DatePicker } from '../ui/DatePicker';
import { AiSettings } from './AiSettings';
import { usePlan } from './Premium';
import { L } from '../i18n/phrases';

// Assistente FuturePal: conversa no ecrã todo.
//  - Com a IA do FuturePal (Edge Function "ai-ask"): a IA só interpreta a pergunta ou lê a foto; as contas são feitas aqui.
//  - Com o modelo da própria pessoa (chave API em "Modelo de IA"): perguntas simples respondidas aqui, o resto vai ao modelo
//    com um resumo das finanças (totais e categorias, sem dados pessoais além das descrições recentes).

type Msg = { id: number; from: 'me' | 'bot'; text: string };
const CAMERA = 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8';
const SEND = 'M4 12l16-8-6 16-2-7z';
const SPARK = 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z';
const CHIP = 'M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M6 6h12v12H6zM10 10h4v4h-4z';
const NEW = 'M12 5v14M5 12h14';
let nextId = 1;

export function AssistantPage() {
  const { has } = usePlan();
  const [cfg, setCfg] = useState<AiConfig>(loadAiConfig());
  const own = isConfigured(cfg);
  return <AssistantChat own={own} cfg={cfg} onCfg={setCfg} allowed={own || has('assistant')} />;
}

function AssistantChat({ own, cfg, onCfg, allowed }: { own: boolean; cfg: AiConfig; onCfg: (c: AiConfig) => void; allowed: boolean }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const s = loadSettings();
  const money = (c: number) => formatMoney(c, s.currency, s.language);
  const fmtDate = (d: string) => d.split('-').reverse().join('/');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [cats, setCats] = useState<Category[]>([]);
  const [left, setLeft] = useState<{ questions: number; photos: number } | null>(null);
  const [draft, setDraft] = useState<{ description: string; amount: string; date: string; categoryId: string } | null>(null);
  const [models, setModels] = useState(false);
  const [params, setParams] = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { activeCategories(db).then(setCats).catch(() => {}); }, []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, busy]);
  useEffect(() => { const el = inputRef.current; if (el) { el.style.height = 'auto'; el.style.height = Math.min(160, el.scrollHeight) + 'px'; } }, [text]);

  const labeled = cats.map((c) => ({ id: c.id, label: catLabel(t, c) }));
  const expenseCats = cats.filter((c) => catFitsKind(c, 'expense')).map((c) => ({ id: c.id, label: catLabel(t, c) }));
  const catName = (id: string) => labeled.find((c) => c.id === id)?.label ?? '—';
  const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD local
  const say = (from: Msg['from'], txt: string) => setMsgs((x) => [...x, { id: nextId++, from, text: txt }]);
  const serverOk = !!getSupabase() && !!auth.user;
  const ready = allowed && (own || serverOk);

  /** IA do FuturePal (Edge Function) — traduz os erros conhecidos. */
  const callAi = async (body: Record<string, unknown>): Promise<unknown | null> => {
    const sb = getSupabase()!;
    const { data, error } = await sb.functions.invoke('ai-ask', { body: { ...body, today, lang: s.language, categories: labeled.map((c) => c.label) } });
    let res = data as { ok?: boolean; error?: string; result?: unknown; remaining?: { questions: number; photos: number } } | null;
    if (error) { try { res = await (error as { context?: Response }).context?.json(); } catch { res = null; } }
    if (!res?.ok) {
      const code = res?.error ?? 'ai_error';
      say('bot', t('assistant.err_' + (['coming_soon', 'no_subscription', 'quota', 'paused', 'bad_image'].includes(code) ? code : 'ai_error')));
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

  /** Resumo das finanças para o modelo da própria pessoa. */
  const context = async (): Promise<string> => {
    const txs: Transaction[] = (await db.transactions.toArray()).filter((x) => x.deletedAt === null);
    const d = new Date();
    const iso = (x: Date) => x.toLocaleDateString('sv-SE');
    const m0 = iso(new Date(d.getFullYear(), d.getMonth(), 1)), p0 = iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), p1 = iso(new Date(d.getFullYear(), d.getMonth(), 0));
    const q0 = iso(new Date(d.getFullYear(), d.getMonth() - 3, 1));
    const cur = await periodSummary(db, m0, today), prev = await periodSummary(db, p0, p1);
    const top = spendSummary(txs, q0, today).byCategory.slice(0, 8).map((c) => `${catName(c.categoryId)}: ${money(c.cents)}`).join('; ');
    const recent = [...txs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15)
      .map((x) => `${x.date} ${x.type === 'income' ? '+' : '-'}${money(x.amountCents)} ${x.description || catName(x.categoryId)}`).join('\n');
    return [
      `Hoje: ${today}. Moeda: ${s.currency}. Responde no idioma ${s.language}, de forma curta, simples e amigável (a pessoa pode não perceber nada de finanças).`,
      `Este mês: rendimento ${money(cur.incomeCents)}, gastos ${money(cur.totalSpentCents)}, poupança ${money(cur.savingsCents)}.`,
      `Mês passado: rendimento ${money(prev.incomeCents)}, gastos ${money(prev.totalSpentCents)}, poupança ${money(prev.savingsCents)}.`,
      `Gastos por categoria (últimos 3 meses): ${top || 'sem dados'}.`,
      `Últimos movimentos:\n${recent || 'nenhum'}`,
    ].join('\n');
  };

  const ask = async (q: string) => {
    q = q.trim();
    if (!q || busy || !ready) return;
    setText('');
    const history = msgs;
    say('me', q);
    setBusy(true);
    try {
      const it = quickIntent(q, today); // perguntas simples: sem IA, sem custo
      if (it) { say('bot', await answer(it)); return; }
      if (own) {
        const conv: ChatMessage[] = [
          { role: 'system', content: 'És o assistente da app FuturePal, uma app de finanças pessoais. Usa só os dados abaixo; se não souberes, diz que não sabes.\n' + await context() },
          ...history.slice(-10).map((m): ChatMessage => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text })),
          { role: 'user', content: q },
        ];
        say('bot', (await chat(cfg, conv)).trim() || t('assistant.unknown'));
        return;
      }
      const raw = await callAi({ mode: 'intent', text: q });
      if (raw === null) return;
      const parsed = normalizeIntent(raw, today);
      say('bot', parsed.type === 'unknown' ? t('assistant.unknown') : await answer(parsed));
    } catch (e) {
      say('bot', own ? `${t('assistant.err_ai_error')}\n${e instanceof Error ? e.message : ''}` : t('assistant.err_ai_error'));
    } finally { setBusy(false); inputRef.current?.focus(); }
  };

  // vindo do widget do Resumo: /assistente?q=...
  useEffect(() => {
    const q = params.get('q');
    if (q && ready && cats.length) { setParams({}, { replace: true }); ask(q); }
  }, [params, ready, cats.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const photo = async (file: File | undefined) => {
    if (!file || busy) return;
    say('me', t('assistant.photoSent'));
    setBusy(true);
    try {
      const image = await shrinkImage(file);
      const raw = await callAi({ mode: 'receipt', image });
      if (raw === null) return;
      const r = normalizeReceipt(raw, today);
      if (!r) { say('bot', t('assistant.photoFail')); return; }
      const cat = matchCategory(r.category, expenseCats) ?? expenseCats.find((c) => /outr|other/i.test(c.label)) ?? expenseCats[0];
      setDraft({ description: r.description, amount: (r.amountCents / 100).toFixed(2).replace('.', ','), date: r.date, categoryId: cat?.id ?? '' });
      say('bot', t('assistant.photoRead', { total: money(r.amountCents), date: fmtDate(r.date) }));
    } catch {
      say('bot', t('assistant.photoFail'));
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const saveDraft = async () => {
    if (!draft) return;
    const cents = parseMoneyToCents(draft.amount) ?? 0;
    if (cents <= 0 || !draft.categoryId) return;
    await addTransaction(db, { date: draft.date, type: 'expense', categoryId: draft.categoryId, description: draft.description, amountCents: cents, currency: s.currency });
    say('bot', t('assistant.added', { total: money(cents), category: catName(draft.categoryId), date: fmtDate(draft.date) }));
    setDraft(null);
  };

  const examples = [t('assistant.ex1'), t('assistant.ex2'), t('assistant.ex3'), t('assistant.ex4')];
  const modelName = own ? cfg.model : L('IA do FuturePal');

  let blocked: ReactNode = null;
  if (!allowed) blocked = <LockedPreview kind="chat" title={t('plus.lockedTitle')} text={t('plus.feat_assistant')} action={<><Link to="/plus" className="fx-btn primary">{t('plus.seePlans')}</Link><button type="button" className="fx-btn" onClick={() => setModels(true)}>{L('Já tenho outra IA (avançado)')}</button></>} />;
  else if (!ready) blocked = <LockedPreview kind="chat" title={t('assistant.needLogin')} text={L('Pergunta em português sobre os teus gastos e recebe respostas e dicas para poupar.')} action={<><Link to="/definicoes" className="fx-btn primary">{t('family.goLogin')}</Link><button type="button" className="fx-btn" onClick={() => setModels(true)}>{L('Já tenho outra IA (avançado)')}</button></>} />;

  return (
    <div className="fx-page ai-page">
      <header className="ai-top">
        <span className="ai-logo"><Ic d={SPARK} size={22} /></span>
        <div className="ai-title"><h1>{t('assistant.title')}</h1><small><i className="ai-online" />{busy ? L('A pensar…') : t('assistant.sub')}</small></div>
        <button type="button" className="ai-model" onClick={() => setModels(true)} title={L('Modelo de IA')}><Ic d={CHIP} size={17} /><span>{modelName}</span><Ic d="M6 9l6 6 6-6" size={14} /></button>
        {msgs.length > 0 && <button type="button" className="ai-new" onClick={() => { setMsgs([]); setDraft(null); }} title={L('Novo chat')} aria-label={L('Novo chat')}><Ic d={NEW} size={18} /></button>}
      </header>

      {blocked ?? (<>
        <div className="ai-list" ref={listRef}>
          {msgs.length === 0 && (
            <div className="ai-empty">
              <span className="ai-orb"><Ic d={SPARK} size={34} /></span>
              <h2>{t('assistant.hello')}</h2>
              <div className="ai-ex">{examples.map((e, i) => <button key={e} type="button" style={{ animationDelay: `${i * 70}ms` }} onClick={() => ask(e)}>{e}</button>)}</div>
            </div>
          )}
          {msgs.map((m) => (
            <div key={m.id} className={'ai-row ' + m.from}>
              {m.from === 'bot' && <span className="ai-av"><Ic d={SPARK} size={15} /></span>}
              <div className="ai-bubble">{m.text}</div>
            </div>
          ))}
          {busy && <div className="ai-row bot"><span className="ai-av"><Ic d={SPARK} size={15} /></span><div className="ai-bubble ai-typing"><i /><i /><i /></div></div>}
        </div>

        <form className="ai-input" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
          {!own && <button type="button" className="ai-ibtn" title={t('assistant.photo')} aria-label={t('assistant.photo')} disabled={busy} onClick={() => fileRef.current?.click()}><Ic d={CAMERA} size={20} /></button>}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => photo(e.target.files?.[0])} />
          <textarea ref={inputRef} rows={1} value={text} maxLength={1000} placeholder={t('assistant.placeholder')} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text); } }} />
          <button type="submit" className="ai-send" disabled={busy || !text.trim()} aria-label={t('assistant.send')}><Ic d={SEND} size={19} /></button>
        </form>
        <p className="ai-foot">{t('assistant.privacy')}{left ? ' ' + t('assistant.left', { q: left.questions, p: left.photos }) : ''}</p>
      </>)}

      <Sheet open={models} onClose={() => setModels(false)} title={L('Modelo de IA')}>
        <p className="fx-muted fx-small">{L('Escolhe o fornecedor, cola a tua chave API e o modelo. Sem chave, usa a IA do FuturePal.')}</p>
        <AiSettings onSaved={(c) => { onCfg(loadAiConfig()); void c; }} />
      </Sheet>

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={t('assistant.confirmTitle')}
        footer={<><span style={{ flex: 1 }} /><button type="button" className="fx-btn" onClick={() => setDraft(null)}>{t('common.cancel')}</button><button type="button" className="fx-btn primary" onClick={saveDraft}>{t('common.add')}</button></>}>
        {draft && <>
          <p className="fx-muted fx-small">{t('assistant.confirmSub')}</p>
          <Field label={t('family.what')}><input className="fx-input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
          <div className="fx-two">
            <Field label={t('family.amount')}><input className="fx-input" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} /></Field>
            <Field label={t('family.date')}><DatePicker value={draft.date} onChange={(v) => setDraft({ ...draft, date: v })} /></Field>
          </div>
          <Field label={t('assistant.category')}>
            <select className="fx-input" value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
              {expenseCats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
        </>}
      </Sheet>
    </div>
  );
}
