// Grupo de transações ↔ grupo da divisão de contas. O id leva os dois (e a pessoa, porque cada uma tem o seu grupo).
export const linkedGroupId = (splitId: string, userId: string) => `sp_${splitId}_${userId.slice(0, 8)}`;
export const splitIdOf = (groupId: string): string | null => /^sp_([0-9a-f-]{36})_/i.exec(groupId)?.[1] ?? null;
