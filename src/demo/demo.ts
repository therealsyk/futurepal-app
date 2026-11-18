// Modo de demonstração (para o website): a própria app, com dados de exemplo, sem login nem servidor.
// Compila-se com `npm run demo:build` (vite --mode demo) para ../website/demo e atualiza-se a cada versão.
import type { WalletDB } from '../db/database';
import { addTransaction, setBudget, addGoal } from '../core/finance';
import { syncSalaryTransactions } from '../core/salaryTx';
import { ensureDefaultAccount } from '../core/accounts';

export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

const LANGS: Record<string, { language: string; country: string; currency: string; dateFormat: 'DMY' | 'MDY' }> = {
  pt: { language: 'pt-PT', country: 'PT', currency: 'EUR', dateFormat: 'DMY' },
  en: { language: 'en', country: 'IE', currency: 'EUR', dateFormat: 'DMY' },
  es: { language: 'es', country: 'ES', currency: 'EUR', dateFormat: 'DMY' },
  fr: { language: 'fr', country: 'FR', currency: 'EUR', dateFormat: 'DMY' },
};

/** Antes de a app arrancar: língua vinda do site (?lang=), setup já feito, sem tutorial. */
export function prepareDemo(): void {
  if (!IS_DEMO) return;
  const q = new URLSearchParams(location.search).get('lang') || 'pt';
  const l = LANGS[q] ?? LANGS.pt;
  try {
    const cur = JSON.parse(localStorage.getItem('wallet.settings') || '{}');
    localStorage.setItem('wallet.settings', JSON.stringify({ theme: 'dark', firstDayOfWeek: 1, account: 'none', ...cur, ...l }));
    localStorage.setItem('wallet.tutorialSeen', '1');
  } catch { /* sem storage: a app funciona na mesma em memória */ }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Dados de exemplo (só na primeira vez): dois meses de despesas, salários, orçamentos e uma meta. */
export async function seedDemo(db: WalletDB, mainName: string): Promise<void> {
  if (!IS_DEMO) return;
  if ((await db.transactions.count()) > 0) return;
  await ensureDefaultAccount(db, 'EUR', mainName);
  const cats = await db.categories.toArray();
  const cat = (k: string) => cats.find((c) => c.nameKey === k)?.id ?? cats[0].id;
  const now = new Date();
  const months = [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1)];
  // [dia, categoria, descrição, euros]
  const plan: Array<[number, string, string, number]> = [
    [1, 'catRent', 'Renda', 650], [2, 'catGroceries', 'Continente', 54.3], [3, 'catCoffee', 'Café', 2.4],
    [5, 'catElectricity', 'EDP', 41.3], [6, 'catInternet', 'NOS', 32.99], [8, 'catGas', 'Galp', 48.2],
    [9, 'catGroceries', 'Pingo Doce', 38.75], [11, 'catFood', 'Restaurante', 27.5], [12, 'catSubscriptions', 'Netflix', 12.99],
    [14, 'catPharmacy', 'Farmácia', 9.8], [15, 'catGroceries', 'Lidl', 46.1], [17, 'catLeisure', 'Cinema', 14],
    [18, 'catCoffee', 'Pastelaria', 4.2], [20, 'catClothes', 'Zara', 39.95], [22, 'catTransport', 'Navegante', 40],
    [24, 'catGroceries', 'Continente', 61.4], [26, 'catFood', 'Pizzaria', 22], [28, 'catGas', 'Galp', 45],
  ];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const m of months) {
    const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    for (const [d, k, desc, eur] of plan) {
      const date = new Date(m.getFullYear(), m.getMonth(), Math.min(d, days));
      if (date > today) continue; // só até hoje
      await addTransaction(db, { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, type: 'expense', categoryId: cat(k), description: desc, amountCents: Math.round(eur * 100), currency: 'EUR' });
    }
    const y = m.getFullYear(), mo = m.getMonth() + 1;
    const now2 = new Date().toISOString();
    await db.salaries.add({ id: `demo-sal-${y}-${mo}`, year: y, month: mo, amountCents: 185000, createdAt: now2, updatedAt: now2, deletedAt: null });
    await setBudget(db, cat('catGroceries'), 25000, y, mo);
    await setBudget(db, cat('catFood'), 12000, y, mo);
    await setBudget(db, cat('catLeisure'), 6000, y, mo);
  }
  const g = await addGoal(db, 'Férias', 200000, `${now.getFullYear()}-01-01`, `${now.getFullYear() + 1}-07-31`);
  await db.goals.update(g.id, { currentCents: 136000 });
  await syncSalaryTransactions(db, 'EUR').catch(() => {});
}

/** Apaga os dados de exemplo e recomeça. */
export async function resetDemo(db: WalletDB): Promise<void> {
  await db.delete();
  location.reload();
}

/** Páginas que não fazem parte da demonstração: levam ao convite para descarregar. */
export const DEMO_BLOCKED = ['/definicoes', '/plus', '/admin', '/assistente', '/dividir', '/casa', '/irs', '/subscricoes', '/ano', '/desafios', '/garantias', '/independentes', '/categorias'];
/** Quantos toques antes do convite. */
export const DEMO_TAPS = 14;
export const DOWNLOAD_URL = 'https://github.com/therealsyk/futurepal/releases/latest';

/** Avisa o website (que mostra a secção de download); fora de um iframe abre a página de download. */
export function askToDownload(): void {
  if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'futurepal-demo', action: 'download' }, '*');
  else window.open(DOWNLOAD_URL, '_blank', 'noopener');
}
