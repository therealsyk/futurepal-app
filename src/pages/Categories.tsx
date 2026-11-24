import { milestone } from '../core/onboarding';
import { L } from '../i18n/phrases';
import { FormError, useMissing } from '../ui/missing';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { appConfirm } from '../ui/confirm';
import { Row } from '../ui/formFields';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Category } from '../db/database';
import { activeCategories, addCategory, softDelete } from '../core/finance';
import { CAT_ICONS, CATEGORY_GROUPS, GROUP_ORDER, groupOf, catalogRank } from '../core/categoryCatalog';
import { catLabel, PageHead, PickMenu, Sheet, Ic, ICON, CatIcon } from '../ui/fx';

const COLORS = ['#16a34a', '#0ea5e9', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#c2410c', '#6b7280', '#ec4899', '#ef4444', '#14b8a6', '#eab308'];
const groupColor = (g: string) => CATEGORY_GROUPS.find((x) => x.id === g)?.color ?? COLORS[0];

type Draft = { id: string | null; name: string; group: string; icon: string; color: string; image: string };

export function Categories() {
  const { t } = useTranslation();
  const [cats, setCats] = useState<Category[]>([]);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => setCats(await activeCategories(db));
  useEffect(() => { refresh().catch((e) => setError(String(e))); }, []);

  const label = (c: Category) => catLabel(t, c);
  const q = query.trim().toLowerCase();
  const sections = useMemo(() => GROUP_ORDER.map((g) => ({
    g,
    items: cats.filter((c) => groupOf(c) === g && (!q || label(c).toLowerCase().includes(q))).sort((a, b) => catalogRank(a) - catalogRank(b) || label(a).localeCompare(label(b))),
  })).filter((s) => s.items.length > 0 || (!q && s.g !== 'custom')),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [cats, q, t]);

  const startNew = (group: string) => { setError(null); setDraft({ id: null, name: '', group, icon: 'dots', color: groupColor(group), image: '' }); };
  const startEdit = (c: Category) => {
    setError(null);
    setDraft({ id: c.id, name: label(c), group: groupOf(c), icon: c.icon || 'dots', color: c.color || groupColor(groupOf(c)), image: c.image?.startsWith('data:') ? c.image : '' });
  };
  const missing = useMissing();
  const close = () => { setDraft(null); missing([]).reset(); };

  const miss = missing([['name', L('o nome'), !!draft?.name.trim()]]);
  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    setError(null);
    if (!miss.check()) return;
    try {
      if (!draft.id) milestone('category');
      const fields = { color: draft.color, icon: draft.icon, group: draft.group, image: draft.image || undefined };
      if (!draft.id) {
        await addCategory(db, { name, order: cats.length + 1, ...fields });
      } else {
        const cat = cats.find((c) => c.id === draft.id);
        if (!cat) return;
        // nome traduzido mantém a chave; se a pessoa o mudar, passa a ser um nome próprio
        const keepKey = cat.nameKey && name === label(cat);
        await db.categories.update(cat.id, { ...fields, name: keepKey ? cat.name : name, nameKey: keepKey ? cat.nameKey : undefined, updatedAt: new Date().toISOString() });
      }
      close();
      await refresh();
    } catch { setError(t('transactions.maxCategories')); }
  };

  const remove = async () => {
    if (!draft?.id) return;
    await softDelete(db, 'categories', draft.id);
    close();
    await refresh();
  };

  const upload = (file: File) => {
    if (file.size > 300_000) { setError(t('categories.imageTooBig')); return; }
    const r = new FileReader();
    r.onload = () => setDraft((d) => (d ? { ...d, image: String(r.result) } : d));
    r.readAsDataURL(file);
  };

  return (
    <div className="fx-page ct-page">
      <PageHead title={t('panel.categoriesTitle')} />

      <label className="ob-search ct-search">
        <Ic d={ICON.search} size={18} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('categories.search')} aria-label={t('categories.search')} />
      </label>

      {sections.map(({ g, items }) => (
        <section key={g} className="ct-section">
          <h2>{t('categoryGroups.' + g)}</h2>
          <div className="ct-grid">
            {items.map((c) => (
              <button type="button" key={c.id} className="ct-tile" onClick={() => startEdit(c)} aria-label={`${t('panel.editCategory')}: ${label(c)}`}>
                <CatIcon cat={c} size={64} />
                <span>{label(c)}</span>
              </button>
            ))}
            {!q && <button type="button" className="ct-tile ct-new" onClick={() => startNew(g)} aria-label={`${t('panel.newCategory')}: ${t('categoryGroups.' + g)}`}>
              <span className="ct-new-ic"><Ic d={ICON.plus} size={26} /></span>
              <span>{L('Nova')}</span>
            </button>}
          </div>
        </section>
      ))}
      {q && sections.length === 0 && <p className="fx-muted">{t('categories.noResults')}</p>}

      <Sheet open={draft !== null} onClose={close} title={draft?.id ? t('panel.editCategory') : t('panel.newCategory')}>
        {draft && (
          <div className="acc-form ctf" style={{ '--cc': draft.color } as CSSProperties}>
            {miss.note ?? (error && <FormError text={error} />)}
            <div className="ctf-top">
              <span className="ctf-pic" key={draft.icon + draft.image}><CatIcon cat={{ icon: draft.icon, color: draft.color, image: draft.image }} size={84} /></span>
              <input className={'ctf-name' + miss.cls('name')} autoFocus={!draft.id} maxLength={40} value={draft.name} placeholder={t('panel.categoryName')} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label={t('panel.categoryName')} />
            </div>
            <div className="ctf-cols" role="radiogroup" aria-label={t('categories.color')}>{COLORS.map((x) => <button type="button" key={x} role="radio" aria-checked={x === draft.color} className={x === draft.color ? 'on' : ''} style={{ background: x }} onClick={() => setDraft({ ...draft, color: x })} aria-label={x} />)}</div>
            <div className="ct-icons ctf-icons" role="radiogroup" aria-label={t('categories.icon')}>
              {Object.entries(CAT_ICONS).map(([k, d]) => (
                <button type="button" key={k} role="radio" aria-checked={draft.icon === k} aria-label={k} className={draft.icon === k && !draft.image ? 'on' : ''} onClick={() => setDraft({ ...draft, icon: k, image: '' })}><Ic d={d} size={22} /></button>
              ))}
            </div>
            <div className="tx-rows">
              <Row div icon="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" label={t('categories.group')}><PickMenu compact label={t('categories.group')} value={draft.group} options={GROUP_ORDER.map((g) => ({ value: g, label: t('categoryGroups.' + g) }))} onChange={(g) => setDraft({ ...draft, group: g })} /></Row>
              <Row div icon="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5h.01" label={L('Imagem')}><button type="button" className="ctf-img" onClick={() => (draft.image ? setDraft({ ...draft, image: '' }) : fileRef.current?.click())}>{draft.image ? t('categories.useIcon') : L('Escolher imagem')}</button></Row>
              <input ref={fileRef} hidden type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
            </div>
            <button type="button" className="tx-addbtn" onClick={save}>{draft.id ? t('common.save') : L('Criar categoria')}</button>
            {draft.id && <button type="button" className="ctf-del" onClick={async () => { if (await appConfirm(t('categories.deleteNote'), { ok: t('common.delete') })) remove().catch(() => {}); }}><Ic d={ICON.trash} size={17} />{L('Apagar categoria')}</button>}
          </div>
        )}
      </Sheet>
    </div>
  );
}
