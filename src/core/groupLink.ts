// Grupo de transações ↔ grupo da divisão de contas. O id leva os dois (e a pessoa, porque cada uma tem o seu grupo).
export const linkedGroupId = (splitId: string, userId: string) => `sp_${splitId}_${userId.slice(0, 8)}`;
/** Aceitou-se um convite ou mudou uma divisão: a página Grupos volta a ler. */
export const SPLIT_CHANGED = 'wallet:split-changed';
/** A minha parte de uma transação dividida tem este id: se a pessoa a apagar, volta a "por pagar" no grupo. */
export const shareTxId = (billId: string, userId: string) => `spb_${billId}_${userId.slice(0, 8)}`;
export const billOfTx = (txId: string): string | null => /^spb_([0-9a-f-]{36})_/i.exec(txId)?.[1] ?? null;
export const SHARE_REMOVED = 'wallet:split-share-removed'; // detail = id da transação do grupo
export const splitIdOf = (groupId: string): string | null => /^sp_([0-9a-f-]{36})_/i.exec(groupId)?.[1] ?? null;
