import { describe, expect, it } from 'vitest';
import { rowsFromText } from './statementImport';
// Extratos fictícios no formato de vários bancos (como o pdfText junta as linhas). [nome, texto, nº esperado, entradas €, saídas €]
const S: Array<[string, string, number, number, number]> = [
['CGD (débito/crédito, ISO)', `Extrato Integrado  Período 2026-11-01 a 2026-11-30
Data mov.  Data valor  Descrição  Débito  Crédito  Saldo
Saldo anterior  1.000,00
2026-11-03  2026-11-03  COMPRA CONTINENTE  25,30  974,70
2026-11-05  2026-11-05  TRF SALARIO EMPRESA X  1.500,00  2.474,70
2026-11-07  2026-11-07  LEVANTAMENTO ATM  60,00  2.414,70
Saldo final  2.414,70`, 3, 1500, 85.3],
['Millennium (sem ano)', `EXTRATO DE 2026/11/01 A 2026/11/30
DATA LANC.  DATA VALOR  DESCRITIVO  MONTANTE  SALDO
SALDO INICIAL  500,00
03.11  03.11  COMPRA 1234 PINGO DOCE  -18,40  481,60
04.11  04.11  TRF DE JOAO SILVA  200,00  681,60
10.11  10.11  DD EDP COMERCIAL  -45,10  636,50`, 3, 200, 63.5],
['Santander (com sinal)', `Movimentos  Novembro 2026
03-11-2026  TRF P/ JOAO  -50,00  1.150,45
04-11-2026  MB WAY DE ANA  25,00  1.175,45`, 2, 25, 50],
['Novo Banco (D/C)', `Data  Descrição  Valor  Saldo
03.11.2026  PAG SERVICOS  12,00 D  988,00 C
05.11.2026  DEPOSITO  100,00 C  1.088,00 C`, 2, 100, 12],
['ActivoBank (menos no fim)', `Data  Descrição  Montante  Saldo
03/11/2026  COMPRA FNAC  89,99-  910,01
06/11/2026  TRANSF RECEBIDA  50,00  960,01`, 2, 50, 89.99],
['N26 (descrição antes da data)', `Statement November 2026
Lidl  03.11.2026  -12,30€
Mastercard • Food & Groceries
Max Mustermann  05.11.2026  +250,00€
Incoming transfer`, 2, 250, 12.3],
['Wise (mês por extenso)', `EUR statement  1 November 2026 - 30 November 2026
Description  Incoming  Outgoing  Amount  Balance
3 November 2026  Card transaction of 12.30 EUR issued by Lidl  -12.30  487.70
5 November 2026  Received money from Jane Doe  100.00  587.70`, 2, 100, 12.3],
['Chase US (MDY, $)', `Statement Period: 11/01/2026 through 11/30/2026
DATE  DESCRIPTION  AMOUNT  BALANCE
Beginning Balance  $1,000.00
11/03  AMAZON MKTPLACE  -45.99  954.01
11/15  PAYROLL ACME INC  2,000.00  2,954.01
11/20  SHELL OIL  -40.00  2,914.01`, 3, 2000, 85.99],
['Barclays UK (£, sem ano)', `Statement 1 Nov 2026 - 30 Nov 2026
Date  Description  Money out  Money in  Balance
Start balance  £500.00
3 Nov  Tesco Stores  £12.30  £487.70
5 Nov  Salary Acme Ltd  £1,800.00  £2,287.70`, 2, 1800, 12.3],
['Nubank BR (R$)', `Extrato de novembro 2026
03 NOV  Transferência recebida  R$ 1.500,00
04 NOV  Compra no débito Padaria  - R$ 15,90
10 NOV  Pagamento de boleto  - R$ 230,00`, 3, 1500, 245.9],
['ING ES (€ no fim)', `Movimientos noviembre 2026
F. VALOR  DESCRIPCIÓN  IMPORTE  SALDO
03/11/2026  Pago en MERCADONA  -23,45 €  1.234,56 €
05/11/2026  Nómina EMPRESA SA  1.800,00 €  3.034,56 €`, 2, 1800, 23.45],
['Santander ES (meses ES)', `Extracto 2026
03 dic 2026  RECIBO IBERDROLA  -60,00  940,00
05 ene 2026  BIZUM DE PEPE  20,00  960,00`, 2, 20, 60],
['BNP FR (espaço milhares, débit/crédit)', `RELEVE DE COMPTE  du 01.11.2026 au 30.11.2026
Date  Nature des opérations  Valeur  Débit  Crédit
SOLDE CREDITEUR AU 01.11.2026  1 200,00
03.11  PRLV SEPA EDF  03.11  45,67
05.11  VIR SEPA SALAIRE  05.11  2 100,00`, 2, 2100, 45.67],
['Crédit Agricole FR (mois FR)', `Relevé 2026
03 déc.  CB CARREFOUR  -34,50
05 févr.  VIREMENT RECU  150,00`, 2, 150, 34.5],
['DKB DE (Soll/Haben)', `Kontoauszug November 2026
Buchungstag  Wertstellung  Verwendungszweck  Betrag
03.11.2026  03.11.2026  REWE Markt  -12,30 €
05.11.2026  05.11.2026  Gehalt Firma GmbH  2.500,00 €`, 2, 2500, 12.3],
['Mais recente primeiro', `Data  Descrição  Valor  Saldo
10/11/2026  COMPRA LIDL  15,00  1.085,00
05/11/2026  TRF RECEBIDA  100,00  1.100,00
03/11/2026  COMPRA PINGO DOCE  20,00  1.000,00
Saldo anterior  1.020,00`, 3, 100, 35],
];
describe('PDF de vários bancos', () => {
  it.each(S)('%s', (_name, text, n, inc, out) => {
    const r = rowsFromText(text);
    const sum = (t: string) => Math.round(r.filter((x) => x.type === t).reduce((a, x) => a + x.amountCents, 0)) / 100;
    expect([r.length, sum('income'), sum('expense')]).toEqual([n, inc, out]);
  });
});
