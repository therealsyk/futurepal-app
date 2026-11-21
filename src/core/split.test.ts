import { describe, expect, it } from 'vitest';
import { billProgress, billStatus, groupSummary, myPending, parseContact, toBills } from './split';

describe('split', () => {
  const bills = toBills(
    [{ id: 'b1', description: 'Jantar', amount_cents: '9000', date: '2026-11-15', created_by: 'a' }, { id: 'b2', description: 'Luz', amount_cents: 6000, date: '2026-11-01', created_by: 'b' }],
    [
      { bill_id: 'b1', user_id: 'a', share_cents: 3000, paid_at: '2026-11-15T20:00:00Z' },
      { bill_id: 'b1', user_id: 'b', share_cents: 3000, paid_at: null },
      { bill_id: 'b1', user_id: 'c', share_cents: 3000, paid_at: null },
      { bill_id: 'b2', user_id: 'b', share_cents: 3000, paid_at: '2026-11-02T10:00:00Z' },
      { bill_id: 'b2', user_id: 'c', share_cents: 3000, paid_at: null },
    ],
  );

  it('shows who paid and who did not', () => {
    expect(billStatus(bills[0])).toEqual({ paidCents: 3000, unpaidCents: 6000, paid: ['a'], unpaid: ['b', 'c'], done: false });
    expect(bills[0].amountCents).toBe(9000);
  });

  it('sums what I still owe', () => {
    expect(myPending(bills, 'c')).toEqual({ cents: 6000, count: 2 });
    expect(myPending(bills, 'a')).toEqual({ cents: 0, count: 0 });
  });

  it('progress: remaining goes down as people pay', () => {
    const p = billProgress(bills[0]);
    expect(p).toMatchObject({ totalCents: 9000, paidCents: 3000, remainingCents: 6000, pct: 33, people: 3, eachCents: 3000, paid: ['a'], unpaid: ['b', 'c'], done: false });
    const allPaid = { ...bills[0], shares: bills[0].shares.map((s) => ({ ...s, paidAt: '2026-11-16T00:00:00Z' })) };
    expect(billProgress(allPaid)).toMatchObject({ remainingCents: 0, paidCents: 9000, pct: 100, done: true });
    expect(billProgress({ ...bills[0], amountCents: 0, shares: [] })).toMatchObject({ pct: 100, eachCents: 0 });
  });

  it('group summary: what I owe and what they owe me', () => {
    // a criou b1 (b e c devem 30 cada); b criou b2 (c deve 30)
    expect(groupSummary(bills, 'a')).toEqual({ iOweCents: 0, owedToMeCents: 6000, openBills: 2, settledBills: 0 });
    expect(groupSummary(bills, 'c')).toEqual({ iOweCents: 6000, owedToMeCents: 0, openBills: 2, settledBills: 0 });
    expect(groupSummary(bills, 'b')).toEqual({ iOweCents: 3000, owedToMeCents: 3000, openBills: 2, settledBills: 0 });
  });

  it('parses email or phone invites', () => {
    expect(parseContact(' Ana@Mail.PT ')).toEqual({ email: 'ana@mail.pt', phone: null });
    expect(parseContact('+351 912 345 678')).toEqual({ email: null, phone: '351912345678' });
    expect(parseContact('912')).toBeNull();
    expect(parseContact('ana')).toBeNull();
  });
});
