import { describe, it, expect } from 'vitest';
import {
  parseSignedAmount, parseDate, guessDateOrder, detectColumns, rowsFromTable, parseOFX, parseQIF, rowsFromText,
  suggestCategory, rowsFromAiJson, dupKey,
} from './statementImport';

describe('amounts', () => {
  it.each([
    ['1.234,56', 123456], ['1,234.56', 123456], ['-12,50 €', -1250], ['(12.50)', -1250], ['12,50-', -1250],
    ['45', 4500], ['1.234', 123400], ['0,99', 99], ['−7,10', -710], [12.5, 1250], ['', null], ['abc', null],
  ])('%s -> %s', (raw, cents) => {
    expect(parseSignedAmount(raw)).toBe(cents);
  });
});

describe('dates', () => {
  it('parses common bank formats', () => {
    expect(parseDate('05/11/2026')).toBe('2026-11-05');
    expect(parseDate('05/11/2026', 'MDY')).toBe('2026-05-11');
    expect(parseDate('2026-11-05')).toBe('2026-11-05');
    expect(parseDate('20261105120000[0:GMT]')).toBe('2026-11-05');
    expect(parseDate('5-Nov-26')).toBe('2026-11-05');
    expect(parseDate('05 dez 2026')).toBe('2026-12-05');
    expect(parseDate('31/02/2026')).toBeNull();
  });
  it('guesses the order from the data', () => {
    expect(guessDateOrder(['01/02/2026', '25/02/2026'])).toBe('DMY');
    expect(guessDateOrder(['02/25/2026', '01/02/2026'])).toBe('MDY');
  });
});

describe('tables (CSV / Excel)', () => {
  it('Portuguese bank export with separate Débito / Crédito columns and title rows', () => {
    const rows = [
      ['Extrato de conta'], ['Conta: PT50 ...'], [],
      ['Data Mov.', 'Data Valor', 'Descrição', 'Débito', 'Crédito', 'Saldo'],
      ['03/11/2026', '03/11/2026', 'COMPRA CONTINENTE LISBOA', '45,20', '', '1.000,00'],
      ['05/11/2026', '05/11/2026', 'TRF SALARIO EMPRESA', '', '1.250,00', '2.250,00'],
      ['', '', 'Saldo final', '', '', '2.250,00'],
    ];
    const det = detectColumns(rows)!;
    expect(det.header).toBe(3);
    expect(det.map).toMatchObject({ date: 0, description: 2, debit: 3, credit: 4 });
    expect(rowsFromTable(rows, det.map, det.header)).toEqual([
      { date: '2026-11-03', description: 'COMPRA CONTINENTE LISBOA', amountCents: 4520, type: 'expense' },
      { date: '2026-11-05', description: 'TRF SALARIO EMPRESA', amountCents: 125000, type: 'income' },
    ]);
  });
  it('single signed Amount column (English export, ISO dates)', () => {
    const rows = [['Date', 'Description', 'Amount', 'Balance'], ['2026-11-01', 'Spotify', '-9.99', '100'], ['2026-11-02', 'Refund', '20.00', '120']];
    const det = detectColumns(rows)!;
    expect(det.map.amount).toBe(2);
    expect(rowsFromTable(rows, det.map, det.header).map((r) => [r.type, r.amountCents])).toEqual([['expense', 999], ['income', 2000]]);
  });
});

describe('own spreadsheets (e.g. the Wallet Excel "Registo")', () => {
  it('detects the category column and flags unsigned amounts', () => {
    const rows = [['REGISTO DE DESPESAS'], ['instruções'], ['DATA', 'CATEGORIA', 'DESCRIÇÃO', 'VALOR (€)'], [new Date(2025, 10, 2), 'Renda', 'Renda', 200], [new Date(2025, 10, 3), 'Carro', 'Via Verde', 1.4]];
    const det = detectColumns(rows)!;
    expect(det.map).toMatchObject({ date: 0, category: 1, description: 2, amount: 3 });
    expect(rowsFromTable(rows, det.map, det.header)[0]).toEqual({ date: '2025-11-02', description: 'Renda', amountCents: 20000, type: 'income', category: 'Renda', signed: false });
  });
});

describe('OFX / QIF', () => {
  it('OFX', () => {
    const ofx = '<OFX><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261103<TRNAMT>-45.20<NAME>CONTINENTE<MEMO>Compra</STMTTRN><STMTTRN><DTPOSTED>20261105<TRNAMT>1250.00<NAME>SALARIO</STMTTRN></OFX>';
    expect(parseOFX(ofx)).toEqual([
      { date: '2026-11-03', description: 'CONTINENTE · Compra', amountCents: 4520, type: 'expense' },
      { date: '2026-11-05', description: 'SALARIO', amountCents: 125000, type: 'income' },
    ]);
  });
  it('QIF', () => {
    const qif = '!Type:Bank\nD03/11/2026\nT-45.20\nPContinente\n^\nD05/11/2026\nT1,250.00\nPSalario\n^\n';
    expect(parseQIF(qif).map((r) => [r.date, r.amountCents, r.type])).toEqual([['2026-11-03', 4520, 'expense'], ['2026-11-05', 125000, 'income']]);
  });
});

describe('PDF text lines', () => {
  it('takes the first amount after the description (the last is usually the balance)', () => {
    const text = [
      'EXTRATO COMBINADO   Novembro 2026',
      '03/11/2026  03/11/2026  COMPRA CONTINENTE LISBOA   -45,20   1.000,00',
      '05/11/2026  05/11/2026  TRF SALARIO EMPRESA   1.250,00   2.250,00',
      'Saldo final 2.250,00',
    ].join('\n');
    expect(rowsFromText(text)).toEqual([
      { date: '2026-11-03', description: 'COMPRA CONTINENTE LISBOA', amountCents: 4520, type: 'expense' },
      { date: '2026-11-05', description: 'TRF SALARIO EMPRESA', amountCents: 125000, type: 'income' },
    ]);
  });
});

describe('categories, duplicates and AI replies', () => {
  const cats = [{ id: 'g', nameKey: 'catGroceries' }, { id: 's', nameKey: 'catSalary' }, { id: 'o', nameKey: 'catOther' }, { id: 'x', nameKey: 'catFood' }];
  it('history wins over keywords; keywords; fallback', () => {
    expect(suggestCategory('COMPRA CONTINENTE 1234', 'expense', cats, [{ description: 'COMPRA CONTINENTE 9999', categoryId: 'x' }])).toBe('x');
    expect(suggestCategory('Pingo Doce Benfica', 'expense', cats, [])).toBe('g');
    expect(suggestCategory('TRF SALARIO', 'income', cats, [])).toBe('s');
    expect(suggestCategory('???', 'expense', cats, [])).toBe('o');
  });
  it('dupKey ignores case and spacing', () => {
    expect(dupKey({ date: '2026-11-03', amountCents: 4520, description: 'Compra  Continente' })).toBe(dupKey({ date: '2026-11-03', amountCents: 4520, description: 'compra continente' }));
  });
  it('reads the AI JSON even with text around it', () => {
    const reply = 'Here you go:\n```json\n{"transactions":[{"date":"2026-11-03","description":"Continente","amount":-45.2},{"date":"2026-11-05","description":"Salário","amount":"1250"}]}\n```';
    expect(rowsFromAiJson(reply)).toEqual([
      { date: '2026-11-03', description: 'Continente', amountCents: 4520, type: 'expense' },
      { date: '2026-11-05', description: 'Salário', amountCents: 125000, type: 'income' },
    ]);
  });
});

describe('files', () => {
  it('decodeText reads UTF-8 and falls back to Windows-1252', async () => {
    const { decodeText } = await import('./statementImport');
    const utf8 = new TextEncoder().encode('\uFEFFDescrição;Débito').buffer;
    expect(decodeText(utf8 as ArrayBuffer)).toBe('Descrição;Débito');
    const cp1252 = new Uint8Array([0x44, 0xe9, 0x62, 0x69, 0x74, 0x6f]).buffer; // "Débito" em Windows-1252
    expect(decodeText(cp1252)).toBe('Débito');
  });
  it('bestTable picks the sheet with the most transactions (skips summary sheets)', async () => {
    const { bestTable } = await import('./statementImport');
    const summary = [['Data', 'Descrição', 'Valor'], ['Total', '', '100']];
    const registo = [['DATA', 'DESCRIÇÃO', 'VALOR'], ['01/11/2026', 'A', '-1'], ['02/11/2026', 'B', '-2']];
    expect(bestTable([summary, registo]).length).toBe(2);
  });
});
