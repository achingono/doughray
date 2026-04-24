export interface Account {
  id: string;
  name: string;
  institution: string | null;
  type: AccountType;
  currency: string;
  balance: number;
  availableBalance: number | null;
  balanceDate: string;
  transactionCount: number;
}

export interface AccountDetail extends Account {
  externalId: string;
  institutionDomain: string | null;
  isActive: boolean;
  loanDetails: LoanDetails | null;
  registeredDetails: RegisteredDetails | null;
  creditCardDetails: CreditCardDetails | null;
  investmentDetails: null;
  savingsDetails: null;
  genericMetadata: null;
  recentTransactions: TransactionSummary[];
}

export type LoanType = 'MORTGAGE' | 'AUTO_LOAN' | 'PERSONAL_LOAN' | 'HELOC' | 'OTHER';
export type InterestType = 'FIXED' | 'VARIABLE';
export type PaymentFrequency = 'WEEKLY' | 'BIWEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY';
export type LoanDetailSource = 'USER_ENTERED' | 'IMPORTED' | 'SYNCED';

export interface LoanDetails {
  loanType: LoanType;
  originalPrincipal: number | null;
  currentPrincipal: number | null;
  interestType: InterestType | null;
  interestRateAnnual: number | null;
  paymentAmount: number | null;
  paymentFrequency: PaymentFrequency | null;
  termStartDate: string | null;
  termMaturityDate: string | null;
  originalAmortizationMonths: number | null;
  remainingAmortizationMonths: number | null;
  renewalDate: string | null;
  notes: string | null;
  lastVerifiedAt: string | null;
  source: LoanDetailSource;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RegistrationType = 'RRSP' | 'TFSA' | 'RESP' | 'RIF' | 'RDSP';
export type RegistrationVerificationSource =
  | 'CRA_NOTICE_OF_ASSESSMENT'
  | 'INSTITUTION_STATEMENT'
  | 'USER_ENTERED'
  | 'IMPORTED';

export interface RegisteredDetails {
  accountId: string;
  registrationType: RegistrationType;
  annualContributionLimit: number;
  totalContributionRoom: number;
  contributedThisYear: number;
  unusedCarryforward: number;
  beneficiaryName: string | null;
  beneficiaryDateOfBirth: string | null;
  grantRoomAvailable: number | null;
  grantsReceived: number | null;
  subscriptionLimit: number | null;
  verificationSource: RegistrationVerificationSource;
  lastVerifiedAt: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegisteredDetailsResponse extends RegisteredDetails {
  staleness: {
    isDaysOld: number;
    isStale: boolean;
    warningMessage: string | null;
  };
}

export type CreditCardRewardsProgram = 'NONE' | 'CASH_BACK' | 'POINTS' | 'MILES' | 'TRAVEL_CREDIT';
export type CreditCardType = 'CREDIT' | 'CHARGE' | 'SECURED';
export type CreditCardVerificationSource =
  | 'INSTITUTION_STATEMENT'
  | 'USER_ENTERED'
  | 'SYNCED_FROM_ACCOUNT_AGGREGATOR';

export interface CreditCardDetails {
  accountId: string;
  creditLimit: number;
  currentUtilization: number;
  annualPercentageRate: number;
  minimumPaymentDueDate: number;
  lastStatementBalance: number;
  lastStatementDate: string | null;
  hasAnnualFee: boolean;
  annualFeeAmount: number | null;
  rewardsProgram: CreditCardRewardsProgram | null;
  rewardsRate: number | null;
  rewardsRedeemedThisYear: number | null;
  issuingBank: string | null;
  cardType: CreditCardType | null;
  verificationSource: CreditCardVerificationSource;
  lastVerifiedAt: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreditCardDetailsResponse extends CreditCardDetails {
  utilization: {
    isHigh: boolean;
    warningMessage: string | null;
  };
}

export interface TransactionSummary {
  id: string;
  posted: string;
  amount: number;
  description: string;
  payee: string | null;
  category: CategoryRef | null;
}

export interface Transaction {
  id: string;
  posted: string;
  amount: number;
  description: string;
  payee: string | null;
  memo: string | null;
  isReviewed: boolean;
  categoryRuleId: string | null;
  account: { id: string; name: string; institution: string | null };
  category: CategoryRef | null;
}

export interface CategoryRef {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

export interface TransactionFilterCategory extends CategoryRef {
  count: number;
}

export type RecategorizeScope = 'single-instance' | 'all-past' | 'all-future' | 'all-past-and-future';

export interface RecategorizePreview {
  normalizedPayee: string;
  scope: RecategorizeScope;
  eligiblePastCount: number;
  sample: Array<{
    id: string;
    posted: string;
    amount: number;
    description: string;
    payee: string | null;
    categoryId: string | null;
  }>;
  existingRule: {
    id: string;
    categoryId: string;
    accountId: string | null;
  } | null;
}

export interface RecategorizeResult {
  transactionId: string;
  categoryId: string;
  scope: RecategorizeScope;
  normalizedPayee: string;
  appliedPastCount: number;
  futureRule: {
    id: string;
    categoryId: string;
    accountId: string | null;
  } | null;
}

export interface CategoryRule {
  id: string;
  normalizedPayee: string;
  categoryId: string;
  accountId: string | null;
  sourceTransactionId: string;
  createdAt: string;
  updatedAt: string;
  category: CategoryRef;
  account: { id: string; name: string; institution: string | null } | null;
}

export type TransactionImportFormat = 'csv' | 'ofx' | 'qfx' | 'xlsx';

export interface TransactionImportResult {
  format: TransactionImportFormat;
  parsedCount: number;
  importedCount: number;
  skippedCount: number;
  account?: {
    id: string;
    name: string;
    created: boolean;
  };
  accounts: Array<{
    id: string;
    name: string;
    created: boolean;
  }>;
  categorizationTriggered: boolean;
}

export interface Category {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  parentId: string | null;
  children: Category[];
}

export interface Budget {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  categoryColor: string | null;
  amount: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  period: string;
  startDate: string;
  endDate: string | null;
}

export interface Report {
  id: string;
  title: string;
  type: string;
  content: ReportContent | PFSContent | SpendingAnalysisContent;
  period: string;
  generatedAt: string;
}

export interface ReportContent {
  title: string;
  highlights: string[];
  incomeAnalysis: string;
  expenseAnalysis: string;
  savingsAnalysis: string;
  topExpenseInsights: string[];
  recommendations: string[];
  overallScore: string;
  scoreExplanation: string;
}

export interface PFSContent {
  reportDate: string;
  periodCovered: string;

  // Page 1: Executive Summary
  netWorth: number;
  netWorthChange: { amount: number; percentage: number; comparedTo: string };
  totalAssets: number;
  totalLiabilities: number;
  assetAllocation: Array<{ category: string; value: number; percentage: number }>;

  // Page 2: Statement of Financial Condition
  assets: Array<{ category: string; value: number; percentOfTotal: number }>;
  liabilities: Array<{ category: string; value: number; percentOfTotal: number }>;

  // Page 3: CPA Narrative
  trendAnalysis: string;
  taxSensitivityAnalysis: string;
  solvencyBenchmarking: {
    dtiRatio: number;
    liquidityRatio: number;
    savingsRate: number;
    debtToAssetRatio: number;
    analysis: string;
  };
  debtStrategy: {
    method: string;
    analysis: string;
    priorityOrder: Array<{ name: string; balance: number; rate: number }>;
  };
  assetRebalancing: {
    warnings: string[];
    suggestions: string[];
  };
  overallInsight: string;
}

export interface SpendingAnalysisContent {
  reportDate: string;
  periodCovered: string;
  dataQuality: 'sufficient' | 'insufficient';
  totalExpenses: number;
  transactionCount: number;
  essentialVsDiscretionary: {
    essential: number;
    discretionary: number;
    essentialRatio: number;
    discretionaryRatio: number;
  };
  topRecurringMerchants: Array<{
    merchant: string;
    cadence: 'weekly' | 'monthly' | 'annual';
    monthlyCost: number;
    annualCost: number;
    confidence: number;
    transactionCount: number;
  }>;
  subscriptionCandidates: Array<{
    merchant: string;
    monthlyCost: number;
    annualCost: number;
    confidence: number;
    rationale: string;
  }>;
  insuranceOptimization: {
    monthlyAverage: number;
    premiumTrendPercent: number;
    providerCount: number;
  };
  negotiationCandidates: Array<{
    merchant: string;
    averageMonthlySpend: number;
    estimatedMonthlySavings: number;
    rationale: string;
  }>;
  savingsOpportunities: Array<{
    title: string;
    description: string;
    estimatedMonthlySavings: number;
    estimatedAnnualSavings: number;
    confidence: 'low' | 'medium' | 'high';
  }>;
  overview: string;
  subscriptionStrategy: {
    analysis: string;
    actions: string[];
  };
  insuranceStrategy: {
    analysis: string;
    actions: string[];
  };
  negotiationStrategy: {
    analysis: string;
    actions: string[];
  };
  prioritizedActionPlan: Array<{
    priority: number;
    title: string;
    why: string;
    expectedMonthlySavings: number;
  }>;
  overallInsight: string;
}

export interface DashboardSummary {
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyNet: number;
}

export interface TrendDataPoint {
  date: string;
  value: number;
}

export interface SpendingByCategory {
  category: CategoryRef;
  total: number;
}

export interface HoldingsSummary {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  accounts: Account[];
}

export interface SyncStatus {
  id: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  accountCount: number;
  transactionCount: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type AccountType = 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD' | 'INVESTMENT' | 'LOAN' | 'MORTGAGE' | 'OTHER';

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CHECKING: 'Checking',
  SAVINGS: 'Savings',
  CREDIT_CARD: 'Credit Card',
  INVESTMENT: 'Investment',
  LOAN: 'Loan',
  MORTGAGE: 'Mortgage',
  OTHER: 'Other',
};

export const ASSET_TYPES: AccountType[] = ['CHECKING', 'SAVINGS', 'INVESTMENT', 'OTHER'];
export const LIABILITY_TYPES: AccountType[] = ['CREDIT_CARD', 'LOAN', 'MORTGAGE'];

// Asset types
export type AssetType = 'REAL_ESTATE' | 'AUTOMOBILE' | 'STOCK';

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  REAL_ESTATE: 'Real Estate',
  AUTOMOBILE: 'Automobile',
  STOCK: 'Stock',
};

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  purchasePrice: number;
  currentValue: number;
  purchaseDate: string | null;
  address: string | null;
  metadata: Record<string, any> | null;
  lastValuationDate: string | null;
  createdAt: string;
  updatedAt: string;
  valuations: AssetValuation[];
}

export interface AssetValuation {
  id: string;
  value: number;
  source: string;
  valuedAt: string;
}

// Goal types
export type GoalStatus = 'ACTIVE' | 'COMPLETED' | 'PAUSED' | 'CANCELLED';

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  CANCELLED: 'Cancelled',
};

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  percentComplete: number;
  targetDate: string | null;
  status: GoalStatus;
  icon: string | null;
  color: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  accounts: GoalAccountInfo[];
}

export interface GoalAccountInfo {
  id: string;
  name: string;
  institution: string | null;
  type: string;
  balance: number;
}
