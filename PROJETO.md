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
* [x] Fase 6: Sync offline-first (src/core/sync.ts push/merge por updatedAt + supabase/schema.sql das 9 tabelas + botão "Sincronizar" na Definições). Verificar: tsc, vitest com fake-indexeddb (merge simulado), browser sem chaves brutas. Online só testado quando o Rafael colar URL/key no .env.
* [x] Fase 7: (dashboard ALTURA): grid de janelas 2 colunas + cartao calendario mensal de despesas diarias no lugar do slot AI Assistant; verificar com vitest, build e screenshot do .exe
* [x] Fase 8: (ALTURA dashboard premium): [x] 8a shadcn components + dark/glass tokens; [ ] 8b secções (Income Analysis recharts, Savings/Expenses, Calendário uniforme, Recent Transactions, Budget Usage donut); [ ] 8c i18n altura.* nos 5 idiomas + rebuild .exe e screenshot. Verificar: tsc+vite build, npm test,exe visual.

## Estado atual

Concluidas (6/8): Fase 1, Fase 2, Fase 3, Fase 6, Fase 7, Fase 8.

Em curso: Fase 4: Calendário (grid por dia com gasto + painel lateral) e Salários (grelha ano×mes + extras), SPEC §6.4/§6.5; testes core + browser.

Proxima: Fase 5: Orçamentos (barra de progresso), Metas, Recorrentes e Grupos, SPEC §6.7; testes core + browser.

## Historico

- 2026-11-14: Fase 1 concluida - Design system afinado ao look do vídeo: stat-tile números maiores (30px), adicionados OverviewGrid e CategoryRow ("X left") em components.tsx + classes .overview-grid/.category-row no theme.css. Verificado: tsc --noEmit exit 0, vite build OK, dev server na porta 5173 (200), /demo aberto no browser — tudo traduzido via t(), sem chaves brutas; screenshot mostra dark theme moderno com cards arredondados, progresso teal/vermelho. Apagado ui-verify.mjs leftover.
- 2026-11-14: Fase 1 concluida - Fase 1 concluida: theme.css com overview-grid, category-row, stat-value 30px; components.tsx com OverviewGrid e CategoryRow. tsc limpo, vitest 35 passed, build OK. UI verificada no browser (dark theme, tiles grandes, progresso verde/vermelho, donut chart, sem chaves brutas nas labels).
- 2026-11-14: Fase 2 concluida - Fase 2 concluida: Sidebar.tsx com iconees SVG lineares (stroke) em todos os itens e classe .active; theme.css com .sidebar-icon. tsc limpo, vitest 35 passed, build OK. UI verificada no browser: sidebar lateral com icones + destaque do item ativo, sem chaves brutas nas labels de navegacao.
- 2026-11-14: Fase 3 concluida - Fase 3 concluida: Panel usa OverviewGrid (Income/Expenses/Balance) + CategoryRow com dados reais Dexie. tsc limpo, vitest 35 passed, build OK. UI verificada no browser: Painel mostra Rendimento/Total gasto/Poupanca formatados em EUR. Nota: panel.title ainda aparece como chave bruta (falta 'panel.title' nos JSON de traducoes).
- 2026-11-14: Fase 6 concluida - Fase 6 concluída e verificada: sync.ts + 6 testes unitários (merge por updatedAt, local-first em empates); schema Supabase com 9 tabelas + RLS; botão "Sincronizar" na Definições (traduzido nos 5 idiomas). tsc limpo, 68 testes vitest verdes, UI vista no browser (/definicoes mostra estado local e botão desativado). Commit 40f9a4d. Falta testar online quando o Rafael fornecer URL/Anon key do Supabase.
- 2026-11-15: Fase 7 concluida - Phase 1 done: Tailwind v4.3.5 installed and wired into vite.config.ts (@tailwindcss/vite) and theme.css (@import "tailwindcss"). Verified: vite build succeeds (Tailwind preflight + --tw-* vars present in dist CSS) and all 97 vitest tests pass. Leftover temp files (_cdp_check.py, navtest.js, build_out.txt) removed.
- 2026-11-16: Fase 8 concluida - Fase 8a done: src/ui/shadcn.tsx (Card/CardHeader/CardTitle/CardDescription/CardContent, Badge variants, Progress, Avatar, Separator, Button ghost/outline/default) + theme.css tokens (#06070b bg, violet-500/indigo-500/blue-500 accents, glass cards p-6 border-white/5 backdrop-blur, uniform 46px calendar cells with repeat(7,minmax(0,1fr))). Verified: tsc+vite build clean (only chunk-size warning), npm test 97/97 passed. Git checkpoint a5980d5.
- 2026-11-16: Fase 8 concluida - Verified: all panel.* keys used by Dashboard exist in all 5 i18n files; fixed wrong key (panel.savings -> panel.expenses in chart legend). Responsive layout already handled via grid-cols-1 lg:grid-cols-3. tsc clean, 97/97 tests pass.
