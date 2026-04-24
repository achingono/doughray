export const LIABILITY_ACCOUNT_TYPES = ['CREDIT_CARD', 'LOAN', 'MORTGAGE'] as const;

export type LiabilityAccountType = (typeof LIABILITY_ACCOUNT_TYPES)[number];

export function isLiabilityAccountType(type: string): type is LiabilityAccountType {
  return (LIABILITY_ACCOUNT_TYPES as readonly string[]).includes(type);
}