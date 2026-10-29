# PRD: CODE_SMELL / CRITICAL Sonar Findings

## Problem
This cluster contains **5** open Sonar findings of type **CODE_SMELL** and severity **CRITICAL**.

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
| `typescript:S3776` | `code/api/src/services/account.service.ts` | 366 | Refactor this function to reduce its Cognitive Complexity from 16 to the 15 allowed. |
| `typescript:S3776` | `code/api/src/services/budget.service.ts` | 65 | Refactor this function to reduce its Cognitive Complexity from 21 to the 15 allowed. |
| `typescript:S3776` | `code/spa/src/components/holdings/AccountDetail.tsx` | 72 | Refactor this function to reduce its Cognitive Complexity from 53 to the 15 allowed. |
| `typescript:S3776` | `code/api/src/services/account.service.ts` | 438 | Refactor this function to reduce its Cognitive Complexity from 21 to the 15 allowed. |
| `typescript:S3776` | `code/api/src/services/account.service.ts` | 547 | Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed. |

## Proposed Remediation
1. Fix highest-churn files first to reduce repeated edits.
2. Address rule-level patterns with shared helpers where possible.
3. Re-scan and close this cluster before moving on.
