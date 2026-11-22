// Põe a negrito, dentro de uma instrução, os nomes de botões, páginas e campos (na língua escolhida).
import type { ReactNode } from 'react';
import i18next from 'i18next';
import { L } from '../i18n/phrases';

const NAV = ['nav.goals', 'nav.budgets', 'nav.accounts', 'nav.categories', 'nav.salaries', 'nav.calendar', 'nav.recurring', 'nav.transactions', 'nav.help', 'simple.groups', 'simple.tabLimits', 'simple.allFeatures', 'mobile.home', 'plus.short_assistant'];
const terms = (): string[] => [
  L('Nova categoria'), L('Adicionar despesa'), L('Criar conta'), L('Adicionar salário ou extra'), L('Novo limite'), L('Criar meta'), L('Novo grupo'), L('Nova transação'),
  L('Mensal'), L('Anual'), L('Recorrente'), L('Recorrentes'), L('Categorias'), L('Categoria'), L('Contas'), L('Salários'), L('Limites'), L('Metas'), L('Grupos'), L('Calendário'), L('Transações'), L('Valor'), L('Nome'), L('Menu'), L('Gastos'), L('Poupança'), L('Dívidas'),
  ...NAV.map((k) => i18next.t(k)),
];
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function boldTerms(text: string): ReactNode[] {
  const list = [...new Set(terms())].filter((x) => x.length > 2).sort((a, b) => b.length - a.length).map(esc);
  const re = new RegExp(`(?<![\\p{L}])(${list.join('|')})(?![\\p{L}])|(?<=\\s)\\+(?=\\s|$)`, 'giu');
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) { if (m.index > at) out.push(text.slice(at, m.index)); out.push(<strong key={m.index}>{m[0]}</strong>); at = m.index + m[0].length; }
  out.push(text.slice(at));
  return out;
}
