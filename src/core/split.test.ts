import { describe, expect, it } from 'vitest';
import { billStatus, myPending, parseContact, toBills } from './split';

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

  it('parses email or phone invites', () => {
    expect(parseContact(' Ana@Mail.PT ')).toEqual({ email: 'ana@mail.pt', phone: null });
    expect(parseContact('+351 912 345 678')).toEqual({ email: null, phone: '351912345678' });
    expect(parseContact('912')).toBeNull();
    expect(parseContact('ana')).toBeNull();
  });
});
