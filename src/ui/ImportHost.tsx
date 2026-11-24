import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from './fx';
import { ImportStatement } from '../pages/ImportStatement';

// Abre a janela "Importar extrato" de qualquer página (Início, nova transação…).
export const OPEN_IMPORT = 'wallet:open-import';
export const openImport = () => window.dispatchEvent(new Event(OPEN_IMPORT));

export function ImportHost() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  useEffect(() => { const on = () => setOpen(true); window.addEventListener(OPEN_IMPORT, on); return () => window.removeEventListener(OPEN_IMPORT, on); }, []);
  return <Sheet open={open} onClose={() => setOpen(false)} title={t('importer.title')} wide><ImportStatement /></Sheet>;
}
