# Requirement — Doughray Loan Details Support

> Requirement drafted from transcript evidence that Doughray currently tracks mortgage balance but does not store loan metadata needed for amortization and renewal planning.

---
owner: financial
last_updated: 2026-04-23
sources: []
confidence: HIGH
related: [[./debt.md]], [[./budget.md]], [[./goals.md]]
---

## Context

In session `f2cf01f9-3902-4187-b2e9-d9af97899cd3` (2026-04-21), a subagent attempted to update mortgage details (rate, term, payment, amortization) in Doughray and concluded:

- mortgage account exists and balance is correct
- Doughray currently does not expose/stores mortgage-specific metadata fields
- only principal balance is usable in current schema/API

This creates an operational gap: debt strategy and renewal planning require metadata beyond balance.

## Problem Statement

Doughray can represent loan balances but cannot natively persist or expose core loan attributes (interest type/rate, payment cadence, term dates, amortization), forcing users/agents to keep critical loan data outside Doughray.

## Requirement

Implement first-class **loan details** support in Doughray for liability accounts (especially `MORTGAGE`, but extensible to other loan types).

### Functional Scope

1. Store loan metadata on account records (or linked loan-details entity):
- `loanType` (MORTGAGE, AUTO_LOAN, PERSONAL_LOAN, HELOC, OTHER)
- `originalPrincipal`
- `currentPrincipal` (may mirror account balance absolute value)
- `interestType` (FIXED, VARIABLE)
- `interestRateAnnual`
- `paymentAmount`
- `paymentFrequency` (WEEKLY, BIWEEKLY, SEMI_MONTHLY, MONTHLY)
- `termStartDate`
- `termMaturityDate`
- `originalAmortizationMonths`
- `remainingAmortizationMonths`
- `renewalDate` (optional, if different from maturity semantics)
- `notes` (optional free text)
- `lastVerifiedAt`
- `source` (USER_ENTERED, IMPORTED, SYNCED)

2. API support:
- Read: include loan details in `GET /api/accounts/<id>`
- Write: add loan-details create/update endpoint(s) or extend account patch safely
- Validate semantic consistency (e.g., maturity >= start, rate non-negative)
- Return explicit validation errors per field

3. UX/agent support:
- Expose these fields in Doughray UI account detail page for liability accounts
- Show a clear "last verified" marker
- Keep balance-sync behavior unchanged for SimpleFin-linked accounts
- Do not overwrite user-entered loan metadata during sync unless explicit mapping exists

4. Backward compatibility:
- Existing accounts continue to work without loan-details payload
- Existing API consumers remain unaffected when loan details are absent

### Non-Functional Requirements

- Data integrity: enforce typed enums and date/range constraints
- Auditability: retain `updatedAt/updatedBy` for loan detail changes
- Security/privacy: treat loan metadata as sensitive personal finance data
- Performance: account list endpoint should not materially regress (avoid heavy joins by default if needed)

## Out of Scope (Phase 1)

- Full amortization schedule generation
- Automatic lender statement ingestion/OCR
- Automatic rate refresh from external providers
- Payment forecasting dashboards beyond core metadata display

## Acceptance Criteria

1. A mortgage account can persist all required metadata fields listed above.
2. `GET /api/accounts/<id>` returns loan details when present.
3. Loan details can be created/updated through supported API endpoint(s).
4. Validation rejects invalid values with field-specific errors.
5. SimpleFin sync does not remove or corrupt user-entered loan metadata.
6. Debt workflows can display: current principal, rate, payment cadence, term dates, remaining amortization, and renewal date.
7. Existing accounts without loan details remain readable and functional.

## Example Use Case (from discovered gap)

For TD mortgage data captured manually:
- current principal: 538830.46
- original principal: 559000.00
- payment: 1631.86
- frequency: SEMI_MONTHLY
- rate: 5.05 FIXED
- term: 2024-08-01 to 2027-08-01
- original amortization: 300 months
- remaining amortization: 279 months (23y 3m)

System should store and return these values without relying on external notes.

## Implementation Notes

- Preferred model: `account_loan_details` table keyed 1:1 to `accounts.id` for liability accounts.
- Consider nullable fields to support partial capture and progressive enrichment.
- Add migration + API contract tests + integration test proving sync non-destructive behavior.

## Update History

- 2026-04-23: Initial requirement drafted from Apr-21 session evidence (session id `f2cf01f9-3902-4187-b2e9-d9af97899cd3`) where Doughray was confirmed to lack storable loan metadata fields.
