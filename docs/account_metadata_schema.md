# Account Metadata Schema Design

## Current State (Post Loan Details Feature)

```
Account (existing)
├── loanDetails → AccountLoanDetails (1:1, liability-focused)
└── [future metadata tables]

AccountLoanDetails (existing)
├── loanType: MORTGAGE | AUTO_LOAN | PERSONAL_LOAN | HELOC | OTHER
├── Interest, terms, amortization, payment schedule
└── Source tracking & audit fields
```

---

## Proposed Extensible Design

### Approach: Type-Specific Metadata Tables

Create separate metadata tables for account types that require rich, queryable metadata. High-value types get dedicated tables; others use a generic fallback.

```
Account (enhanced)
├── loanDetails → AccountLoanDetails (1:1)
├── investmentDetails → AccountInvestmentDetails (1:1)
├── registeredAccountDetails → AccountRegisteredDetails (1:1)
├── creditCardDetails → AccountCreditCardDetails (1:1)
└── genericMetadata: JSON (catch-all for future/niche types)
```

---

## Schema Definitions by Account Type

### 1. INVESTMENT Accounts (Non-Registered)

**When to use:** INVESTMENT account type (brokerage, etc.)

**Use cases:**
- Tracking portfolio allocation and drift
- Rebalancing targets
- Performance monitoring
- Asset class allocation
- Benchmark comparison

```prisma
model AccountInvestmentDetails {
  accountId                    String           @id
  account                      Account          @relation(fields: [accountId], references: [id], onDelete: Cascade)
  
  // Asset allocation
  targetAllocationEquity       Decimal?         @db.Decimal(5, 2)   // 0-100%
  targetAllocationBonds        Decimal?         @db.Decimal(5, 2)
  targetAllocationCash         Decimal?         @db.Decimal(5, 2)
  targetAllocationOther        Decimal?         @db.Decimal(5, 2)
  
  // Performance tracking
  benchmarkName                String?          // "S&P 500", "VGRO", "XGRO", etc.
  benchmarkTicker              String?
  
  // Account features
  accountFeatures              String?          // JSON or comma-separated: "dividend-reinvestment,margin-available,options-enabled"
  marginAvailable              Decimal?         @db.Decimal(15, 2)
  marginUsed                   Decimal?         @db.Decimal(15, 2)
  
  // Rebalancing
  lastRebalancedAt             DateTime?
  rebalancingThreshold         Decimal?         @db.Decimal(5, 2)   // When drift > this %, rebalance
  
  lastVerifiedAt               DateTime?
  notes                        String?
  updatedAt                    DateTime         @updatedAt
  
  @@index([accountId])
}
```

---

### 2. REGISTERED Accounts (RRSP / TFSA / RESP)

**When to use:** INVESTMENT account type where institution provides account subtype

**Use cases:**
- Contribution room tracking
- Annual limit management
- Tax-deferred optimization
- Carryforward tracking
- Government grant tracking (RESP)

```prisma
model AccountRegisteredDetails {
  accountId                    String           @id
  account                      Account          @relation(fields: [accountId], references: [id], onDelete: Cascade)
  
  // Account registration type
  registrationType             RegistrationType  // RRSP | TFSA | RESP | RIF | CESG | RDSP | OTHER
  
  // Contribution room (RRSP / TFSA / RESP)
  annualContributionLimit      Decimal?         @db.Decimal(15, 2)   // 2026 limit
  contributedThisYear          Decimal?         @db.Decimal(15, 2)   // Contributions made Jan 1 - now
  totalContributionRoom        Decimal?         @db.Decimal(15, 2)   // Lifetime cumulative available
  unusedCarryforward           Decimal?         @db.Decimal(15, 2)   // Room from prior years
  
  // RESP-specific
  grantEarningsAccumulated     Decimal?         @db.Decimal(15, 2)   // CESG + other grants earned
  beneficiaryName              String?
  beneficiaryDOB               DateTime?
  
  // RRSP-specific
  rrspDeductionLimit           Decimal?         @db.Decimal(15, 2)   // CRA limit
  
  // Timeline
  fiscalYearEnd                Int?             // Month (1-12) of account FY for contribution tracking
  lastVerifiedAt               DateTime?
  verificationSource           String?          // "CRA_NOTICE_OF_ASSESSMENT" | "INSTITUTION_STATEMENT" | "USER_ENTERED"
  
  notes                        String?
  createdAt                    DateTime         @default(now())
  updatedAt                    DateTime         @updatedAt
  
  @@index([registrationType])
  @@index([accountId])
}

enum RegistrationType {
  RRSP
  TFSA
  RESP
  RIF          // Registered Retirement Income Fund
  CESG          // Canada Education Savings Grant (RESP variant)
  RDSP          // Registered Disability Savings Plan
  OTHER
}
```

---

### 3. CREDIT_CARD Accounts

**When to use:** CREDIT_CARD account type

**Use cases:**
- Credit limit tracking
- Utilization monitoring
- Interest rate tracking
- Rewards program details
- Payment behavior analysis

```prisma
model AccountCreditCardDetails {
  accountId                    String           @id
  account                      Account          @relation(fields: [accountId], references: [id], onDelete: Cascade)
  
  // Credit terms
  creditLimit                  Decimal?         @db.Decimal(15, 2)
  creditUtilization            Decimal?         @db.Decimal(5, 2)     // 0-100%, current
  interestRateAPR              Decimal?         @db.Decimal(7, 4)
  gracePeriodDays              Int?             // Days before interest charges
  
  // Rewards & benefits
  rewardsProgram               String?           // "AEROPLAN" | "CASH_BACK" | "POINTS" | "NONE"
  rewardsRate                  Decimal?          @db.Decimal(5, 3)     // e.g., 1.5% or 2 points per dollar
  rewardsCategory              String?           // "FLAT" | "CATEGORY_BASED" | "TIERED"
  rewardsAccumulated           Decimal?          @db.Decimal(15, 2)    // Points, miles, or cash value
  
  // Account features
  annualFee                    Decimal?          @db.Decimal(8, 2)
  hasNoAnnualFee               Boolean?
  benefits                     String?           // JSON or comma-separated: "travel-insurance,purchase-protection,extended-warranty"
  
  // Payment tracking
  minimumPaymentPercent        Decimal?          @db.Decimal(5, 2)     // % of balance typically required
  dueDate                      Int?              // Day of month (e.g., 23)
  statementCycleDay            Int?              // When statement closes
  
  lastVerifiedAt               DateTime?
  notes                        String?
  updatedAt                    DateTime         @updatedAt
  
  @@index([accountId])
}
```

---

### 4. SAVINGS Accounts

**When to use:** SAVINGS account type

**Use cases:**
- Interest rate tracking
- Account features tracking
- Minimum balance requirements
- Rate shopping/optimization

```prisma
model AccountSavingsDetails {
  accountId                    String           @id
  account                      Account          @relation(fields: [accountId], references: [id], onDelete: Cascade)
  
  // Interest & rate
  interestRateAnnual           Decimal?         @db.Decimal(7, 4)
  interestCompounding          String?          // "DAILY" | "MONTHLY" | "QUARTERLY" | "ANNUAL"
  lastRateChangeAt             DateTime?
  
  // Account features & limits
  minimumBalanceRequired       Decimal?         @db.Decimal(15, 2)
  monthlyTransactionLimit      Int?
  monthlyWithdrawalFee         Decimal?         @db.Decimal(8, 2)
  features                     String?          // "auto-save" | "round-up" | "goal-tracking"
  
  // Purpose
  savingsGoal                  String?           // "EMERGENCY_FUND" | "VACATION" | "DOWN_PAYMENT" | "OTHER"
  goalTargetAmount             Decimal?          @db.Decimal(15, 2)
  goalTargetDate               DateTime?
  
  lastVerifiedAt               DateTime?
  notes                        String?
  updatedAt                    DateTime         @updatedAt
  
  @@index([accountId])
}
```

---

### 5. INSURANCE Accounts

**When to use:** NEW account type (currently would need to be OTHER)

**Use cases:**
- Coverage tracking
- Beneficiary management
- Premium scheduling
- Policy renewal dates

```prisma
model AccountInsuranceDetails {
  accountId                    String           @id
  account                      Account          @relation(fields: [accountId], references: [id], onDelete: Cascade)
  
  policyType                   InsurancePolicyType  // LIFE | DISABILITY | CRITICAL_ILLNESS | PROPERTY
  policyNumber                 String?
  coverageAmount               Decimal?         @db.Decimal(15, 2)
  
  premiumAmount                Decimal?         @db.Decimal(15, 2)
  premiumFrequency             String?          // "MONTHLY" | "QUARTERLY" | "ANNUAL"
  nextPremiumDueAt             DateTime?
  
  beneficiaryName              String?
  beneficiaryRelation          String?
  
  policyInceptionDate          DateTime?
  policyMaturityDate           DateTime?
  renewalDate                  DateTime?
  
  lastVerifiedAt               DateTime?
  notes                        String?
  updatedAt                    DateTime         @updatedAt
  
  @@index([policyType])
}

enum InsurancePolicyType {
  LIFE
  DISABILITY
  CRITICAL_ILLNESS
  PROPERTY
  AUTO
  OTHER
}
```

---

## Generic Fallback: `AccountGenericMetadata`

For account types not yet supported with specific tables:

```prisma
model AccountGenericMetadata {
  accountId                    String           @id
  account                      Account          @relation(fields: [accountId], references: [id], onDelete: Cascade)
  
  accountSubtype               String?           // e.g., "HIGH_INTEREST_SAVINGS", "GIC", "MARGIN"
  metadata                     Json              // Flexible key-value store
  // Example:
  // {
  //   "interestRate": 4.5,
  //   "maturityDate": "2027-04-23",
  //   "isAutoRenewing": true,
  //   "customField": "value"
  // }
  
  lastVerifiedAt               DateTime?
  notes                        String?
  updatedAt                    DateTime         @updatedAt
  
  @@index([accountId])
}
```

---

## Account Type → Metadata Mapping

| Account Type | Metadata Table | Priority | Value | Effort |
|---|---|---|---|---|
| MORTGAGE | AccountLoanDetails | ✅ P1 | Renewal planning, amortization | Done |
| AUTO_LOAN | AccountLoanDetails | ✅ P1 | Payoff tracking | Done |
| PERSONAL_LOAN | AccountLoanDetails | ✅ P1 | Debt planning | Done |
| HELOC | AccountLoanDetails | ✅ P1 | Available balance, rate | Done |
| CREDIT_CARD | AccountCreditCardDetails | 🔴 P2 | Utilization, rewards, payoff | High |
| INVESTMENT | AccountInvestmentDetails | 🟡 P3 | Allocation, rebalancing | Medium |
| RRSP | AccountRegisteredDetails | 🔴 P2 | Contribution room, tax planning | High |
| TFSA | AccountRegisteredDetails | 🔴 P2 | Contribution room, optimization | High |
| RESP | AccountRegisteredDetails | 🟡 P3 | Grants, beneficiary, room | High |
| SAVINGS | AccountSavingsDetails | 🟡 P3 | Interest rate, goals | Low |
| CHECKING | AccountGenericMetadata | 🟢 P4 | Institution details | Very Low |
| GIC / TERM DEPOSIT | AccountGenericMetadata | 🟡 P3 | Maturity date, rate | Low |
| INSURANCE | AccountInsuranceDetails | 🟡 P3 | Coverage, beneficiary | Medium |

---

## API Changes Required

### New Endpoints

```bash
# Credit cards
PATCH /api/accounts/<id>/credit-card-details
GET /api/accounts/<id>/credit-card-details

# Registered accounts
PATCH /api/accounts/<id>/registered-details
GET /api/accounts/<id>/registered-details

# Investment
PATCH /api/accounts/<id>/investment-details
GET /api/accounts/<id>/investment-details

# Savings
PATCH /api/accounts/<id>/savings-details
GET /api/accounts/<id>/savings-details

# Generic fallback
PATCH /api/accounts/<id>/metadata
GET /api/accounts/<id>/metadata
```

### Enhanced Account Read Response

```json
{
  "data": {
    "id": "acc_123",
    "name": "Primary Mortgage",
    "type": "MORTGAGE",
    "balance": -538830.46,
    "loanDetails": { ... },
    "investmentDetails": null,
    "registeredDetails": null,
    "creditCardDetails": null,
    "genericMetadata": null
  }
}
```

---

## Phased Rollout Recommendation

### Phase 1 ✅ (Done)
- AccountLoanDetails (all loan types)

### Phase 2 (High Value)
- **AccountRegisteredDetails** — RRSP/TFSA contribution room (most requested)
- **AccountCreditCardDetails** — Credit limit, utilization, rewards

**Why Phase 2?** Agents handling Canadian finances will immediately ask "How much RRSP room?" and "What's my credit limit?" These drive concrete decisions (tax planning, payoff strategy).

### Phase 3 (Medium Value)
- AccountInvestmentDetails — Portfolio rebalancing
- AccountSavingsDetails — Goal tracking
- AccountInsuranceDetails — Coverage monitoring

**Why Phase 3?** Useful but less critical; can be addressed with `notes` in loan details until agents demonstrate demand.

### Phase 4 (As Needed)
- AccountGenericMetadata — Catch-all for unforeseen types

---

## Key Design Decisions

1. **Separate tables per type** (not one generic table)
   - ✅ Type safety, queryable, indexable
   - ✅ Schema can evolve independently per type
   - ❌ More tables, more migration work

2. **All fields optional** except type discriminator
   - ✅ Supports progressive enrichment
   - ✅ Backward compatible
   - ✅ Matches loan details pattern

3. **Source tracking** (where did this data come from?)
   - ✅ Critical for RRSP/TFSA (CRA vs. institution vs. user)
   - ✅ Helps validate data freshness
   - ✅ Supports audit trails

4. **Generic fallback** for edge cases
   - ✅ Doesn't force schema changes for one-off needs
   - ❌ Less queryable, less safe (no validation)

5. **SimpleFin sync non-destructive**
   - ✅ User-entered metadata persists (like loan details)
   - ✅ Only balances updated from sync

---

## Implementation Notes

### Validation Rules

**AccountRegisteredDetails:**
- If `registrationType` = RRSP: require `annualContributionLimit` or mark as incomplete
- `contributedThisYear` + `unusedCarryforward` ≥ `totalContributionRoom`
- `beneficiaryDOB` required for RESP; optional others

**AccountInvestmentDetails:**
- Sum of allocation targets should ≈ 100% (warn if > 100%)
- `rebalancingThreshold` must be 0-100

**AccountCreditCardDetails:**
- `creditUtilization` = min(`balance` / `creditLimit` * 100, 100)
- `interestRateAPR` must be ≥ 0

### Agent Confirmation Requirements

Add to skill confirmation rules:
```
| PATCH /api/accounts/<id>/registered-details    | Contribution room affects tax planning; verify with CRA or statement |
| PATCH /api/accounts/<id>/credit-card-details   | Credit limit and utilization are sensitive; confirm with institution |
| PATCH /api/accounts/<id>/investment-details    | Asset allocation changes rebalancing strategy; confirm targets      |
```

---

## Example: Capturing RRSP Room

**User:** "I want to max out my RRSP this year. How much room do I have?"

**Current (post-loan-details) workflow:**
```bash
# Agent can only see balance
curl http://localhost:3030/api/accounts | jq '.data[] | select(.name | contains("RRSP"))'
# Returns: { name: "RRSP (TD)", balance: 185230.45, type: "INVESTMENT" }
# Agent: "I can see your RRSP balance but not your contribution room."
```

**Post-Phase-2 workflow:**
```bash
# Agent reads registered account details
curl http://localhost:3030/api/accounts/<rrsp-id> | jq '.data.registeredDetails'
# Returns:
{
  "registrationType": "RRSP",
  "annualContributionLimit": 31560,
  "contributedThisYear": 8000,
  "totalContributionRoom": 67890,
  "unusedCarryforward": 35330,
  "lastVerifiedAt": "2026-04-23T00:00:00Z",
  "verificationSource": "CRA_NOTICE_OF_ASSESSMENT"
}

# Agent: "You have $59,890 in total room ($31,560 this year + $28,330 carryforward).
#         You've contributed $8,000 YTD, so you can add $23,560 more this year.
#         That's perfect timing for your tax return strategy."
```

