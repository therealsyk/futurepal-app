import { L } from '../i18n/phrases';
import { FormError, useMissing } from '../ui/missing';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Category } from '../db/database';
import { activeCategories, addCategory, softDelete } from '../core/finance';
import { CAT_ICONS, CATEGORY_GROUPS, GROUP_ORDER, groupOf } from '../core/categoryCatalog';
import { catLabel, PageHead, Sheet, Ic, ICON, CatIcon } from '../ui/fx';

const COLORS = ['#16a34a', '#0ea5e9', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#c2410c', '#6b7280', '#ec4899', '#ef4444', '#14b8a6', '#eab308'];
const groupColor = (g: string) => CATEGORY_GROUPS.find((x) => x.id === g)?.color ?? COLORS[0];

type Draft = { id: string | null; name: string; group: string; icon: string; color: string; image: string };

export function Categories() {
  const { t } = useTranslation();
  const [cats, setCats] = useState<Category[]>([]);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => setCats(await activeCategories(db));
  useEffect(() => { refresh().catch((e) => setError(String(e))); }, []);

  const label = (c: Category) => catLabel(t, c);
  const q = query.trim().toLowerCase();
  const sections = useMemo(() => GROUP_ORDER.map((g) => ({
    g,
    items: cats.filter((c) => groupOf(c) === g && (!q || label(c).toLowerCase().includes(q))).sort((a, b) => label(a).localeCompare(label(b))),
  })).filter((s) => s.items.length > 0 || (!q && s.g !== 'custom')),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [cats, q, t]);

  const startNew = (group: string) => { setError(null); setConfirmDel(false); setDraft({ id: null, name: '', group, icon: 'dots', color: groupColor(group), image: '' }); };
  const startEdit = (c: Category) => {
    setError(null); setConfirmDel(false);
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
      <PageHead title={t('panel.categoriesTitle')}>
        <button type="button" className="fx-btn primary" onClick={() => startNew('custom')}><Ic d={ICON.plus} size={16} />{t('panel.newCategory')}</button>
      </PageHead>

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
          </div>
        </section>
      ))}
      {q && sections.length === 0 && <p className="fx-muted">{t('categories.noResults')}</p>}

      <Sheet open={draft !== null} onClose={close} title={draft?.id ? t('panel.editCategory') : t('panel.newCategory')} wide
        footer={<>
          {draft?.id && (confirmDel
            ? <button type="button" className="fx-btn danger" onClick={remove} data-testid="cat-confirm-delete"><Ic d={ICON.trash} size={16} />{t('categories.confirmDelete')}</button>
            : <button type="button" className="fx-btn danger" onClick={() => setConfirmDel(true)}><Ic d={ICON.trash} size={16} />{t('common.delete')}</button>)}
          <span style={{ flex: 1 }} />
          <button type="button" className="fx-btn" onClick={close}>{t('common.cancel')}</button>
          <button type="button" className="fx-btn primary" onClick={save}>{draft?.id ? t('common.save') : t('panel.create')}</button>
        </>}>
        {draft && (
          <>
            {miss.note ?? (error && <FormError text={error} />)}
            {confirmDel && <p className="fx-muted fx-small">{t('categories.deleteNote')}</p>}
            <div className={'ct-preview' + miss.cls('name')}>
              <CatIcon cat={{ icon: draft.icon, color: draft.color, image: draft.image }} size={56} />
              <input className="fx-input big" autoFocus value={draft.name} placeholder={t('panel.categoryName')} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label={t('panel.categoryName')} />
            </div>
            <div className="fx-label" style={{ margin: '12px 0 6px' }}>{t('categories.group')}</div>
            <div className="ct-groups" role="radiogroup" aria-label={t('categories.group')}>
              {GROUP_ORDER.map((g) => (
                <button type="button" key={g} role="radio" aria-checked={draft.group === g} className={'ct-group' + (draft.group === g ? ' on' : '')} onClick={() => setDraft({ ...draft, group: g })}>{t('categoryGroups.' + g)}</button>
              ))}
            </div>
            <div className="fx-label" style={{ margin: '12px 0 6px' }}>{t('categories.icon')}</div>
            <div className="ct-icons" role="radiogroup" aria-label={t('categories.icon')}>
              {Object.entries(CAT_ICONS).map(([k, d]) => (
                <button type="button" key={k} role="radio" aria-checked={draft.icon === k} aria-label={k} className={draft.icon === k ? 'on' : ''} onClick={() => setDraft({ ...draft, icon: k, image: '' })}>
                  <Ic d={d} size={20} />
                </button>
              ))}
            </div>
            <div className="fx-label" style={{ margin: '12px 0 6px' }}>{t('categories.color')}</div>
            <div className="fx-swatches">{COLORS.map((c) => <button type="button" key={c} className={c === draft.color ? 'on' : ''} style={{ background: c }} onClick={() => setDraft({ ...draft, color: c })} aria-label={c} />)}</div>
            <div className="fx-label" style={{ margin: '14px 0 6px' }}>{t('categories.ownImage')}</div>
            <div className="fx-inline">
              <input type="file" accept="image/*" className="fx-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
              {draft.image && <button type="button" className="fx-btn" onClick={() => setDraft({ ...draft, image: '' })}>{t('categories.useIcon')}</button>}
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
