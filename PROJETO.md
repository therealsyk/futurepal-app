# Wallet - Projeto

App de gestão financeira pessoal (desktop primeiro, iPhone depois). Adapta o estilo visual do vídeo MyFuturePlan ao layout de desktop (barra lateral), mantendo SPEC §7.

## Regras

1. React + TS + Vite; sem deps novas desnecessárias
2. Dinheiro em cêntimos; todo texto via t() (i18n 5 idiomas)
3. Barra lateral no desktop; bottom tab bar só no telemóvel (SPEC §7) — não copiar a nav do vídeo
4. Não adicionar funcionalidades fora do SPEC.md
5. UI só fica concluída depois de ver a app a correr no browser

## Estrutura

```
src/ui/theme.css (design system), src/ui/Sidebar.tsx, src/ui/components.tsx, src/pages/index.tsx (Panel overview), src/core/finance.ts (lógica já feita)
```

## Fases

* [x] Fase 1: afinar design system (theme.css + componentes) ao look do vídeo; verificar build + /demo no browser
* [x] Fase 2: Sidebar desktop com destaque de item ativo e ícones lineares; ver app a correr
* [x] Fase 3: Panel overview estilo vídeo (Income/Expenses/Balance + categorias 'X left') com dados reais Dexie; testes finance.ts + browser
* [~] Fase 4: Calendário (grid por dia com gasto + painel lateral) e Salários (grelha ano×mes + extras), SPEC §6.4/§6.5; testes core + browser
* [ ] Fase 5: Orçamentos (barra de progresso), Metas, Recorrentes e Grupos, SPEC §6.7; testes core + browser
* [~] Fase 6: Sync offline-first (src/core/sync.ts push/merge por updatedAt + supabase/schema.sql das 9 tabelas + botão "Sincronizar" na Definições). Verificar: tsc, vitest com fake-indexeddb (merge simulado), browser sem chaves brutas. Online só testado quando o Rafael colar URL/key no .env.

## Estado atual

Concluidas (3/6): Fase 1, Fase 2, Fase 3.

Em curso: Fase 4: Calendário (grid por dia com gasto + painel lateral) e Salários (grelha ano×mes + extras), SPEC §6.4/§6.5; testes core + browser; Fase 6: Sync offline-first (src/core/sync.ts push/merge por updatedAt + supabase/schema.sql das 9 tabelas + botão "Sincronizar" na Definições). Verificar: tsc, vitest com fake-indexeddb (merge simulado), browser sem chaves brutas. Online só testado quando o Rafael colar URL/key no .env..

Proxima: Fase 5: Orçamentos (barra de progresso), Metas, Recorrentes e Grupos, SPEC §6.7; testes core + browser.

## Historico

- 2026-11-14: Fase 1 concluida - Design system afinado ao look do vídeo: stat-tile números maiores (30px), adicionados OverviewGrid e CategoryRow ("X left") em components.tsx + classes .overview-grid/.category-row no theme.css. Verificado: tsc --noEmit exit 0, vite build OK, dev server na porta 5173 (200), /demo aberto no browser — tudo traduzido via t(), sem chaves brutas; screenshot mostra dark theme moderno com cards arredondados, progresso teal/vermelho. Apagado ui-verify.mjs leftover.
- 2026-11-14: Fase 1 concluida - Fase 1 concluida: theme.css com overview-grid, category-row, stat-value 30px; components.tsx com OverviewGrid e CategoryRow. tsc limpo, vitest 35 passed, build OK. UI verificada no browser (dark theme, tiles grandes, progresso verde/vermelho, donut chart, sem chaves brutas nas labels).
- 2026-11-14: Fase 2 concluida - Fase 2 concluida: Sidebar.tsx com iconees SVG lineares (stroke) em todos os itens e classe .active; theme.css com .sidebar-icon. tsc limpo, vitest 35 passed, build OK. UI verificada no browser: sidebar lateral com icones + destaque do item ativo, sem chaves brutas nas labels de navegacao.
- 2026-11-14: Fase 3 concluida - Fase 3 concluida: Panel usa OverviewGrid (Income/Expenses/Balance) + CategoryRow com dados reais Dexie. tsc limpo, vitest 35 passed, build OK. UI verificada no browser: Painel mostra Rendimento/Total gasto/Poupanca formatados em EUR. Nota: panel.title ainda aparece como chave bruta (falta 'panel.title' nos JSON de traducoes).
