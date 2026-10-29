# PRD: CODE_SMELL / BLOCKER Sonar Findings

## Problem
This cluster contains **2** open Sonar findings of type **CODE_SMELL** and severity **BLOCKER**.

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
| `typescript:S2699` | `code/api/src/routes/routes.integration.test.ts` | 657 | Add at least one assertion to this test case. |
| `typescript:S2699` | `code/api/src/routes/routes.integration.test.ts` | 668 | Add at least one assertion to this test case. |

## Proposed Remediation
1. Fix highest-churn files first to reduce repeated edits.
2. Address rule-level patterns with shared helpers where possible.
3. Re-scan and close this cluster before moving on.
