# Phase 2: Account Metadata — Registered Accounts & Credit Cards
## Product Requirements Document

**Date:** April 2026  
**Status:** Draft – Ready for Review  
**Phase:** 2 of 4  
**Predecessor:** Phase 1: Account Loan Details (completed)

---

## Executive Summary

Phase 2 extends Doughray's account metadata system to capture registered account details (RRSP, TFSA, RESP, RIF, RDSP) and credit card information. These account types were identified as high-value in user research: agents frequently ask "How much RRSP room do I have?" and "Which card should I pay off first?" 

Unlike Phase 1 (loan details), registered account metadata and credit card limits are **not available via SimpleFin Bridge**. SimpleFin only syncs balances, institution, and account numbers—CRA contribution room data and credit card limits must be user-entered or imported from institution statements.

Phase 2 maintains consistency with Phase 1's design patterns:
- Type-specific metadata tables (no generic JSON)
- Data freshness tracking (lastVerifiedAt, verificationSource)
- Validation rules enforced at API layer
- Non-destructive sync (user data persists across SimpleFin refreshes)
- Agent-friendly workflows and confirmation rules

**Effort Estimate:** ~22 hours  
**Go-Live Dependency:** Phase 1 (loan details) must be in production first

---

## Problem Statement

### Current State
- Doughray tracks account balances and transactions (SimpleFin Bridge)
- Phase 1 adds loan details (mortgages, auto loans, HELOCs, personal loans)
- **Gap:** No way to track RRSP contribution room, TFSA usage, RESP grants, or credit card limits

### Why This Matters
1. **Tax Planning:** Agents need RRSP room to recommend contribution strategies and savings priorities
2. **Debt Strategy:** Credit card limit and utilization determine payoff priority ("Pay off high-utilization cards first")
3. **Savings Goals:** TFSA available room, RESP grant room inform deposit priorities
4. **Audit Trail:** LastVerifiedAt and verificationSource track data freshness and provenance

### SimpleFin Gap (Root Cause)
SimpleFin Bridge provides **transaction data only**, not account metadata:
- ✅ Balance, transactions, institution, account type
- ❌ CRA contribution room (RRSP, TFSA, RESP)
- ❌ Credit card limit, APR, rewards program
- ❌ RESP grant room, beneficiary details

This is by design—SimpleFin focuses on transactional data. Metadata requires either:
- User entry (with freshness warnings)
- Import from CRA Notice of Assessment / institution statements
- Agent-guided data maintenance

### Impact Without Phase 2
- Agents cannot answer "How much RRSP room?" → user manually tracks
- No credit card payoff optimization → users make suboptimal debt decisions
- No RESP grant tracking → families miss grant deadlines
- Phase 3+ (investment allocation) blocked without Phase 2 foundation

---

## Objectives

1. **Enable Tax Planning:** Agents access RRSP/TFSA/RESP contribution room and recommend contributions
2. **Optimize Debt Strategy:** Agents prioritize credit card payoffs based on limit, utilization, APR
3. **Track Grants & Incentives:** RESP grant room and grant amounts tracked and reported
4. **Maintain Data Freshness:** LastVerifiedAt and source (CRA, institution, user) visible to agents and users
5. **Preserve User Data:** SimpleFin sync updates balance but never overwrites user-entered metadata
6. **Support Phase 3+:** Foundation for investment allocation, savings goals, insurance details

---

## Scope

### In Scope: Phase 2

#### 1. AccountRegisteredDetails Table
Tracks RRSP, TFSA, RESP, RIF, RDSP metadata. Fields:

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| accountId | UUID | Foreign key to Account |
| registrationType | Enum | RRSP \| TFSA \| RESP \| RIF \| RDSP |
| annualContributionLimit | Decimal | CRA annual contribution limit (e.g., RRSP 2024: $31,560) |
| totalContributionRoom | Decimal | Cumulative unused room (user-entered or from CRA NOA) |
| contributedThisYear | Decimal | Amount contributed in current calendar year |
| unusedCarryforward | Decimal | Accumulated unused room from prior years |
| — RESP-specific fields — | | |
| beneficiaryName | String? | Name of RESP beneficiary (required if registrationType = RESP) |
| beneficiaryDateOfBirth | Date? | DOB of beneficiary (required if registrationType = RESP) |
| grantRoomAvailable | Decimal? | CESG/RESP grant room (e.g., $2,500/year × 20% = $500 grant) |
| grantsReceived | Decimal? | Total grants deposited to date |
| subscriptionLimit | Decimal? | Aggregate subscription limit per plan type (e.g., $50k lifetime CESG) |
| — General metadata — | | |
| verificationSource | Enum | CRA_NOTICE_OF_ASSESSMENT \| INSTITUTION_STATEMENT \| USER_ENTERED \| IMPORTED |
| lastVerifiedAt | DateTime | Date metadata was last confirmed (triggers staleness warnings if >365 days) |
| notes | String? | User notes (e.g., "CRA NOA from 2024-03-15") |
| createdAt | DateTime | Audit timestamp |
| updatedAt | DateTime | Audit timestamp |

**Constraints:**
- `registrationType` + `accountId` unique (one registered detail per account)
- `contributedThisYear` + `unusedCarryforward` ≤ `totalContributionRoom` (validation rule)
- RESP: `beneficiaryName` and `beneficiaryDateOfBirth` both required or both null
- All currency fields >= 0
- `lastVerifiedAt` ≤ now()

#### 2. AccountCreditCardDetails Table
Tracks credit card limits, APR, usage, and rewards. Fields:

| Field | Type | Description |
|-------|------|--|
| id | UUID | Primary key |
| accountId | UUID | Foreign key to Account |
| creditLimit | Decimal | Maximum credit available (e.g., $5000) |
| currentUtilization | Decimal | Current balance / creditLimit * 100 (e.g., 45.5%) |
| annualPercentageRate | Decimal | Interest rate (e.g., 19.99%) |
| minimumPaymentDueDate | Int | Day of month 1-31 (e.g., 21 = payment due on 21st) |
| lastStatementBalance | Decimal | Balance at last statement close |
| lastStatementDate | Date? | Date of last statement |
| hasAnnualFee | Boolean | True if card charges annual fee |
| annualFeeAmount | Decimal? | Fee amount if hasAnnualFee = true |
| rewardsProgram | Enum? | NONE \| CASH_BACK \| POINTS \| MILES \| TRAVEL_CREDIT |
| rewardsRate | Decimal? | Rate (e.g., 1.5% cash back, 2 points per $1) |
| rewardsRedeemedThisYear | Decimal? | Rewards value redeemed in current year |
| issuingBank | String? | Card issuer (e.g., "TD", "RBC", "Scotiabank") |
| cardType | Enum? | CREDIT \| CHARGE \| SECURED |
| verificationSource | Enum | INSTITUTION_STATEMENT \| USER_ENTERED \| SYNCED_FROM_ACCOUNT_AGGREGATOR |
| lastVerifiedAt | DateTime | Date metadata last confirmed |
| notes | String? | User notes (e.g., "Pending limit increase request") |
| createdAt | DateTime | Audit timestamp |
| updatedAt | DateTime | Audit timestamp |

**Constraints:**
- `creditLimit` > 0, `creditUtilization` 0-100
- `annualPercentageRate` >= 0
- `minimumPaymentDueDate` 1-31
- If `hasAnnualFee` = false, `annualFeeAmount` must be 0 or null (validation warning if fee > 0)
- `lastVerifiedAt` ≤ now()

---

## API Contract

### GET /api/accounts/:id (Enhanced)

**Description:** Fetch a single account with all metadata. If metadata exists, it is included; otherwise fields are null.

**Response Example:**

```json
{
  "id": "acct-001",
  "accountNumber": "****1234",
  "institution": "TD Bank",
  "accountType": "RRSP",
  "balance": 125000.00,
  "currency": "CAD",
  "lastSyncedAt": "2026-04-24T07:30:00Z",
  "loanDetails": null,
  "registeredDetails": {
    "id": "reg-001",
    "registrationType": "RRSP",
    "annualContributionLimit": 31560,
    "totalContributionRoom": 42000,
    "contributedThisYear": 6000,
    "unusedCarryforward": 36000,
    "verificationSource": "CRA_NOTICE_OF_ASSESSMENT",
    "lastVerifiedAt": "2026-03-15T00:00:00Z",
    "notes": "CRA NOA 2025 tax year",
    "createdAt": "2026-03-15T10:22:00Z",
    "updatedAt": "2026-04-10T14:50:00Z"
  },
  "creditCardDetails": null,
  "investmentDetails": null,
  "savingsDetails": null,
  "genericMetadata": null
}
```

---

### GET /api/accounts/:id/registered-details

**Description:** Fetch registered account metadata for a specific account.

**Response:**

```json
{
  "id": "reg-001",
  "accountId": "acct-001",
  "registrationType": "RRSP",
  "annualContributionLimit": 31560,
  "totalContributionRoom": 42000,
  "contributedThisYear": 6000,
  "unusedCarryforward": 36000,
  "beneficiaryName": null,
  "beneficiaryDateOfBirth": null,
  "grantRoomAvailable": null,
  "grantsReceived": null,
  "subscriptionLimit": null,
  "verificationSource": "CRA_NOTICE_OF_ASSESSMENT",
  "lastVerifiedAt": "2026-03-15T00:00:00Z",
  "notes": "CRA NOA 2025 tax year",
  "createdAt": "2026-03-15T10:22:00Z",
  "updatedAt": "2026-04-10T14:50:00Z",
  "staleness": {
    "isDaysOld": 40,
    "isStale": false,
    "warningMessage": null
  }
}
```

**Staleness Calculation:**
- If `lastVerifiedAt` > 365 days ago: `isStale: true`, `warningMessage: "Contribution room last verified 400 days ago. Please update from latest CRA Notice of Assessment."`
- Otherwise: `isStale: false`, `warningMessage: null`

**Error Codes:**
- `404` — Account not found
- `404` — Account has no registered details (not an error, return 404)

---

### PATCH /api/accounts/:id/registered-details

**Description:** Create or update registered account metadata.

**Request:**

```json
{
  "registrationType": "RRSP",
  "annualContributionLimit": 31560,
  "totalContributionRoom": 42000,
  "contributedThisYear": 6000,
  "unusedCarryforward": 36000,
  "verificationSource": "CRA_NOTICE_OF_ASSESSMENT",
  "lastVerifiedAt": "2026-03-15T00:00:00Z",
  "notes": "CRA NOA 2025 tax year"
}
```

**For RESP, add:**

```json
{
  "registrationType": "RESP",
  "beneficiaryName": "Emma Smith",
  "beneficiaryDateOfBirth": "2015-07-20",
  "annualContributionLimit": 2500,
  "totalContributionRoom": 5000,
  "grantRoomAvailable": 500,
  "grantsReceived": 1000,
  "verificationSource": "INSTITUTION_STATEMENT",
  "lastVerifiedAt": "2026-04-20T00:00:00Z"
}
```

**Response:** Updated object (same structure as GET)

**Validation Rules:**

| Rule | Error Message |
|------|---------------|
| `registrationType` required | "registrationType is required and must be one of: RRSP, TFSA, RESP, RIF, RDSP" |
| `contributedThisYear` + `unusedCarryforward` ≤ `totalContributionRoom` | "Contributed this year (6000) + unused carryforward (36000) exceeds total contribution room (40000)" |
| If `registrationType === RESP` and (`beneficiaryName` XOR `beneficiaryDateOfBirth`) provided | "RESP requires both beneficiaryName and beneficiaryDateOfBirth" |
| `verificationSource` in enum | "verificationSource must be one of: CRA_NOTICE_OF_ASSESSMENT, INSTITUTION_STATEMENT, USER_ENTERED, IMPORTED" |
| All currency fields >= 0 | "annualContributionLimit must be >= 0" |

**Confirmation Rules (from OpenClaw skill):**
- Agent must acknowledge room changes > $5,000 impact before updating
- Agent must verify beneficiary details for RESP changes
- If `verificationSource` = USER_ENTERED, agent must note "This data is unverified. Request CRA notice for accuracy."

---

### GET /api/accounts/:id/credit-card-details

**Description:** Fetch credit card metadata.

**Response:**

```json
{
  "id": "cc-001",
  "accountId": "acct-002",
  "creditLimit": 5000,
  "currentUtilization": 45.5,
  "annualPercentageRate": 19.99,
  "minimumPaymentDueDate": 21,
  "lastStatementBalance": 2275,
  "lastStatementDate": "2026-04-15",
  "hasAnnualFee": true,
  "annualFeeAmount": 139,
  "rewardsProgram": "CASH_BACK",
  "rewardsRate": 1.5,
  "rewardsRedeemedThisYear": 120,
  "issuingBank": "TD",
  "cardType": "CREDIT",
  "verificationSource": "INSTITUTION_STATEMENT",
  "lastVerifiedAt": "2026-04-15T00:00:00Z",
  "notes": "TD Infinite Card",
  "createdAt": "2026-04-15T12:00:00Z",
  "updatedAt": "2026-04-15T12:00:00Z",
  "utilization": {
    "isHigh": true,
    "warningMessage": "Credit utilization at 45.5%. Paying above 30% utilization may impact credit score."
  }
}
```

**Utilization Warning:**
- If `currentUtilization` > 30: `isHigh: true`, `warningMessage: "…"`
- Else: `isHigh: false`, `warningMessage: null`

**Error Codes:**
- `404` — Account not found or no credit card details

---

### PATCH /api/accounts/:id/credit-card-details

**Description:** Create or update credit card metadata.

**Request:**

```json
{
  "creditLimit": 5000,
  "currentUtilization": 45.5,
  "annualPercentageRate": 19.99,
  "minimumPaymentDueDate": 21,
  "lastStatementBalance": 2275,
  "lastStatementDate": "2026-04-15",
  "hasAnnualFee": true,
  "annualFeeAmount": 139,
  "rewardsProgram": "CASH_BACK",
  "rewardsRate": 1.5,
  "issuingBank": "TD",
  "cardType": "CREDIT",
  "verificationSource": "INSTITUTION_STATEMENT",
  "lastVerifiedAt": "2026-04-15T00:00:00Z",
  "notes": "TD Infinite Card"
}
```

**Response:** Updated object (same structure as GET)

**Validation Rules:**

| Rule | Error Message |
|------|---------------|
| `creditLimit` > 0 | "Credit limit must be > 0" |
| `currentUtilization` 0-100 | "Utilization must be between 0 and 100" |
| `annualPercentageRate` >= 0 | "APR must be >= 0" |
| `minimumPaymentDueDate` 1-31 | "Due date must be between 1 and 31" |
| If `hasAnnualFee` = false and `annualFeeAmount` > 0 | Warning: "Card marked no annual fee but annualFeeAmount is $X. Verify fee amount." |
| `verificationSource` in enum | "verificationSource must be one of: INSTITUTION_STATEMENT, USER_ENTERED, SYNCED_FROM_ACCOUNT_AGGREGATOR" |
| `rewardsProgram` in enum if provided | "rewardsProgram must be one of: NONE, CASH_BACK, POINTS, MILES, TRAVEL_CREDIT" |

**Confirmation Rules (from OpenClaw skill):**
- Agent must confirm APR changes > 5% before updating
- Agent must acknowledge limit reductions
- If `verificationSource` = USER_ENTERED, agent notes: "This data is unverified. Request statement for accuracy."

---

## Data Integrity & Sync Behavior

### SimpleFin Non-Destructiveness

When SimpleFin Bridge runs a sync:
1. **Balance Updated:** Account.balance ← SimpleFin live balance
2. **Transactions Synced:** New transactions added, deleted transactions removed
3. **Metadata Preserved:** AccountRegisteredDetails and AccountCreditCardDetails **unchanged**

**Why:** User-maintained data (RRSP room, credit card limit) persists independently of balance refreshes.

**Test Case (Critical):**

```typescript
// 1. Create account with RRSP metadata
const account = await db.account.create({
  data: {
    accountNumber: "RRSP123",
    balance: 50000,
    registeredDetails: {
      create: {
        registrationType: "RRSP",
        totalContributionRoom: 42000,
        verificationSource: "CRA_NOTICE_OF_ASSESSMENT"
      }
    }
  }
});

// 2. Simulate SimpleFin sync (balance updates)
await simplefinSync({ accountId: account.id });
// Backend: UPDATE Account SET balance = newBalance WHERE id = account.id

// 3. Verify metadata unchanged
const updated = await db.account.findUnique({ 
  where: { id: account.id },
  include: { registeredDetails: true }
});

assert.equal(updated.registeredDetails.totalContributionRoom, 42000, "Metadata must survive sync");
assert.equal(updated.balance, newBalance, "Balance must be updated");
```

### Cascade Delete Policy

If an Account is deleted:
- `ON DELETE CASCADE` → AccountLoanDetails, AccountRegisteredDetails, AccountCreditCardDetails all deleted
- Transactions remain (orphaned) for audit trail

---

## Agent Integration

### Updated Skill Requirements

The financial agent skill (workspaces/financial/skills/doughray/SKILL.md) is updated to teach agents:

1. **Mental Model Bullet Point:**
   > "Registered Account Details — RRSP, TFSA, RESP, RIF, RDSP contribution room (annual limit, carryforward, contributions YTD) and grant tracking. Fetched on-demand; freshness indicated by lastVerifiedAt and verificationSource."

2. **Credit Card Details Bullet Point:**
   > "Credit Card Details — limit, utilization, APR, rewards program, payment due date. Tracked per account; user updates when institution statement arrives."

3. **Endpoints Section:**
   - GET /api/accounts/:id/registered-details
   - PATCH /api/accounts/:id/registered-details
   - GET /api/accounts/:id/credit-card-details
   - PATCH /api/accounts/:id/credit-card-details
   - Examples with curl for each

4. **Workflow Examples in Skill:**

   **Workflow A: RRSP Maximization**
   ```
   User: "How much RRSP room do I have?"
   Agent:
   1. GET /api/accounts to list all RRSP accounts
   2. For each RRSP account, GET /api/accounts/:id/registered-details
   3. Calculate total room: sum(totalContributionRoom - contributedThisYear)
   4. Report: "You have $42,000 RRSP room across 2 accounts. Last verified [lastVerifiedAt]."
   5. If lastVerifiedAt > 365 days ago, recommend: "Request latest CRA Notice of Assessment for accuracy."
   ```

   **Workflow B: Credit Card Payoff Priority**
   ```
   User: "Which credit card should I pay off first?"
   Agent:
   1. GET /api/accounts to list all credit card accounts
   2. For each card, GET /api/accounts/:id/credit-card-details
   3. Calculate payoff priority:
      - Sort by utilization DESC (high utilization first)
      - Tiebreaker: APR DESC (highest rate next)
   4. Report: "Priority 1: [Card A] $2,275 at 45.5% utilization, 19.99% APR. Paying this first improves credit score."
   ```

   **Workflow C: RESP Grant Tracking**
   ```
   User: "How much RESP grant room do I have for Emma?"
   Agent:
   1. GET /api/accounts to find Emma's RESP (filter by RESP type + beneficiary)
   2. GET /api/accounts/:id/registered-details (registrationType = RESP)
   3. Report: "RESP for Emma: $500 grant room available, $1,000 grants received to date (lifetime limit $2,500)."
   4. If grants received < subscription limit: "You can deposit another $500 to capture this year's CESG grant."
   ```

5. **Confirmation Rules:**
   - RRSP room changes > $5,000: Agent must explain impact before updating
   - RESP beneficiary changes: Agent must confirm name and DOB match CRA records
   - Credit card limit increases: Agent acknowledges but does not recommend (user decision)
   - Credit card APR increases: Agent flags and recommends rate negotiation if > 20%

### Agent Capability Matrix

| Capability | Agent | Supported |
|-----------|-------|-----------|
| View RRSP room | Financial (Dot) | ✅ |
| Update RRSP room | Dot | ✅ (with freshness warning) |
| Calculate debt payoff priority | Dot | ✅ |
| Track RESP grants | Dot | ✅ |
| Recommend contribution strategies | Dot | ✅ (Phase 3: with savings goals) |

---

## Implementation Details

### Database Schema (Prisma)

```prisma
model AccountRegisteredDetails {
  id                       String   @id @default(cuid())
  accountId                String
  account                  Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  
  registrationType         String   // Enum: RRSP | TFSA | RESP | RIF | RDSP
  annualContributionLimit  Decimal
  totalContributionRoom    Decimal
  contributedThisYear      Decimal
  unusedCarryforward       Decimal
  
  // RESP-specific
  beneficiaryName          String?
  beneficiaryDateOfBirth   DateTime?
  grantRoomAvailable       Decimal?
  grantsReceived           Decimal?
  subscriptionLimit        Decimal?
  
  // Metadata
  verificationSource       String   // CRA_NOTICE_OF_ASSESSMENT | INSTITUTION_STATEMENT | USER_ENTERED | IMPORTED
  lastVerifiedAt           DateTime
  notes                    String?
  
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt
  
  @@unique([accountId]) // One registered detail per account
  @@index([registrationType])
  @@index([lastVerifiedAt])
}

model AccountCreditCardDetails {
  id                       String   @id @default(cuid())
  accountId                String   @unique
  account                  Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  
  creditLimit              Decimal
  currentUtilization       Decimal  // 0-100
  annualPercentageRate     Decimal
  minimumPaymentDueDate    Int      // 1-31
  lastStatementBalance     Decimal
  lastStatementDate        DateTime?
  
  hasAnnualFee             Boolean
  annualFeeAmount          Decimal?
  rewardsProgram           String?  // NONE | CASH_BACK | POINTS | MILES | TRAVEL_CREDIT
  rewardsRate              Decimal?
  rewardsRedeemedThisYear  Decimal?
  
  issuingBank              String?
  cardType                 String?  // CREDIT | CHARGE | SECURED
  
  // Metadata
  verificationSource       String   // INSTITUTION_STATEMENT | USER_ENTERED | SYNCED_FROM_ACCOUNT_AGGREGATOR
  lastVerifiedAt           DateTime
  notes                    String?
  
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt
  
  @@index([lastVerifiedAt])
  @@index([currentUtilization])
}

// Update Account model
model Account {
  // ... existing fields ...
  
  loanDetails              AccountLoanDetails?
  registeredDetails        AccountRegisteredDetails?
  creditCardDetails        AccountCreditCardDetails?
  
  // Future phases
  investmentDetails        AccountInvestmentDetails?
  savingsDetails           AccountSavingsDetails?
  genericMetadata          AccountGenericMetadata?
}
```

### Migration Script

```sql
-- Create AccountRegisteredDetails table
CREATE TABLE account_registered_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  registration_type VARCHAR(20) NOT NULL,
  annual_contribution_limit DECIMAL(15,2) NOT NULL,
  total_contribution_room DECIMAL(15,2) NOT NULL,
  contributed_this_year DECIMAL(15,2) NOT NULL,
  unused_carryforward DECIMAL(15,2) NOT NULL,
  beneficiary_name VARCHAR(255),
  beneficiary_date_of_birth DATE,
  grant_room_available DECIMAL(15,2),
  grants_received DECIMAL(15,2),
  subscription_limit DECIMAL(15,2),
  verification_source VARCHAR(50) NOT NULL DEFAULT 'USER_ENTERED',
  last_verified_at TIMESTAMP NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_registered_details_registration_type 
  ON account_registered_details(registration_type);
CREATE INDEX idx_registered_details_last_verified_at 
  ON account_registered_details(last_verified_at);

-- Create AccountCreditCardDetails table
CREATE TABLE account_credit_card_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  credit_limit DECIMAL(15,2) NOT NULL,
  current_utilization DECIMAL(5,2) NOT NULL,
  annual_percentage_rate DECIMAL(5,2) NOT NULL,
  minimum_payment_due_date INT NOT NULL,
  last_statement_balance DECIMAL(15,2),
  last_statement_date DATE,
  has_annual_fee BOOLEAN DEFAULT FALSE,
  annual_fee_amount DECIMAL(10,2),
  rewards_program VARCHAR(50),
  rewards_rate DECIMAL(5,3),
  rewards_redeemed_this_year DECIMAL(15,2),
  issuing_bank VARCHAR(255),
  card_type VARCHAR(20),
  verification_source VARCHAR(50) NOT NULL DEFAULT 'USER_ENTERED',
  last_verified_at TIMESTAMP NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_credit_card_details_last_verified_at 
  ON account_credit_card_details(last_verified_at);
CREATE INDEX idx_credit_card_details_current_utilization 
  ON account_credit_card_details(current_utilization);
```

### Service Layer (TypeScript)

```typescript
// services/registeredDetailsService.ts
import { prisma } from '../lib/prisma';
import { ValidationError, NotFoundError } from '../errors';

export const registeredDetailsService = {
  async getByAccountId(accountId: string) {
    const details = await prisma.accountRegisteredDetails.findUnique({
      where: { accountId }
    });
    if (!details) throw new NotFoundError('Registered details not found');
    return details;
  },

  async upsert(accountId: string, data: UpdateRegisteredDetailsInput) {
    // Validate contribution room consistency
    const { contributedThisYear, unusedCarryforward, totalContributionRoom } = data;
    
    if (contributedThisYear + unusedCarryforward > totalContributionRoom) {
      throw new ValidationError(
        `Contributed this year (${contributedThisYear}) + unused carryforward (${unusedCarryforward}) ` +
        `exceeds total contribution room (${totalContributionRoom})`
      );
    }

    // Validate RESP-specific fields
    if (data.registrationType === 'RESP') {
      const hasBeneficiaryName = data.beneficiaryName !== undefined && data.beneficiaryName !== null;
      const hasDOB = data.beneficiaryDateOfBirth !== undefined && data.beneficiaryDateOfBirth !== null;
      
      if (hasBeneficiaryName !== hasDOB) {
        throw new ValidationError('RESP requires both beneficiaryName and beneficiaryDateOfBirth');
      }
    }

    return await prisma.accountRegisteredDetails.upsert({
      where: { accountId },
      update: data,
      create: { accountId, ...data }
    });
  }
};

// services/creditCardDetailsService.ts
export const creditCardDetailsService = {
  async getByAccountId(accountId: string) {
    const details = await prisma.accountCreditCardDetails.findUnique({
      where: { accountId }
    });
    if (!details) throw new NotFoundError('Credit card details not found');
    return details;
  },

  async upsert(accountId: string, data: UpdateCreditCardDetailsInput) {
    // Validate utilization range
    if (data.currentUtilization < 0 || data.currentUtilization > 100) {
      throw new ValidationError('Utilization must be between 0 and 100');
    }

    // Warn if fee mismatch
    if (!data.hasAnnualFee && (data.annualFeeAmount ?? 0) > 0) {
      console.warn(
        `Card marked no annual fee but annualFeeAmount is $${data.annualFeeAmount}. Verify fee amount.`
      );
    }

    return await prisma.accountCreditCardDetails.upsert({
      where: { accountId },
      update: data,
      create: { accountId, ...data }
    });
  }
};
```

### Endpoint Implementations

```typescript
// routes/accounts.ts (excerpt)
router.get('/:id/registered-details', async (req, res) => {
  try {
    const details = await registeredDetailsService.getByAccountId(req.params.id);
    const staleness = calculateStaleness(details.lastVerifiedAt);
    res.json({ ...details, staleness });
  } catch (err) {
    if (err instanceof NotFoundError) res.status(404).json({ error: err.message });
    else res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id/registered-details', async (req, res) => {
  try {
    const details = await registeredDetailsService.upsert(req.params.id, req.body);
    res.json(details);
  } catch (err) {
    if (err instanceof ValidationError) res.status(400).json({ error: err.message });
    else res.status(500).json({ error: 'Server error' });
  }
});

// ... similar for credit card details ...
```

---

## Example Workflows

### Workflow 1: RRSP Maximization

**Setup:**
- User has 2 RRSP accounts: TD ($50k balance) and RBC ($75k balance)
- TD RRSP: $42k room, $6k contributed YTD
- RBC RRSP: $30k room, $0 contributed YTD

**User Message:** "How much RRSP room do I have left?"

**Agent Actions:**
1. `GET /api/accounts?type=RRSP` → Returns accounts [TD, RBC]
2. `GET /api/accounts/td-rrsp/registered-details` → Returns:
   - totalContributionRoom: 42000
   - contributedThisYear: 6000
   - Available this year: 36000
3. `GET /api/accounts/rbc-rrsp/registered-details` → Returns:
   - totalContributionRoom: 30000
   - contributedThisYear: 0
   - Available this year: 30000
4. **Agent Response:** 
   > "You have $66,000 total RRSP room across 2 accounts:
   > - TD RRSP: $36,000 available (contributed $6,000 of $42,000 this year)
   > - RBC RRSP: $30,000 available (not contributed yet)
   > 
   > Both accounts were last verified on March 15, 2026 via CRA Notice of Assessment. If your income changed significantly, request a new Notice of Assessment from CRA for accuracy."

**If Stale:**
- If `lastVerifiedAt` > 365 days ago:
  > "⚠️ RRSP room last verified on April 2024. Request latest CRA Notice of Assessment to confirm current room (new income, changes in deduction limit)."

---

### Workflow 2: Credit Card Payoff Priority

**Setup:**
- Card A: $5,000 limit, $2,275 balance (45.5%), 19.99% APR
- Card B: $2,000 limit, $1,200 balance (60%), 22.99% APR
- Card C: $10,000 limit, $2,000 balance (20%), 9.99% APR

**User Message:** "Which credit card should I pay off first?"

**Agent Actions:**
1. `GET /api/accounts?type=CREDIT_CARD` → Returns [A, B, C]
2. For each card: `GET /api/accounts/card-x/credit-card-details`
3. Calculate payoff priority:
   - Card B: 60% utilization, 22.99% APR → **Priority 1** (highest util, highest APR)
   - Card A: 45.5% utilization, 19.99% APR → **Priority 2**
   - Card C: 20% utilization, 9.99% APR → **Priority 3** (lowest util, lowest APR)

**Agent Response:**
> "Here's your credit card payoff priority:
> 
> **1. Card B** ($1,200 / $2,000 balance, 60% utilization)
>    - APR: 22.99% (highest rate)
>    - Pay this first to reduce utilization and save on interest
>    - Paying off will free up $2,000 and improve your credit score
> 
> **2. Card A** ($2,275 / $5,000 balance, 45.5% utilization)
>    - APR: 19.99%
>    - Paying this next continues credit score recovery
> 
> **3. Card C** ($2,000 / $10,000 balance, 20% utilization)
>    - APR: 9.99% (lowest rate)
>    - Pay when others are cleared or if rate decreases
> 
> Recommended: Allocate $500/month to B (paid in 3 months), then $400/month to A."

---

### Workflow 3: RESP Grant Tracking

**Setup:**
- Emma's RESP account: $5,000 balance
- RESP Details:
  - annualContributionLimit: $2,500
  - totalContributionRoom: $5,000
  - contributedThisYear: $2,000
  - grantRoomAvailable: $500
  - grantsReceived: $1,000
  - subscriptionLimit: $2,500

**User Message:** "How much can I deposit into Emma's RESP this year?"

**Agent Actions:**
1. `GET /api/accounts?type=RESP&beneficiary=Emma` → Returns Emma's RESP account
2. `GET /api/accounts/emma-resp/registered-details` → Returns details above
3. Calculate grant optimization:
   - Room remaining this year: $2,500 - $2,000 = $500
   - Grant available: $500 (20% match on $2,500)
   - Recommended deposit to maximize grant: $500
   - Total available deposits before grant limit: $2,500 (subscription limit / lifetime)

**Agent Response:**
> "Emma's RESP Summary:
> 
> **This Year:**
> - You've contributed $2,000 of $2,500 annual limit
> - Grant room available: $500
> - **Action:** Deposit $500 to capture the full annual CESG grant (20% match = $100)
> 
> **Lifetime:**
> - Total grants received to date: $1,000
> - Lifetime subscription limit: $2,500
> - You have room for $1,500 more in lifetime grants
> 
> **Recommendation:** Contribute $500 this month to maximize Emma's CESG grant this year."

---

## Testing Strategy

### Unit Tests

**Validation Layer:**
```typescript
describe('registeredDetailsService', () => {
  it('throws ValidationError if contribution room exceeded', async () => {
    const data = {
      registrationType: 'RRSP',
      totalContributionRoom: 40000,
      contributedThisYear: 25000,
      unusedCarryforward: 20000 // Total: 45000 > 40000
    };
    expect(() => registeredDetailsService.validate(data))
      .toThrow('Contributed this year + unused carryforward exceeds total contribution room');
  });

  it('throws ValidationError if RESP missing beneficiary', async () => {
    const data = {
      registrationType: 'RESP',
      beneficiaryName: 'Emma',
      beneficiaryDateOfBirth: null // Missing DOB
    };
    expect(() => registeredDetailsService.validate(data))
      .toThrow('RESP requires both beneficiaryName and beneficiaryDateOfBirth');
  });
});

describe('creditCardDetailsService', () => {
  it('throws ValidationError if utilization > 100', async () => {
    const data = { currentUtilization: 105 };
    expect(() => creditCardDetailsService.validate(data))
      .toThrow('Utilization must be between 0 and 100');
  });

  it('warns if fee mismatch', async () => {
    const data = { hasAnnualFee: false, annualFeeAmount: 50 };
    const warn = jest.spyOn(console, 'warn');
    creditCardDetailsService.validate(data);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('fee mismatch'));
  });
});
```

### Integration Tests

**SimpleFin Sync Non-Destructiveness:**
```typescript
describe('SimpleFin Sync – Non-Destructiveness', () => {
  it('preserves registered details after balance sync', async () => {
    // 1. Create account with registered details
    const account = await db.account.create({
      data: {
        accountNumber: 'RRSP-123',
        balance: 50000,
        registeredDetails: {
          create: {
            registrationType: 'RRSP',
            totalContributionRoom: 42000,
            verificationSource: 'CRA_NOTICE_OF_ASSESSMENT'
          }
        }
      }
    });

    const originalDetails = await db.accountRegisteredDetails.findUnique({
      where: { accountId: account.id }
    });

    // 2. Simulate SimpleFin sync
    await simplefinSync({ accountId: account.id });

    // 3. Verify details unchanged
    const updatedDetails = await db.accountRegisteredDetails.findUnique({
      where: { accountId: account.id }
    });
    
    expect(updatedDetails.totalContributionRoom)
      .toBe(originalDetails.totalContributionRoom);
  });

  it('preserves credit card details across sync', async () => {
    // Same pattern as above for credit card
  });
});
```

**API Response Shape:**
```typescript
describe('GET /api/accounts/:id', () => {
  it('includes registered details when present', async () => {
    const response = await request(app).get('/api/accounts/acct-001');
    expect(response.body).toHaveProperty('registeredDetails');
    expect(response.body.registeredDetails).toMatchObject({
      id: expect.any(String),
      registrationType: 'RRSP',
      totalContributionRoom: expect.any(Number)
    });
  });

  it('returns null for missing metadata', async () => {
    const response = await request(app).get('/api/accounts/acct-002');
    expect(response.body.registeredDetails).toBeNull();
    expect(response.body.creditCardDetails).toBeNull();
  });
});
```

### End-to-End Tests (Agent Integration)

```typescript
describe('Agent Workflows – E2E', () => {
  it('RRSP maximization workflow succeeds', async () => {
    // Set up 2 RRSP accounts with room
    // Run agent query: "How much RRSP room?"
    // Assert: Agent response includes room calculations, freshness warning if stale
  });

  it('Credit card payoff priority sorted correctly', async () => {
    // Set up 3 cards with different utilization/APR
    // Run agent query: "Which card to pay off?"
    // Assert: Priority order matches utilization DESC, then APR DESC
  });

  it('RESP grant tracking calculates grant room', async () => {
    // Set up RESP with 20% grant available
    // Run agent query: "How much can I contribute?"
    // Assert: Agent recommends contribution amount to maximize grant
  });
});
```

---

## Acceptance Criteria

- [ ] Database schema (AccountRegisteredDetails, AccountCreditCardDetails) created and migrated
- [ ] Validation rules implemented and tested (contribution room, RESP beneficiary, credit utilization)
- [ ] API endpoints (GET/PATCH registered-details, GET/PATCH credit-card-details) operational
- [ ] SimpleFin sync test passes: metadata survives balance updates
- [ ] Enhanced GET /api/accounts/:id response includes all metadata fields (null if absent)
- [ ] Staleness calculation correct (isStale: true if lastVerifiedAt > 365 days)
- [ ] Error codes correct (400 validation, 404 not found)
- [ ] Confirmation rules enforced: room changes, beneficiary changes require agent acknowledgment
- [ ] Financial agent skill updated with registered/credit card mental models
- [ ] Skill includes endpoint documentation with curl examples
- [ ] Skill includes 3 workflow examples (RRSP room, payoff priority, RESP grants)
- [ ] Unit tests pass (80%+ coverage on validation logic)
- [ ] Integration tests pass (SimpleFin sync, API responses)
- [ ] E2E tests pass (agent workflows)
- [ ] API documentation updated (OpenAPI/Swagger)
- [ ] Code review completed and approved
- [ ] Staging deployment tested
- [ ] Production deployment and rollback plan documented
- [ ] Monitoring/alerts configured for new tables
- [ ] Support runbook updated (how to verify data freshness, handle stale contribution room)
- [ ] Phase 1 loan details in production without issues
- [ ] No data loss or corruption during migration
- [ ] Performance tests pass (query latency < 100ms for account lookup with all metadata)
- [ ] Backward compatibility: old API clients ignore new metadata fields
- [ ] Rate limiting applied to metadata update endpoints
- [ ] New permissions/RBAC rules applied (only account owner can update metadata)

---

## Effort Estimate

| Component | Hours | Notes |
|-----------|-------|-------|
| Database schema + migrations | 2 | Prisma models, SQL migration, index design |
| Service layer (validation, business logic) | 4 | registeredDetailsService, creditCardDetailsService, staleness calculations |
| API endpoints (4 routes) | 3 | GET/PATCH registered-details, GET/PATCH credit-card-details, error handling |
| Comprehensive testing (unit, integration, E2E) | 5 | Validation tests, SimpleFin non-destructiveness, agent workflows |
| OpenClaw skill update | 2 | Mental models, endpoint docs, 3 workflow examples, confirmation rules |
| API documentation (OpenAPI) | 1 | Endpoint specs, request/response shapes, error codes |
| Code review + refinement | 2 | Peer review, feedback incorporation |
| Staging deployment + testing | 1 | Deploy to staging environment, smoke tests |
| Production deployment + monitoring | 1 | Deploy, alerts, runbook updates |
| **Total** | **~21 hours** | Assumes Phase 1 already completed and tested |

---

## Phase 2 Rollout Plan

**Week 1:** Development (database, service layer, endpoints)  
**Week 2:** Testing (unit, integration, E2E) + agent skill updates  
**Week 3:** Documentation + code review  
**Week 4:** Staging + production deployment

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|-----------|
| Data freshness—stale CRA room leads to incorrect tax recommendations | High | Medium | Implement lastVerifiedAt tracking with 365-day staleness warning; agent skill requires freshness confirmation |
| SimpleFin sync accidentally overwrites user metadata | High | Low | Explicit test: sync updates balance, metadata unchanged. Code review focus on sync logic. |
| RESP validation too strict (beneficiary requirements) | Medium | Low | Test with real RESP data; gather user feedback in staging |
| Credit card utilization calculation inaccuracy | Medium | Medium | Mock calculation tests; compare against institution statement samples |
| Performance regression on account fetch with all metadata | Medium | Low | Index lastVerifiedAt, currentUtilization; benchmark queries before merge |

---

## Future Phases (Phase 3+)

### Phase 3: Investment & Savings Goals
- AccountInvestmentDetails (asset allocation, holdings, performance)
- AccountSavingsDetails (goals, target date, monthly contribution)
- Goal-based recommendations ("Rebalance portfolio to 60/40", "On track for retirement")

### Phase 4: Insurance & Catch-All
- AccountInsuranceDetails (policy type, coverage amount, beneficiary)
- AccountGenericMetadata (JSON fallback for undefined types)

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Product Manager | — | TBD | — |
| Engineering Lead | — | TBD | — |
| QA Lead | — | TBD | — |

---

**Document Version:** 1.0  
**Last Updated:** April 24, 2026  
**Next Review:** After Phase 2 implementation
