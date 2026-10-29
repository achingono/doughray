# PRD: CODE_SMELL / MAJOR Sonar Findings

## Problem
This cluster contains **11** open Sonar findings of type **CODE_SMELL** and severity **MAJOR**.

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
| `typescript:S6582` | `code/api/src/services/loan-transaction.service.ts` | 288 | Prefer using an optional chain expression instead, as it's more concise and easier to read. |
| `typescript:S3358` | `code/spa/src/components/holdings/AccountDetail.tsx` | 823 | Extract this nested ternary operation into an independent statement. |
| `typescript:S3358` | `code/spa/src/components/layout/CustomCursor.tsx` | 101 | Extract this nested ternary operation into an independent statement. |
| `typescript:S3358` | `code/spa/src/components/layout/CustomCursor.tsx` | 102 | Extract this nested ternary operation into an independent statement. |
| `typescript:S6564` | `code/spa/src/types/index.ts` | 1 | Remove this redundant type alias and replace its occurrences with "string". |
| `typescript:S6582` | `code/api/src/services/account.service.ts` | 427 | Prefer using an optional chain expression instead, as it's more concise and easier to read. |
| `typescript:S6582` | `code/api/src/services/account.service.ts` | 536 | Prefer using an optional chain expression instead, as it's more concise and easier to read. |
| `typescript:S4624` | `code/spa/src/components/holdings/AccountDetail.tsx` | 470 | Refactor this code to not use nested template literals. |
| `typescript:S3358` | `code/spa/src/components/holdings/AccountDetail.tsx` | 470 | Extract this nested ternary operation into an independent statement. |
| `typescript:S3358` | `code/spa/src/components/holdings/AccountDetail.tsx` | 474 | Extract this nested ternary operation into an independent statement. |
| `typescript:S4624` | `code/spa/src/components/holdings/AccountDetail.tsx` | 474 | Refactor this code to not use nested template literals. |

## Proposed Remediation
1. Fix highest-churn files first to reduce repeated edits.
2. Address rule-level patterns with shared helpers where possible.
3. Re-scan and close this cluster before moving on.
