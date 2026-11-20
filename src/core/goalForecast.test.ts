import { describe, it, expect } from 'vitest';
import { forecastGoal } from './goalForecast';

describe('forecastGoal: padrões de poupança', () => {
  it('ritmo estável de 200 €/mês', () => {
    const f = forecastGoal([20000, 20000, 20000, 20000, 0], 100000);
    expect(f.trend).toBe('stable');
    expect(f.perMonthCents).toBe(20000);
    expect(f.etaMonths).toBe(5);
  });
  it('passa a juntar mais: a previsão adianta', () => {
    const f = forecastGoal([20000, 20000, 20000, 30000, 30000, 0], 120000);
    expect(f.trend).toBe('up');
    expect(f.perMonthCents).toBe(30000);
    expect(f.usualCents).toBe(20000);
    expect(f.etaMonths).toBe(4);
  });
  it('passa a juntar menos: a previsão atrasa', () => {
    const f = forecastGoal([20000, 20000, 20000, 10000, 10000, 0], 100000);
    expect(f.trend).toBe('down');
    expect(f.perMonthCents).toBe(10000);
    expect(f.etaMonths).toBe(10);
  });
  it('um mês fora do normal não muda o padrão', () => {
    const f = forecastGoal([20000, 20000, 20000, 50000, 20000, 0], 100000);
    expect(f.trend).toBe('stable');
  });
  it('sem dados', () => {
    expect(forecastGoal([0], 100000).etaMonths).toBeNull();
  });
  it('mês atual a meio só conta se já passou o habitual', () => {
    expect(forecastGoal([20000, 20000, 20000, 5000], 100000, 0.3).perMonthCents).toBe(20000);
  });
});
