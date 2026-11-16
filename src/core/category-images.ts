// Category pictures: auto-match an image from the category name (SPEC-friendly,
// no external libraries). Keywords are checked against the lowercased name;
// the first match wins. Images are public domain/stock URLs served by
// picsum.photos (deterministic per keyword so the same category always gets
// the same picture). Users can override with any URL or an upload in the
// Categories screen — a manual image always wins over auto-matching.

export interface CategoryImageRule {
  keywords: string[];
  seed: string; // picsum seed, stable per topic
}

const RULES: CategoryImageRule[] = [
  { keywords: ['salário', 'salario', 'salary', 'ordenado', 'rendimento', 'income', 'paycheck'], seed: 'wallet-salary' },
  { keywords: ['comida', 'food', 'grocery', 'groceries', 'supermercado', 'market', 'mercearia', 'aliment'], seed: 'wallet-food' },
  { keywords: ['restaurante', 'restaurant', 'café', 'cafe', 'bar', 'jantar', 'lunch', 'dinner'], seed: 'wallet-restaurant' },
  { keywords: ['transporte', 'transport', 'carro', 'car', 'fuel', 'gasolina', 'petrol', 'bus', 'autocarro', 'metro', 'train'], seed: 'wallet-transport' },
  { keywords: ['renda', 'rent', 'housing', 'casa', 'house', 'mortgage', 'hipoteca', 'apartment'], seed: 'wallet-housing' },
  { keywords: ['saúde', 'saude', 'health', 'medical', 'farmácia', 'farmacia', 'pharmacy', 'doctor'], seed: 'wallet-health' },
  { keywords: ['lazer', 'leisure', 'entertainment', 'cinema', 'movie', 'games', 'game', 'videojogo', 'hobby'], seed: 'wallet-leisure' },
  { keywords: ['roupa', 'clothes', 'clothing', 'fashion', 'shoes', 'zapatos'], seed: 'wallet-fashion' },
  { keywords: ['educação', 'educacao', 'education', 'school', 'escola', 'course', 'curso', 'university'], seed: 'wallet-education' },
  { keywords: ['pets', 'animal', 'pet', 'cão', 'cao', 'gato', 'dog', 'cat'], seed: 'wallet-pets' },
  { keywords: ['viagem', 'travel', 'trip', 'vacation', 'férias', 'ferias', 'hotel', 'flight'], seed: 'wallet-travel' },
  { keywords: ['facturas', 'factura', ' bills', 'bill', 'utilities', 'electricidade', 'water', 'internet', 'telecom'], seed: 'wallet-bills' },
  { keywords: ['poupança', 'poupanca', 'saving', 'savings', 'investimento', 'investment'], seed: 'wallet-savings' },
  { keywords: ['presente', 'gift', 'birthday', 'aniversário', 'aniversario'], seed: 'wallet-gifts' },
  { keywords: ['banco', 'bank', 'loan', 'crédito', 'credito', 'debt', 'dívida', 'divida'], seed: 'wallet-bank' },
  { keywords: ['beleza', 'beauty', 'hair', 'salon', 'cosmetics'], seed: 'wallet-beauty' },
  { keywords: ['desporto', 'sport', 'gym', 'fitness', 'ginásio', 'ginasio'], seed: 'wallet-sport' },
  { keywords: ['outros', 'other', 'misc', 'diversos', 'various'], seed: 'wallet-other' },
];

/** Best picsum URL for a category name; falls back to a neutral wallet image. */
export function autoCategoryImage(name: string): string {
  const n = (name || '').toLowerCase().trim();
  for (const rule of RULES) {
    if (rule.keywords.some((k) => n.includes(k))) {
      return `https://picsum.photos/seed/${rule.seed}/120/120`;
    }
  }
  return 'https://picsum.photos/seed/wallet-default/120/120';
}

/** Resolve the picture for a category: manual image always wins. */
export function categoryImage(cat: { name: string; image?: string }): string {
  return cat.image?.trim() || autoCategoryImage(cat.name);
}
