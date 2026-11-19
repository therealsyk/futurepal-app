import { describe, it, expect } from 'vitest';
import {
  parseSignedAmount, parseDate, guessDateOrder, detectColumns, rowsFromTable, parseOFX, parseQIF, rowsFromText,
  suggestCategory, rowsFromAiJson, dupKey, detectSalaryRows,
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

  it('unsigned debit/credit columns: sign from the running balance', () => {
    const text = [
      'Data Mov.  Data Valor  Descrição  Débito  Crédito  Saldo',
      'Saldo anterior  1.000,00',
      '03.11  03.11  COMPRA PINGO DOCE  23,10  976,90',
      '04.11  04.11  TRF DE JOAO SILVA  50,00  1.026,90',
      '06.11  06.11  PAGAMENTO EDP  41,30  985,60',
      'Página 1 de 1   Extrato de Novembro 2026',
    ].join('\n');
    expect(rowsFromText(text)).toEqual([
      { date: '2026-11-03', description: 'COMPRA PINGO DOCE', amountCents: 2310, type: 'expense' },
      { date: '2026-11-04', description: 'TRF DE JOAO SILVA', amountCents: 5000, type: 'income' },
      { date: '2026-11-06', description: 'PAGAMENTO EDP', amountCents: 4130, type: 'expense' },
    ]);
  });

  it('newest-first statements, month names and D/C markers', () => {
    const text = [
      'Extrato 2026',
      '10 NOV  NETFLIX.COM  12,99 D  500,00',
      '08 NOV  REEMBOLSO SEGURO  30,00 C  512,99',
      '07 nov  LIDL LISBOA  15,00  482,99',
    ].join('\n');
    expect(rowsFromText(text)).toEqual([
      { date: '2026-11-10', description: 'NETFLIX.COM', amountCents: 1299, type: 'expense' },
      { date: '2026-11-08', description: 'REEMBOLSO SEGURO', amountCents: 3000, type: 'income' },
      { date: '2026-11-07', description: 'LIDL LISBOA', amountCents: 1500, type: 'expense' },
    ]);
  });

  it('descriptions on two lines, amount on the next line, single-space lines', () => {
    const text = [
      '12/11/2026  COMPRA CARTAO 1234',
      'CONTINENTE MODELO  -18,40  900,00',
      '13/11/2026 UBER TRIP HELP.UBER.COM -7,25 892,75',
      '14/11/2026  ORDENADO NOVEMBRO  1.500,00 €',
      'EMPRESA LDA',
    ].join('\n');
    expect(rowsFromText(text)).toEqual([
      { date: '2026-11-12', description: 'COMPRA CARTAO 1234 CONTINENTE MODELO', amountCents: 1840, type: 'expense' },
      { date: '2026-11-13', description: 'UBER TRIP HELP.UBER.COM', amountCents: 725, type: 'expense' },
      { date: '2026-11-14', description: 'ORDENADO NOVEMBRO EMPRESA LDA', amountCents: 150000, type: 'income' },
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

describe('salary detection', () => {
  const row = (date: string, description: string, eur: number, type: 'income' | 'expense' = 'income') => ({ date, description, amountCents: Math.round(eur * 100), type });
  it('by keywords', () => {
    const rows = [row('2026-01-28', 'TRF VENCIMENTO JAN', 1200), row('2026-01-05', 'PROC VENC ACME', 900), row('2026-01-09', 'REEMBOLSO SEGURO', 50)];
    expect([...detectSalaryRows(rows)].sort()).toEqual([0, 1]);
  });
  it('by the same payer paying a similar amount every month', () => {
    const rows = [
      row('2026-01-27', 'TRF SEPA DE ACME LDA 0001', 1450.2), row('2026-02-26', 'TRF SEPA DE ACME LDA 0002', 1460),
      row('2026-03-27', 'TRF SEPA DE ACME LDA 0003', 1450.2), row('2026-02-10', 'TRF DE JOAO SILVA', 20),
      row('2026-03-02', 'MB WAY DE ANA', 400), row('2026-02-03', 'CONTINENTE', 45, 'expense'),
    ];
    expect([...detectSalaryRows(rows)].sort()).toEqual([0, 1, 2]);
  });
});

describe('rowsFromText: extrato Revolut (datas "Apr 20, 2026", € à frente)', () => {
  const text = [
    'Balance summary',
    'Product  Opening balance  Money out  Money in  Closing balance',
    'Account (Current Account)  €0.03  €12.63  €1,250.00  €1,237.40',
    'Total  €0.03  €12.63  €1,250.00  €1,237.40',
    'Date  Description  Money out  Money in  Balance',
    'Apr 20, 2026  Top-up by *1234  €1,250.00  €1,250.03',
    'From: *1234',
    'Apr 21, 2026  Supermercado Exemplo  €2.63  €1,247.40',
    'To: Supermercado Exemplo, Cidade',
    'Card: 400000******0000',
    'May 2, 2026  Cafe Exemplo  €10.00  €1,237.40',
  ].join('\n');
  it('lê as datas, os valores com milhares e o sinal pelo saldo', () => {
    const r = rowsFromText(text);
    expect(r.map((x) => [x.date, x.type, x.amountCents, x.description])).toEqual([
      ['2026-04-20', 'income', 125000, 'Top-up by *1234'],
      ['2026-04-21', 'expense', 263, 'Supermercado Exemplo'],
      ['2026-05-02', 'expense', 1000, 'Cafe Exemplo'],
    ]);
  });
});
