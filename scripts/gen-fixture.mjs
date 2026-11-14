import XLSX from 'xlsx';
import fs from 'node:fs';

const wb = XLSX.readFile('D:\\Documentos\\Gestão de Despesas Mensais.xlsx');
const sheetNames = wb.sheetnames;
const ws = wb.Sheets['Registo'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

function dstr(serial) {
  return new Date((serial - 25569) * 86400000).toISOString().slice(0, 10);
}

const transactions = [];
for (let i = 3; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r[0] == null || r[3] == null) continue;
  const date = dstr(r[0]);
  if (!date.startsWith('2026')) continue;
  transactions.push({
    date,
    category: String(r[1]),
    description: String(r[2] || ''),
    amountCents: Math.round(Number(r[3]) * 100),
  });
}

const salarySheet = wb.Sheets['Salários'];
const srows = XLSX.utils.sheet_to_json(salarySheet, { header: 1 });
const salaries = [];
for (const r of srows) {
  if (Array.isArray(r) && Number(r[0]) === 2026) {
    for (let m = 1; m <= 12; m++) {
      const v = r[m];
      if (v != null && Number(v) > 0) salaries.push({ year: 2026, month: m, amountCents: Math.round(Number(v) * 100) });
    }
    break;
  }
}

const totalCents = transactions.reduce((s, t) => s + t.amountCents, 0);
const incomeCents = salaries.reduce((s, t) => s + t.amountCents, 0);
const out = {
  source: 'D:\\Documentos\\Gestão de Despesas Mensais.xlsx',
  sheets: sheetNames,
  year: 2026,
  transactions,
  salaries,
  expected: {
    expenseCents: totalCents,
    incomeCents,
    savingsCents: incomeCents - totalCents,
    savingsPercent: Number(((incomeCents - totalCents) / incomeCents * 100).toFixed(2)),
    count: transactions.length,
  },
};

fs.writeFileSync('src/fixtures/excel-2026.json', JSON.stringify(out, null, 2), 'utf8');
console.log('expenseCents', totalCents, 'incomeCents', incomeCents, 'savingsCents', incomeCents - totalCents, 'savingsPercent', out.expected.savingsPercent, 'count', transactions.length);
