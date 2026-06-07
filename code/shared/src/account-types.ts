export const ASSET_ACCOUNT_TYPES = ['CHECKING', 'SAVINGS', 'INVESTMENT', 'OTHER'] as const;
export const LIABILITY_ACCOUNT_TYPES = ['CREDIT_CARD', 'LOAN', 'MORTGAGE'] as const;

export type AssetAccountType = (typeof ASSET_ACCOUNT_TYPES)[number];
export type LiabilityAccountType = (typeof LIABILITY_ACCOUNT_TYPES)[number];

export function isAssetAccountType(type: string): type is AssetAccountType {
  return (ASSET_ACCOUNT_TYPES as readonly string[]).includes(type);
}

export function isLiabilityAccountType(type: string): type is LiabilityAccountType {
  return (LIABILITY_ACCOUNT_TYPES as readonly string[]).includes(type);
}
