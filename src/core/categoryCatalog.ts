// Catálogo de categorias (grupos + ícones desenhados na app, sem imagens da internet).
// As chaves antigas (catFood, catRent…) foram reaproveitadas para não duplicar categorias já existentes.

export interface CatalogItem { key: string; icon: string }
export interface CatalogGroup { id: string; color: string; items: CatalogItem[] }

// Ícones 24×24 de traço (stroke), no estilo dos restantes ícones da app.
export const CAT_ICONS: Record<string, string> = {
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  dots: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 12h.01M12 12h.01M16 12h.01',
  shirt: 'M8 3l-5 3 2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  grad: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5M22 9v6',
  question: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z',
  film: 'M4 5h16v14H4zM4 9h16M4 15h16M8 5v14M16 5v14',
  gamepad: 'M6 8h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L15 13H9l-1.6 1.8A3 3 0 0 1 2 13v-1a4 4 0 0 1 4-4zM7 11v3M5.5 12.5h3M15 12h.01M18 11h.01',
  cocktail: 'M5 4h14l-7 8zM12 12v8M8 20h8M15 4l2-2',
  run: 'M13 4a2 2 0 1 0 0 .1M7 21l3-5 3 2v5M10 16l1-6 4 3 3-1M6 11l3-3 4 1',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  plane: 'M10 14l-6 6M17 3l4 4-11 11-4-1-1-4zM14 6l-8-2-2 2 6 4M18 10l2 8-2 2-4-6',
  candy: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 15v7M12 9a2 2 0 1 1 2-2',
  coffee: 'M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 9h1a3 3 0 0 1 0 6h-1M8 2v3M12 2v3',
  drink: 'M7 4h10l-1 16H8zM6 8h12M14 4l2-2',
  utensils: 'M5 3v8a2 2 0 0 0 2 2v8M9 3v8M7 3v4M17 21V3c-2 0-4 2-4 6v4h4',
  cart: 'M3 4h2l2.5 11h11L21 7H6.2M9 20h.01M18 20h.01',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  brush: 'M14 3l7 7-4 4-7-7zM10 7l-6 6c-1 1-1 3 0 4l3 3c1 1 3 1 4 0l6-6',
  home: 'M3 11l9-8 9 8M5 9v12h14V9M10 21v-6h4v6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01',
  handcoin: 'M12 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 17l4-3h5l4 2 5-3v5l-6 3H7l-4-2z',
  hammer: 'M14 6l4 4M3 21l9-9M13 3l8 8-3 3-8-8z',
  key: 'M15 7a4 4 0 1 1-3.5 6L4 20v-3h3v-3h3l1.5-1.5A4 4 0 0 1 15 7zM16 8h.01',
  wrench: 'M15 4a5 5 0 0 0 5 6l-9 9a2 2 0 0 1-3-3l9-9a5 5 0 0 1-2-3z',
  tv: 'M3 6h18v11H3zM8 21h8M12 17v4',
  percent: 'M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  phone: 'M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2z',
  drop: 'M12 3s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12z',
  ribbon: 'M12 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM9 12l-3 9 6-3 6 3-3-9',
  baby: 'M12 3a4 4 0 0 0-4 4v1a4 4 0 0 0 8 0V7a4 4 0 0 0-4-4zM6 21a6 6 0 0 1 12 0M10 8h.01M14 8h.01',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  tooth: 'M7 3c-2 0-4 2-4 5 0 4 2 5 2 9 0 2 1 4 2 4s2-3 2-5h6c0 2 1 5 2 5s2-2 2-4c0-4 2-5 2-9 0-3-2-5-4-5-2 0-3 1-5 1S9 3 7 3z',
  stethoscope: 'M6 3v6a4 4 0 0 0 8 0V3M10 13v3a5 5 0 0 0 10 0v-2M20 12a2 2 0 1 0 0-.1',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h8',
  gift: 'M4 10h16v11H4zM2 7h20v3H2zM12 7v14M12 7S10 3 7.5 3 5 6 7 7M12 7s2-4 4.5-4S19 6 17 7',
  bed: 'M3 18V7M3 13h18v5M21 13v-2a3 3 0 0 0-3-3h-7v5M7 11h.01',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z',
  laptop: 'M5 5h14v10H5zM3 19h18',
  paw: 'M8 7a2 2 0 1 0 0-.1M16 7a2 2 0 1 0 0-.1M5 12a2 2 0 1 0 0-.1M19 12a2 2 0 1 0 0-.1M12 13c-3 0-5 3-5 5s2 3 5 3 5-1 5-3-2-5-5-5z',
  pill: 'M10.5 20.5a5 5 0 0 1-7-7l10-10a5 5 0 0 1 7 7zM8.5 8.5l7 7',
  bag: 'M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2',
  suitcase: 'M4 7h16v13H4zM9 7V4h6v3M4 12h16',
  briefcase: 'M3 7h18v13H3zM9 7V5h6v2M3 13h18M12 12v2',
  coins: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  car: 'M5 11l2-5h10l2 5M4 11h16v6H4zM7 17v2M17 17v2M7 14h.01M17 14h.01',
  carshield: 'M4 12l2-5h9l2 5M3 12h15v5H3zM6 17v2M15 17v2M20 3l2 1v3c0 2-1 3-2 3.5-1-.5-2-1.5-2-3.5V4z',
  fuel: 'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 8h2a2 2 0 0 1 2 2v6a1 1 0 0 0 2 0V8l-3-3',
  parking: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 16V8h3a2.5 2.5 0 0 1 0 5h-3',
  bus: 'M5 4h14v13H5zM5 11h14M8 21v-4M16 21v-4M8 14h.01M16 14h.01',
  taxi: 'M5 11l2-5h10l2 5M4 11h16v6H4zM7 17v2M17 17v2M10 3h4v3h-4z',
  salary: 'M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10h.01M18 14h.01',
  income: 'M12 20V4M6 10l6-6 6 6M5 20h14',
};

export const CATEGORY_GROUPS: CatalogGroup[] = [
  { id: 'income', color: '#16a34a', items: [{ key: 'catSalary', icon: 'salary' }, { key: 'catPension', icon: 'income' }, { key: 'catInvestIncome', icon: 'trend' }, { key: 'catOtherIncome', icon: 'income' }] },
  { id: 'housing', color: '#0ea5e9', items: [
    { key: 'catHome', icon: 'home' }, { key: 'catRent', icon: 'key' }, { key: 'catBills', icon: 'receipt' }, { key: 'catElectricity', icon: 'bolt' },
    { key: 'catWater', icon: 'drop' }, { key: 'catInternet', icon: 'wifi' }, { key: 'catTelephone', icon: 'phone' }, { key: 'catTv', icon: 'tv' },
    { key: 'catHomeSupplies', icon: 'brush' }, { key: 'catMaintenance', icon: 'hammer' }, { key: 'catService', icon: 'wrench' },
    { key: 'catInsurance', icon: 'shield' }, { key: 'catLoan', icon: 'handcoin' }, { key: 'catBank', icon: 'bank' }, { key: 'catTaxes', icon: 'percent' },
  ] },
  { id: 'food', color: '#f59e0b', items: [
    { key: 'catFood', icon: 'utensils' }, { key: 'catGroceries', icon: 'cart' }, { key: 'catCoffee', icon: 'coffee' }, { key: 'catDrinks', icon: 'drink' }, { key: 'catCandy', icon: 'candy' },
  ] },
  { id: 'transport', color: '#3b82f6', items: [
    { key: 'catCar', icon: 'car' }, { key: 'catTransport', icon: 'bus' }, { key: 'catGas', icon: 'fuel' }, { key: 'catParking', icon: 'parking' },
    { key: 'catCarInsurance', icon: 'carshield' }, { key: 'catCarLoan', icon: 'car' }, { key: 'catRepair', icon: 'wrench' }, { key: 'catTaxi', icon: 'taxi' }, { key: 'catFlight', icon: 'plane' },
  ] },
  { id: 'lifestyle', color: '#10b981', items: [
    { key: 'catShopping', icon: 'bag' }, { key: 'catClothes', icon: 'shirt' }, { key: 'catHealth', icon: 'heart' }, { key: 'catDoctor', icon: 'stethoscope' },
    { key: 'catDentist', icon: 'tooth' }, { key: 'catPharmacy', icon: 'pill' }, { key: 'catAnimals', icon: 'paw' }, { key: 'catEducation', icon: 'book' },
    { key: 'catChildCare', icon: 'baby' }, { key: 'catGift', icon: 'gift' }, { key: 'catCharity', icon: 'ribbon' }, { key: 'catCommunity', icon: 'smile' },
    { key: 'catTravel', icon: 'suitcase' }, { key: 'catHotel', icon: 'bed' }, { key: 'catWork', icon: 'briefcase' }, { key: 'catOffice', icon: 'laptop' }, { key: 'catLifestyle', icon: 'star' },
  ] },
  { id: 'entertainment', color: '#8b5cf6', items: [
    { key: 'catLeisure', icon: 'film' }, { key: 'catHobby', icon: 'gamepad' }, { key: 'catSports', icon: 'run' }, { key: 'catNightlife', icon: 'cocktail' },
    { key: 'catSubscriptions', icon: 'repeat' }, { key: 'catVacation', icon: 'plane' },
  ] },
  { id: 'savings', color: '#c2410c', items: [{ key: 'catEmergencySavings', icon: 'coins' }, { key: 'catVacationSavings', icon: 'sun' }, { key: 'catGoals', icon: 'coins' }] },
  { id: 'misc', color: '#6b7280', items: [
    { key: 'catBankFees', icon: 'bank' }, { key: 'catStudentLoan', icon: 'grad' }, { key: 'catOther', icon: 'dots' }, { key: 'catUnknown', icon: 'question' },
  ] },
];

export const CATALOG_ITEMS = CATEGORY_GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g.id, color: g.color })));

export function catalogItem(nameKey?: string) {
  return nameKey ? CATALOG_ITEMS.find((i) => i.key === nameKey) : undefined;
}

/** Grupo de uma categoria: o guardado, o do catálogo, ou "custom". */
export function groupOf(c: { group?: string; nameKey?: string }): string {
  if (c.nameKey === 'salaries.extras') return 'income'; // criada pela app (Rendimentos extras), não pela pessoa
  return c.group || catalogItem(c.nameKey)?.group || 'custom';
}

/** Ícone de uma categoria (do catálogo ou o escolhido); por omissão "dots". */
export function iconPathOf(c: { icon?: string; nameKey?: string }): string {
  return CAT_ICONS[c.icon || ''] ?? CAT_ICONS[catalogItem(c.nameKey)?.icon ?? 'dots'] ?? CAT_ICONS.dots;
}

/** Ordem dentro de um grupo: a do catálogo (do mais comum para o "outros" no fim); as criadas pela pessoa vêm depois, por nome. */
export function catalogRank(c: { nameKey?: string }): number {
  if (c.nameKey === 'salaries.extras') return CATALOG_ITEMS.findIndex((x) => x.key === 'catOtherIncome') - 0.5; // antes de "Outros rendimentos"
  const i = c.nameKey ? CATALOG_ITEMS.findIndex((x) => x.key === c.nameKey) : -1;
  return i < 0 ? 9999 : i;
}

export const GROUP_ORDER = [...CATEGORY_GROUPS.map((g) => g.id), 'custom'];
