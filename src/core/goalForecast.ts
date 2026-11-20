// Previsão das metas com deteção de padrões.
// Entrada: quanto entrou na meta em cada mês (do mais antigo para o mais recente; o último é o mês atual).
//  • Ritmo normal: média ponderada dos últimos meses (os mais recentes pesam mais).
//  • Mudança de padrão: se os 2–3 meses mais recentes estão todos acima (ou abaixo) do ritmo anterior em mais de 20%,
//    assume-se o novo ritmo (ex.: passou de 200 €/mês para 300 €/mês) e a previsão muda.
//  • Um mês fora do normal sozinho não muda o padrão.

export type Trend = 'up' | 'down' | 'stable' | 'none';
export interface GoalForecast {
  perMonthCents: number; // ritmo usado na previsão
  usualCents: number; // ritmo "de costume" (antes da mudança, se houver)
  trend: Trend;
  etaMonths: number | null; // meses até chegar (null = sem dados ou ritmo <= 0)
  months: number; // meses com dados
}

const THRESHOLD = 0.2;

function weighted(values: number[]): number {
  if (!values.length) return 0;
  let sum = 0, w = 0;
  values.forEach((v, i) => { const k = Math.pow(1.5, i); sum += v * k; w += k; }); // mais recente = mais peso
  return sum / w;
}
const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

/** monthly: valor que entrou em cada mês (cêntimos), do mais antigo ao mais recente. O mês atual pode estar a meio. */
export function forecastGoal(monthly: number[], leftCents: number, currentMonthDayRatio = 1): GoalForecast {
  // o mês atual ainda a meio só conta se já tiver mais do que o habitual (senão puxava o ritmo para baixo)
  const closed = monthly.slice(0, -1);
  const cur = monthly[monthly.length - 1] ?? 0;
  const base = closed.slice(-6);
  const series = cur > 0 && (currentMonthDayRatio >= 0.9 || cur >= avg(base)) ? [...base, cur] : base;
  const months = series.filter((v, i) => v !== 0 || i > series.findIndex((x) => x !== 0)).length;
  if (leftCents <= 0) return { perMonthCents: 0, usualCents: 0, trend: 'stable', etaMonths: 0, months };
  if (months === 0) return { perMonthCents: 0, usualCents: 0, trend: 'none', etaMonths: null, months: 0 };

  let trend: Trend = 'stable';
  let usual = weighted(series);
  let rate = usual;
  // mudança de padrão: últimos 2 (ou 3) meses todos do mesmo lado do ritmo anterior, por mais de 20%
  for (const n of [3, 2]) {
    if (series.length < n + 2) continue;
    const before = avg(series.slice(0, -n));
    const recent = series.slice(-n);
    if (before <= 0) continue;
    if (recent.every((v) => v > before * (1 + THRESHOLD))) { trend = 'up'; usual = before; rate = avg(recent); break; }
    if (recent.every((v) => v < before * (1 - THRESHOLD))) { trend = 'down'; usual = before; rate = avg(recent); break; }
  }
  const perMonthCents = Math.round(rate);
  return { perMonthCents, usualCents: Math.round(usual), trend, etaMonths: perMonthCents > 0 ? Math.ceil(leftCents / perMonthCents) : null, months };
}
