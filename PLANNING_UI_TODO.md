# Planning / Settings UI improvements — plan for tomorrow (FuturePal / Wallet)

Date noted: 2026-11-23. Repo: D:\Claude Apps\Wallet\app (React/TS, vitest). Read PROJETO.md rules first. Rule 8-style: only touch files listed here; report bugs elsewhere instead of silently fixing them. Make a git checkpoint before starting edits.

Confirmed locations (verified with search_files / read_file):
- Salary-only / with-extras toggle + "next month" boxes: D:\Claude Apps\Wallet\app\src\pages\DebtBoost.tsx
  - Toggle row line ~100: `<div className="tx-rows db-extras"><SwitchRow icon=... label={L('Contar rendimentos extras')} sub={extras ? L('Salário e extras') : L('Só o salário')} .../></div>`
  - "flow" metric cards lines ~102–108 (`db-flow2`, `db-f in/out/left` with `db-fi` icon chips) — these are the small boxes the user wants bigger.
- Month status + "Free after covering everything": phrases.ts line ~1046 ('Livre depois de cumprir tudo' / 'Free after covering everything'), and month-status copy lines ~1053 ('Everything is on track' etc.). Rendering lives in the planning/overview component that uses these keys.
- Debt expand box icons: hardcoded `<Ic ...>` SVGs inside the debt rows (not category icons). Category icon system = `CatIcon` + catalog entries (e.g. `catLoan`, icon `handcoin`) in the category catalog file.
- Settings "Connect another AI (Advanced)": D:\Claude Apps\Wallet\app\src\pages\AiSettings.tsx (line ~74, `Row ... label={t('ai.provider')}` + PickMenu). The privacy sentence to add ("When you use the assistant, the data you ask it to analyse is sent to the provider you chose") should go in i18n (en.json / pt-PT.json etc.) and be rendered as a styled callout like the import-statements menu.

## Tasks (in order)

1. Enlarge the "next month" planning boxes + salary-only/with-extras buttons
   - Target: `db-flow2` cards and the `db-extras` SwitchRow in DebtBoost.tsx.
   - Match sizing to buttons/cards used on other pages (compare with existing `.mv-card` / button styles). Increase padding, min-height, font sizes so they read at a sensible size.
   - Verify visually against another page's card/button scale before committing.

2. Debt expand box: use category icons instead of random SVGs
   - Replace the hardcoded `<Ic ...>` in debt rows with `CatIcon` using the loan/debt catalog entry (`catLoan`, icon `handcoin`) so it matches the rest of the UI.
   - Keep colors consistent with the category icon system.

3. "planned, no scheduled payment" text
   - Reword so it's clearer and fits the project aesthetic (animated/interactive). Add new i18n key(s) in phrases.ts / en.json / pt-PT.json etc. Don't hardcode English.

4. Month status box
   - Remove the duplicated value that already appears in "Free after covering everything".
   - Add the emoji that currently sits before "Everything is on track" into the month-status box (move it there).

5. Settings → "Connect another AI (Advanced)"
   - Add text: "When you use the assistant, the data you ask it to analyse is sent to the provider you chose."
   - Style it like the import-statements menu we built before — a clean, animated callout that doesn't break the layout.

6. After all edits: run `npm test` (vitest) + `tsc`/build to certify no bugs, then open a browser preview of the app so Rafael can see it.

Notes / caveats
- Grep tool returned "no matches" on some .tsx files even when search_files found them — use search_files/read_file for those, not grep.
- Keep i18n consistent across all language files (pt-PT, en, es, fr, pt-BR).
- Do NOT recompile/rebuild unless asked; the user previously said don't auto-recompile after CSS changes.
