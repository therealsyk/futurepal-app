import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import type { Category } from '../db/database';
import { activeCategories, addCategory } from '../core/finance';
import { autoCategoryImage, categoryImage } from '../core/category-images';
import { catLabel, PageHead, Sheet, Field, Ic, ICON } from '../ui/fx';

const COLORS = ['#8b7cf6', '#5fd4c4', '#e58fd3', '#f5b85a', '#60a5fa', '#4ade9b', '#f87171', '#a78bfa', '#22d3ee', '#fb7185', '#eab308', '#9ca3af'];

export function Categories() {
  const { t } = useTranslation();
  const [cats, setCats] = useState<Category[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => setCats(await activeCategories(db));
  useEffect(() => { refresh().catch((e) => setError(String(e))); }, []);

  const label = (c: Category) => catLabel(t, c);
  const startNew = () => { setEditingId('new'); setName(''); setImage(''); setColor(COLORS[cats.length % COLORS.length]); setError(null); };
  const startEdit = (c: Category) => { setEditingId(c.id); setName(label(c)); setImage(c.image ?? ''); setColor(c.color || COLORS[0]); setError(null); };
  const close = () => setEditingId(null);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError(t('accounts.nameRequired')); return; }
    try {
      if (editingId === 'new') {
        await addCategory(db, { name: trimmed, color, icon: '', order: cats.length + 1, image: image.trim() || autoCategoryImage(trimmed) });
      } else if (editingId) {
        const cat = cats.find((c) => c.id === editingId);
        if (!cat) return;
        await db.categories.update(cat.id, { name: trimmed, color, nameKey: cat.nameKey && trimmed === label(cat) ? cat.nameKey : undefined, ...(image.trim() ? { image: image.trim() } : {}), updatedAt: new Date().toISOString() });
      }
      close();
      await refresh();
    } catch (e) { setError(t('transactions.maxCategories')); void e; }
  };

  const upload = (file: File) => {
    const r = new FileReader();
    r.onload = () => setImage(String(r.result));
    r.readAsDataURL(file);
  };

  return (
    <div className="fx-page">
      <PageHead title={t('panel.categoriesTitle')} sub={t('categories.subtitle', { count: cats.length })}>
        <button type="button" className="fx-btn primary" onClick={startNew}><Ic d={ICON.plus} size={16} />{t('panel.newCategory')}</button>
      </PageHead>
      <div className="fx-cat-grid">
        {cats.map((c) => (
          <button type="button" key={c.id} className="fx-card fx-cat" onClick={() => startEdit(c)} aria-label={`${t('panel.editCategory')}: ${label(c)}`}>
            <img src={categoryImage(c)} alt="" />
            <span className="fx-cat-dot" style={{ background: c.color || 'var(--accent)' }} />
            <b>{label(c)}</b>
          </button>
        ))}
        <button type="button" className="fx-acc-add" onClick={startNew}><Ic d={ICON.plus} size={22} /><span>{t('panel.newCategory')}</span></button>
      </div>

      <Sheet open={editingId !== null} onClose={close} title={editingId === 'new' ? t('panel.newCategory') : t('panel.editCategory')}
        footer={<><span style={{ flex: 1 }} /><button type="button" className="fx-btn" onClick={close}>{t('common.cancel')}</button><button type="button" className="fx-btn primary" onClick={save}>{editingId === 'new' ? t('panel.create') : t('common.save')}</button></>}>
        {error && <p className="fx-error">{error}</p>}
        <Field label={t('panel.categoryName')}><input className="fx-input big" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="fx-label" style={{ margin: '12px 0 6px' }}>{t('categories.color')}</div>
        <div className="fx-swatches">{COLORS.map((c) => <button type="button" key={c} className={c === color ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}</div>
        <div className="fx-label" style={{ margin: '14px 0 6px' }}>{t('panel.image')}</div>
        <div className="fx-inline">
          <img className="fx-thumb" src={image || autoCategoryImage(name || 'other')} alt="" />
          <input className="fx-input" value={image.startsWith('data:') ? '' : image} placeholder={t('panel.imageUrl')} onChange={(e) => setImage(e.target.value)} aria-label={t('panel.imageUrl')} />
        </div>
        <input type="file" accept="image/*" className="fx-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        <p className="fx-muted fx-small">{t('panel.autoImageHint')}</p>
      </Sheet>
    </div>
  );
}
