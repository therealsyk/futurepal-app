// Divisão de contas em grupos: lógica pura (testável). Os dados vêm do Supabase (supabase/split.sql).

export interface SplitShare { userId: string; shareCents: number; paidAt: string | null }
export interface SplitBill { id: string; description: string; amountCents: number; date: string; createdBy: string; shares: SplitShare[] }

/** Estado de uma conta: quanto já foi pago, quanto falta e quem falta. */
export function billStatus(bill: SplitBill) {
  const paid = bill.shares.filter((s) => s.paidAt);
  const unpaid = bill.shares.filter((s) => !s.paidAt);
  return {
    paidCents: paid.reduce((a, s) => a + s.shareCents, 0),
    unpaidCents: unpaid.reduce((a, s) => a + s.shareCents, 0),
    paid: paid.map((s) => s.userId),
    unpaid: unpaid.map((s) => s.userId),
    done: unpaid.length === 0,
  };
}

/** Quanto eu ainda tenho por pagar no grupo, e em quantas contas. */
export function myPending(bills: SplitBill[], me: string): { cents: number; count: number } {
  let cents = 0;
  let count = 0;
  for (const b of bills) {
    const s = b.shares.find((x) => x.userId === me);
    if (s && !s.paidAt && s.shareCents > 0) { cents += s.shareCents; count++; }
  }
  return { cents, count };
}

/** Lê um convite: devolve email (minúsculas) ou telemóvel (só dígitos, 9+), ou null se não for válido. */
export function parseContact(raw: string): { email: string | null; phone: string | null } | null {
  const v = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { email: v.toLowerCase(), phone: null };
  const digits = v.replace(/\D/g, '');
  if (/^[+\d\s().-]+$/.test(v) && digits.length >= 9 && digits.length <= 15) return { email: null, phone: digits };
  return null;
}

/** Converte linhas do Supabase (bills + shares) no formato da app. */
export function toBills(bills: any[], shares: any[]): SplitBill[] {
  const byBill = new Map<string, SplitShare[]>();
  for (const s of shares) {
    const list = byBill.get(s.bill_id) ?? [];
    list.push({ userId: s.user_id, shareCents: Number(s.share_cents), paidAt: s.paid_at ?? null });
    byBill.set(s.bill_id, list);
  }
  return bills.map((b) => ({ id: b.id, description: b.description, amountCents: Number(b.amount_cents), date: b.date, createdBy: b.created_by, shares: byBill.get(b.id) ?? [] }));
}
