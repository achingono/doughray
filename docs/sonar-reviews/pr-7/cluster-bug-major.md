# PRD: BUG / MAJOR Sonar Findings

## Problem
This cluster contains **1** open Sonar findings of type **BUG** and severity **MAJOR**.

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
| `typescript:S3923` | `code/spa/src/components/layout/CustomCursor.tsx` | 102 | This conditional operation returns the same value whether the condition is "true" or "false". |

## Proposed Remediation
1. Fix highest-churn files first to reduce repeated edits.
2. Address rule-level patterns with shared helpers where possible.
3. Re-scan and close this cluster before moving on.
