# FuturePal — Instruções para continuar (Planeamento, Dívidas, Metas, Avisos)

Lê tudo antes de começar. Trabalha **sem pressas**, uma secção de cada vez, e verifica cada uma no preview antes de passar à seguinte.
**Não faças commit nem release** até o dono do projeto aprovar.

---

## 0. Regras que valem para TUDO

1. **Visual:** tudo deve parecer parte do app.
   - Fundo escuro e cartões ligeiramente mais claros (`mv-card`, `var(--card)`, `var(--card-2)`).
   - Cantos de 16–22px, bordas subtis (`var(--border)`).
   - Destaque turquesa (`var(--mv)`).
   - Estados: verde = positivo (`var(--pos)`), amarelo = médio/atenção (`var(--amber)`), vermelho = negativo (`var(--red)`), dourado `#f5a524` = poupança/criador.
   - Reutiliza o que já existe: `GTile`/`gx-tiles`, `sh-seg` (seletor com pílula que desliza), `BottomSheet`, `SwitchRow`, `TextRow`, `AmountField`, `CountMoney` (números animados), `CatIcon`, `EmptyState`, `fx-chip`, `pco-metric` (caixas do Painel).
2. **Fácil de entender:** frases curtas, sem jargão financeiro. Um número principal por caixa e uma frase a explicar. Detalhes só ao expandir.
3. **Interativo e animado:**
   - Entrada em sequência (`animation-delay: calc(var(--i) * 60ms)`).
   - Hover que levanta ligeiramente (`translateY(-2px)`).
   - Números com `CountMoney`, barras que crescem.
   - Respeitar `prefers-reduced-motion`.
4. **Textos:** usar sempre `L('texto em português')` e acrescentar a tradução em `src/i18n/phrases.ts` no formato `'pt': ['en', 'es', 'fr']`. Os textos novos têm hoje ES/FR em inglês: **traduz para espanhol e francês a sério**.
5. **Onde mexer no estilo:** `src/ui/mobile.css` (no fim) e, para o PC, `src/ui/pc-mobile.css` (prefixo `html.pcm`). No PC as páginas `.mv.sh` usam flex: põe `flex: 1 1 100%` nos blocos de largura total.
6. **Nunca duplicar dados nem cálculos:**
   - Usa o motor em `src/core/planning.ts` (projeção, estimativas, `variableExpenses`, `estimateDaily`, `project`, `summarize`).
   - Usa as regras de avisos em `src/core/planningAlerts.ts`.
   - Para editar um item, abre a página de origem (recorrências `/subscricoes`, metas `/metas`, dívidas `/contas?tab=debt`, salários `/salarios`, limites `/orcamentos`).
7. **Verificar no fim de cada secção:**
   - `npx tsc --noEmit -p .` sem erros.
   - `npx vitest run` com todos os testes a passar.
   - Abrir no preview, no PC (≥1280px) e no telemóvel (375px).
   - Confirmar que não há erros na consola.

---

## 1. Página Planeamento (`src/pages/Planning.tsx`, rota `/planeamento`)

**Objetivo:** dizer à pessoa, de forma simples, quanto costuma ganhar, quanto vai gastar este mês, quanto vai poupar, se as metas chegam e onde pode poupar.

### 1.1 Organização igual ao Painel (Home do PC, `src/pages/PcOverview.tsx`)

**Topo** (uma linha no PC, empilhado no telemóvel):
- Seletor de mês (`sh-monthnav`).
- Seletor `sh-seg`: **"Só salário" / "Salário e extras"** (guarda a escolha em `localStorage`).
- Botões **"Simular compra"** (secundário) e **"+ Adicionar despesa prevista"** (principal).

**Linha 1, como o Painel:**
- **Esquerda (2/3):** cartão "Recebes, gastas e poupas", com um gráfico no estilo do *Income analysis* do Painel (`OverviewChart`):
  - barras ou área para os 6 meses anteriores (observado) e o mês escolhido (previsto, em traço tracejado);
  - tooltip com Recebes/Gastas/Poupas ao passar o rato, tocar ou usar as setas do teclado;
  - legenda com pontos coloridos.
- **Direita (1/3):** três caixas **separadas**, como as `pco-metric` do Painel, cada uma com ícone, título, valor grande, barra de progresso e comparação em pílula (`fx-chip`) com o mês anterior:
  - **Costumas ganhar:** média dos últimos 3 meses completos. A frase por baixo diz quantos meses foram usados.
  - **Vais gastar:** pagamentos recorrentes do mês + despesas previstas + média do dia a dia. A frase diz "cerca de N despesas".
  - **Vais poupar:** ganhas − gastas, a dourado, e "X% do que ganhas".

**Linha 2:** cartão de estado em largura total.
- **Está tudo bem:** poupa ≥ 15%, verde.
- **Apertado:** poupa entre 0 e 15%, amarelo.
- **Não chega:** gasta mais do que ganha, vermelho.
- **Sem rendimentos:** com o link para Salários.

**Linha 3, três caixas lado a lado** (uma coluna no telemóvel):
1. **Despesas previstas:** lista no estilo das Transações (ícone da categoria, nome, data e valor). Os pagamentos já feitos aparecem esbatidos com "Já pago". As despesas previstas e a linha "Despesas do dia a dia (média) X/dia" ficam no fim.
2. **As tuas metas:** para cada meta com data, ✓ "Consegues: precisas de X/mês" ou ⚠ "Não chega". Ordena por data e reparte a poupança prevista pelas metas, por ordem.
3. **Onde podes poupar:** subscrições e pagamentos recorrentes não essenciais (`isOptional` em `planningAlerts.ts`), com "Sem isto poupas X por ano" e o total. Esconde a caixa se a preferência "Sugestões de poupança" estiver desligada.

**Regras do cálculo (já no motor, manter):**
- Não assumir rendimentos extra isolados.
- Não contar sugestões de recorrência como confirmadas.
- Não contar limites como despesas certas.
- Não contar duas vezes uma despesa registada à mão que coincide com uma recorrência.
- Se não houver histórico suficiente, dizer isso (não mostrar 0).
- Mostrar sempre "Estimativa a partir dos teus dados. Não é uma garantia."

### 1.2 "Adicionar despesa prevista"
- Hoje abre o formulário normal (`openTxForm`).
- **Melhorar:** passar uma opção nova `future: true` ao `TxForm`, que mostra a data já em amanhã e o aviso "Escolhe a data em que vais pagar".
- As transações com data futura já entram no cálculo como "Despesas já previstas".

### 1.3 "Simular compra" (já existe o `BuySim` em `Planning.tsx`: melhorar)
**Campos**, com o mesmo aspeto do formulário de despesa (`TxForm`):
- valor grande no centro (`AmountField`);
- o que vais comprar;
- categoria, com o mesmo menu de categorias do app (`CategoryRow`);
- conta (`AccountRow`, com os saldos);
- data (`DateRow`);
- notas;
- interruptor **"Pagar às prestações?"**: quando ligado, mostra **número de meses**, **juros por ano (%) opcional** e **data da 1.ª prestação**.

**Resultado em tempo real**, num cartão animado:
- Calcula o impacto por mês (valor total, ou prestação com juros via `payoff` em `src/core/debtPlan.ts`).
- Compara com o que sobra **depois das despesas previstas e das metas** (`free` = poupança prevista − soma do que as metas precisam por mês).
- ✓ **"Cabe no teu mês"** (verde): "Ficas com X de folga".
- ⚠ **"Não cabe"** (amarelo/vermelho): "Faltam X", com sugestões ("experimenta em N prestações", "espera até mês Y").
- Mostrar também o efeito nas metas: "A meta Carro novo atrasa 2 meses" (quando calculável).

**Confirmação:**
- **Se couber**, perguntar com um diálogo bonito (ícone, resumo e dois botões): "Queres adicionar esta despesa?" → **Sim** cria a transação a sério (`addTransaction`).
- **Se "prestações" estiver ligado** (caiba ou não, mas avisando quando não cabe), sugerir logo: "Queres criar uma conta de dívida para acompanhar as prestações?" → abre a criação de dívida (`NewAccount`, tipo `debt`) **já preenchida** com o nome, o valor total, a prestação por mês, os juros e a data final. Já existe a passagem por URL: `/contas?tab=debt&nova=debt&nome=…&valor=…&mes=…`. Acrescenta `juros` e `fim`.
- Nada é guardado sem confirmação. A etiqueta "Simulação" aparece sempre no topo.

---

## 2. Notificações (sino, `src/ui/AccountBar.tsx` + `src/core/planningAlerts.ts`)
- Os "momentos a ter em conta" aparecem **só como notificações**, não no Planeamento.
- O aviso de pagamento recorrente diz a data, o valor e, se for subscrição, "Se cancelares, poupas X por ano".
- Sem "Dispensar"/"Adiar" ao passar o rato. Há apenas **"Marcar todas como lidas"**. Ler (carregar numa notificação) ou marcar todas faz desaparecer.
- Os ids dos avisos são fixos por acontecimento (já existe): não podem repetir-se ao recalcular.

## 3. Preferências de avisos (Definições, `src/pages/Settings.tsx` → `AlertPrefsPanel`)
**Já estão nas Definições numa secção que abre. Melhorar a organização em grupos com títulos e ícones:**
- **O que te avisamos:** interruptores por tipo, com descrição curta.
- **Quando:** antecedência dos pagamentos (1/3/7 dias), despesas anuais (30/60/90 dias).
- **Limites:** patamares 50/80/100% (chips).
- **Saldo:** "Avisar se ficar abaixo de", campo de dinheiro igual aos outros (`AmountField`).
- **Sugestões de poupança:** ligar ou desligar.

Usar os mesmos interruptores do app (`SwitchRow`) em vez de checkboxes, com animação ao abrir a secção.

## 4. Dívidas (`src/pages/DebtBoost.tsx`)
**4.1 Cartão "Quando acabas"** (já existe; polir):
- **Em cima:** "Agora pagas X/mês → Acabas em [data]".
- **"Pagar por mês":** botões − / + e barra, até ao total da dívida.
- **"Abater já um valor":** interruptor + barra.
- **Resultado:** nova data a mudar em tempo real, "X mais cedo/mais tarde", juros poupados e barra comparativa.
- **Botões:** "Usar X por mês" e "Voltar ao valor atual".
- Os limites das barras não podem depender só do dinheiro da conta. O valor sugerido (o que dá para abater sem ficar apertado) aparece como marca na barra, não como limite.

**4.2 "Acabar mais depressa":** tem de continuar claro.
- "Agora pagas → Acabas em" em cima.
- As 3 sugestões (Leve / Equilibrada / Mais rápida) como cartões clicáveis.
- O cartão **"Podias pagar já X"** em destaque.
- A caixa **Recebes − Gastas = Sobra** (três cartões com ícones e barra).
- Ao carregar numa sugestão, abre a confirmação animada que já existe.

## 5. Metas (`src/pages/GoalView.tsx`)
- A nota e as contas usadas aparecem por baixo do valor, em etiquetas discretas (já feito). Confirmar que fica bem no telemóvel e no PC.
- A lista "O que já juntaste" / "Pagamentos feitos" usa o formato das Transações, com "Ver mais" que leva às Transações filtradas (`?conta=`).

## 6. Contas (`src/pages/SimplePages.tsx`, `src/pages/NewAccount.tsx`)
- **Primeira conta de gastos:** pergunta "Contas poupar um valor por mês?" com o valor. Depois de criar, abre a criação da conta de poupança com esse valor fixo por mês já preenchido (já feito: testar o fluxo completo).
- **Criar ou alterar conta:** "Tornar esta a conta principal?" (só nas contas de gastos) e "Contar para o património líquido?".

## 7. Outras páginas
- **Transações:** a percentagem "Transactions this month" aparece numa pílula ao lado do número (`fx-chip`). Verde se diminuiu, amarela se aumentou, nada se for 0%. Só aparece "-" quando é negativa. Aplicar o mesmo estilo onde houver comparações iguais.
- **Seletores (`sh-seg`):** todos com a pílula que desliza (já global em CSS).

---

## 8. Testes a acrescentar (vitest, ao lado dos ficheiros `src/core/*.test.ts`)
- Simular compra: cabe e não cabe, prestações com e sem juros, efeito nas metas.
- Planeamento: média só de salário e com extras; mês sem salário; poupança negativa.
- Avisos: subscrição com "poupas X por ano"; preferência de sugestões desligada; "marcar todas como lidas" esconde.

## 9. Antes de entregar
- Executar `npx tsc --noEmit -p .` e `npx vitest run` e indicar os resultados reais.
- Ver cada página alterada no preview (PC e telemóvel), com dados e sem dados.
- Não commitar sem autorização. Escrever um resumo curto do que mudou e do que ficou por fazer.

---

## 10. Estado atual (última atualização) e o que falta

**Já feito (polir, não refazer):**
- **Planeamento:**
  - À esquerda, o gráfico de barras Recebes/Gastas/Poupas, com o cartão de estado (Está tudo bem / Apertado / Não chega) integrado por baixo, no mesmo cartão. O fundo desse cartão alinha com o fundo das caixas da direita.
  - À direita, as caixas separadas Costumas ganhar / Vais gastar / Vais poupar.
  - A frase "Estimativa… não é uma garantia" está dentro do cartão de estado, discreta.
- **As tuas metas:** a pergunta "Chegas lá a tempo?", "Precisas de juntar X por mês" e a etiqueta Dá/Não dá. Mostra 3 metas e o "Ver mais" está sempre visível: com mais de 3 expande na própria caixa, senão abre `/metas`.
- **Onde podes poupar:** "Se cancelares, poupas por ano:", com a pílula verde +X/ano. O "Ver mais" está sempre visível (expande ou abre `/subscricoes`).
- **Simular compra (`BuySim` em `Planning.tsx`):**
  - Usa os campos do formulário de transação (`AmountField`, `TextRow`, `CategoryRow`, `AccountRow` com saldos, `DateRow`, grupo com `PickMenu`).
  - Com as prestações ligadas, a data passa a "Data do primeiro pagamento".
  - O resultado é "Cabe / Não cabe" mais a conta Custa vs Tens livre = Ficas com / Faltam, a cores.
- **Dívidas:** o cartão "Quando acabas" (valor de hoje em cima, + / − por mês, abate já, nova data em tempo real) e o "Acabar mais depressa" com "Agora pagas → Acabas em" antes das sugestões.

**Ainda falta (fazer com calma e bonito):**
1. **Simular compra:**
   - juros nas prestações e notas;
   - um diálogo de confirmação animado ("Queres adicionar esta despesa?") antes de gravar;
   - se as prestações estiverem ligadas, sugerir sempre a conta de dívida já preenchida (incluindo juros e data final), avisando se não cabe;
   - o efeito em cada meta ("atrasa N meses").
2. **"Adicionar despesa prevista":** abrir o formulário com a data já em amanhã e a dica "Escolhe a data em que vais pagar".
3. **Gráfico do Planeamento:** passar a ter os últimos 6 meses (observado) mais o mês escolhido (previsto, tracejado), com tooltip ao passar o rato, tocar ou usar o teclado, como o *Income analysis* do Painel.
4. **Preferências de avisos nas Definições:** organizar em grupos com títulos e ícones e usar `SwitchRow` em vez de checkboxes.
5. **Traduções:** traduzir para espanhol e francês todos os textos novos (hoje estão em inglês nessas línguas).
6. **Verificar tudo no preview** (PC 1920×1080 e telemóvel 375px), com e sem dados, e correr `npx tsc --noEmit -p .` e `npx vitest run`.
