// Comparações em palavras, em vez de "+15%" / "−57%" (um número negativo a verde confundia):
//   "15% mais que em outubro", "57% menos que no ano anterior", "O mesmo que em outubro".
import type { TFunction } from 'i18next';

export type CmpRef =
  | { kind: 'month'; date: Date }       // "em outubro"
  | { kind: 'year'; year: number }      // "em 2025"
  | { kind: 'preset'; preset: string }  // "nos 3 meses anteriores" (m1 | q | s | custom)
  | { kind: 'prevMonth' }               // "no mês anterior"
  | { kind: 'prevYear' };               // "no ano anterior"

/** "em outubro", "em 2025", "nos 3 meses anteriores"… no idioma escolhido. */
export function refText(t: TFunction, lang: string, r: CmpRef): string {
  if (r.kind === 'month') return t('cmp.refMonth', { name: r.date.toLocaleDateString(lang, { month: 'long' }) });
  if (r.kind === 'year') return t('cmp.refYear', { year: r.year });
  if (r.kind === 'preset') return t('cmp.ref_' + r.preset);
  return t(r.kind === 'prevMonth' ? 'cmp.refPrevMonth' : 'cmp.refPrevYear');
}

/** Frase completa: "57% menos que em outubro". pct já em percentagem (ex.: -57). */
export function cmpText(t: TFunction, pct: number, ref: string): string {
  const p = Math.abs(Math.round(pct));
  return p === 0 ? t('cmp.same', { ref }) : t(pct > 0 ? 'cmp.more' : 'cmp.less', { pct: p, ref });
}

/** Versão curta para etiquetas pequenas: "57% menos". */
export function cmpShort(t: TFunction, pct: number): string {
  const p = Math.abs(Math.round(pct));
  return p === 0 ? t('cmp.sameShort') : t(pct > 0 ? 'cmp.moreShort' : 'cmp.lessShort', { pct: p });
}
