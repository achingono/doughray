# PRD: CODE_SMELL / MINOR Sonar Findings

## Problem
This cluster contains **37** open Sonar findings of type **CODE_SMELL** and severity **MINOR**.

## Goal
Eliminate all findings in this cluster while preserving existing behavior.

## Scope
- In scope: files and rules listed below.
- Out of scope: unrelated refactors.

## Acceptance Criteria
1. All issues in this cluster are resolved in SonarQube.
2. Workspace build passes.
3. No regression in API, SPA, or worker behavior.

## Findings

| Rule | File | Line | Message |
|------|------|------|---------|
| `typescript:S7764` | `code/spa/src/components/layout/SmoothScroll.tsx` | 6 | Prefer `globalThis` over `window`. |
| `typescript:S1128` | `code/api/src/routes/category-rules.ts` | 4 | Remove this unused import of 'AppError'. |
| `typescript:S4325` | `code/api/src/routes/loan-transactions.ts` | 44 | This assertion is unnecessary since it does not change the type of the expression. |
| `typescript:S4325` | `code/api/src/routes/loan-transactions.ts` | 61 | This assertion is unnecessary since it does not change the type of the expression. |
| `typescript:S7773` | `code/api/src/services/budget.service.ts` | 87 | Prefer `Number.parseInt` over `parseInt`. |
| `typescript:S7773` | `code/api/src/services/budget.service.ts` | 88 | Prefer `Number.isNaN` over `isNaN`. |
| `typescript:S7735` | `code/api/src/services/loan-transaction.service.ts` | 156 | Unexpected negated condition. |
| `typescript:S7735` | `code/api/src/services/loan-transaction.service.ts` | 157 | Unexpected negated condition. |
| `typescript:S7735` | `code/spa/src/components/holdings/AccountDetail.tsx` | 537 | Unexpected negated condition. |
| `typescript:S7764` | `code/spa/src/components/layout/CustomCursor.tsx` | 7 | Prefer `globalThis` over `window`. |
| `typescript:S7764` | `code/spa/src/components/layout/CustomCursor.tsx` | 14 | Prefer `globalThis` over `window`. |
| `typescript:S7764` | `code/spa/src/components/layout/CustomCursor.tsx` | 38 | Prefer `globalThis` over `window`. |
| `typescript:S7764` | `code/spa/src/components/layout/CustomCursor.tsx` | 49 | Prefer `globalThis` over `window`. |
| `typescript:S7764` | `code/spa/src/components/layout/CustomCursor.tsx` | 50 | Prefer `globalThis` over `window`. |
| `typescript:S7764` | `code/spa/src/components/layout/CustomCursor.tsx` | 51 | Prefer `globalThis` over `window`. |
| `typescript:S7764` | `code/spa/src/components/layout/CustomCursor.tsx` | 52 | Prefer `globalThis` over `window`. |
| `typescript:S7764` | `code/spa/src/components/layout/CustomCursor.tsx` | 55 | Prefer `globalThis` over `window`. |
| `typescript:S7764` | `code/spa/src/components/layout/CustomCursor.tsx` | 56 | Prefer `globalThis` over `window`. |
| `typescript:S7764` | `code/spa/src/components/layout/CustomCursor.tsx` | 57 | Prefer `globalThis` over `window`. |
| `typescript:S7764` | `code/spa/src/components/layout/CustomCursor.tsx` | 58 | Prefer `globalThis` over `window`. |
| `typescript:S6759` | `code/spa/src/components/layout/SmoothScroll.tsx` | 4 | Mark the props of the component as read-only. |
| `typescript:S6606` | `code/api/src/services/account.service.ts` | 496 | Prefer using nullish coalescing operator (`??`) instead of a ternary expression, as it is simpler to read. |
| `typescript:S6606` | `code/api/src/services/account.service.ts` | 497 | Prefer using nullish coalescing operator (`??`) instead of a ternary expression, as it is simpler to read. |
| `typescript:S6606` | `code/api/src/services/account.service.ts` | 498 | Prefer using nullish coalescing operator (`??`) instead of a ternary expression, as it is simpler to read. |
| `typescript:S6606` | `code/api/src/services/account.service.ts` | 499 | Prefer using nullish coalescing operator (`??`) instead of a ternary expression, as it is simpler to read. |
| `typescript:S6606` | `code/api/src/services/account.service.ts` | 505 | Prefer using nullish coalescing operator (`??`) instead of a ternary expression, as it is simpler to read. |
| `typescript:S6606` | `code/api/src/services/account.service.ts` | 586 | Prefer using nullish coalescing operator (`??`) instead of a ternary expression, as it is simpler to read. |
| `typescript:S6606` | `code/api/src/services/account.service.ts` | 588 | Prefer using nullish coalescing operator (`??`) instead of a ternary expression, as it is simpler to read. |
| `typescript:S6606` | `code/api/src/services/account.service.ts` | 595 | Prefer using nullish coalescing operator (`??`) instead of a ternary expression, as it is simpler to read. |
| `typescript:S7773` | `code/spa/src/components/holdings/AccountDetail.tsx` | 68 | Prefer `Number.parseInt` over `parseInt`. |
| `typescript:S7735` | `code/spa/src/components/holdings/AccountDetail.tsx` | 470 | Unexpected negated condition. |
| `typescript:S7764` | `code/spa/src/pages/ReportsPage.tsx` | 307 | Prefer `globalThis` over `window`. |
| `typescript:S4325` | `code/api/src/routes/transactions.ts` | 83 | This assertion is unnecessary since it does not change the type of the expression. |
| `typescript:S4325` | `code/spa/src/components/budgets/BudgetForm.tsx` | 129 | This assertion is unnecessary since it does not change the type of the expression. |
| `typescript:S4325` | `code/spa/src/components/ui/chart.tsx` | 344 | This assertion is unnecessary since the receiver accepts the original type of the expression. |
| `typescript:S4325` | `code/spa/src/components/ui/chart.tsx` | 350 | This assertion is unnecessary since the receiver accepts the original type of the expression. |
| `typescript:S4325` | `code/api/src/routes/transactions.ts` | 65 | This assertion is unnecessary since it does not change the type of the expression. |

## Proposed Remediation
1. Fix highest-churn files first to reduce repeated edits.
2. Address rule-level patterns with shared helpers where possible.
3. Re-scan and close this cluster before moving on.
