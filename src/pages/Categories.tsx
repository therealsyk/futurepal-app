import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/app-db';
import { loadSettings } from '../core/settings';
import type { AppSettings } from '../core/settings';
import type { Category } from '../db/database';
import { activeCategories, addCategory } from '../core/finance';
import { autoCategoryImage, categoryImage } from '../core/category-images';
import { Button } from '../ui/components';
import type { ReactNode } from 'react';

export function Categories() {
  const { t } = useTranslation();
  const [cats, setCats] = useState<Category[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editing state: 'new' for the create form, or the id of the category being edited.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [image, setImage] = useState('');

  function refresh() {
    return Promise.all([activeCategories(db), loadSettings()]).then(([c, s]) => {
      setCats(c);
      setSettings(s);
    });
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  function startNew() {
    setEditingId('new');
    setName('');
    setImage('');
  }

  function startEdit(cat: Category) {
    setEditingId(cat.id);
    setName(cat.name);
    setImage(cat.image ?? '');
  }

  function cancelEdit() {
    setEditingId(null);
    setName('');
    setImage('');
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      if (editingId === 'new') {
        // addCategory auto-matches an image from the name when none is given.
        await addCategory(db, {
          name: trimmed,
          color: '#8B5CF6',
          icon: '',
          order: cats.length + 1,
          image: image.trim() || autoCategoryImage(trimmed),
        });
      } else {
        const cat = cats.find((c) => c.id === editingId);
        if (!cat) return;
        await db.categories.update(cat.id, {
          name: trimmed,
          ...(image.trim() ? { image: image.trim() } : {}),
          updatedAt: new Date().toISOString(),
        });
      }
      cancelEdit();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleUpload(file: File) {
    const dataUri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('upload failed'));
      reader.readAsDataURL(file);
    });
    setImage(dataUri);
  }

  if (loading) return <div className="text-white/60 text-sm">{t('panel.loading')}</div>;

  function Glass({ children }: { children: ReactNode }) {
    return (
      <div
        className="rounded-2xl border border-white/10 backdrop-blur-xl bg-white/5
          shadow-[0_28px_70px_-28px_rgba(0,0,0,0.85),0_10px_30px_-14px_rgba(139,92,246,0.35)]"
      >
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05060a] text-white">
      <h1 className="text-2xl font-bold mb-4">{t('panel.categoriesTitle')}</h1>

      <Glass>
        {error && <div className="text-red-400 text-sm mb-3">{error}</div>}

        {editingId === null ? (
          <Button label={t('panel.newCategory')} onClick={startNew} />
        ) : (
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">
              {editingId === 'new' ? t('panel.newCategory') : t('panel.editCategory')}
            </h2>

            <label className="text-sm text-white/60">{t('panel.categoryName')}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm"
              placeholder={t('panel.categoryName')}
            />

            <label className="text-sm text-white/60">{t('panel.image')}</label>
            <div className="flex flex-wrap gap-3 items-center">
              <img
                src={image || autoCategoryImage(name || 'other')}
                alt=""
                className="w-14 h-14 rounded-xl object-cover border border-white/10"
              />
              <input
                value={image.startsWith('data:') ? '' : image}
                onChange={(e) => setImage(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm flex-1 min-w-[180px]"
                placeholder={t('panel.imageUrl')}
              />
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                }}
                className="text-sm text-white/60"
              />
            </div>
            <p className="text-xs text-white/40">{t('panel.autoImageHint')}</p>

            <div className="flex gap-2 mt-1">
              <Button label={editingId === 'new' ? t('panel.create') : t('panel.save')} onClick={save} />
              <Button label={t('panel.cancel')} onClick={cancelEdit} />
            </div>
          </div>
        )}
      </Glass>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
        {cats.map((cat) => (
          <Glass key={cat.id}>
            <div className="flex items-center gap-3">
              <img
                src={categoryImage(cat)}
                alt={cat.name}
                className="w-12 h-12 rounded-xl object-cover border border-white/10"
              />
              <div>
                <div className="font-semibold">{cat.name}</div>
                <div className="text-xs text-white/40">{settings?.currency ?? 'EUR'}</div>
              </div>
            </div>
            <div className="mt-2">
              <Button label={t('panel.editCategory')} onClick={() => startEdit(cat)} />
            </div>
          </Glass>
        ))}
      </div>
    </div>
  );
}
