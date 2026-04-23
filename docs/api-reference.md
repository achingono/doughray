# Doughray API Reference

Complete REST API reference for the Doughray financial dashboard backend.

## Base URL

```
http://localhost:3000/api
```

When running behind the SPA reverse proxy:

```
http://localhost/api
```

---

## Response Format

### Successful Responses

Single-resource endpoints return:

```json
{
  "data": { ... }
}
```

Collection endpoints with pagination return:

```json
{
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 243,
    "totalPages": 5
  }
}
```

### Error Responses

All errors follow this shape:

```json
{
  "error": {
    "message": "Human-readable error description",
    "code": "ERROR_CODE"
  }
}
```

Validation errors include additional detail:

```json
{
  "error": {
    "message": "Validation error",
    "code": "VALIDATION_ERROR",
    "details": [
      {
        "code": "invalid_type",
        "expected": "string",
        "received": "undefined",
        "path": ["categoryId"],
        "message": "Required"
      }
    ]
  }
}
```

### Common Error Codes

| HTTP Status | Code               | Description                          |
| ----------- | ------------------ | ------------------------------------ |
| 400         | `VALIDATION_ERROR` | Request body or query params invalid |
| 404         | `NOT_FOUND`        | Requested resource does not exist    |
| 500         | `INTERNAL_ERROR`   | Unexpected server error              |

---

## Endpoints

### 1. Health

#### `GET /api/health`

Returns the API server health status.

**Query Parameters:** None

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2025-01-15T09:30:00.000Z"
}
```

**curl Example:**

```bash
curl http://localhost:3000/api/health
```

---

### 2. Dashboard

#### `GET /api/dashboard/summary`

Returns an overview of net worth, total assets, total liabilities, and current-month income/expense figures.

**Query Parameters:** None

**Response:**

```json
{
  "data": {
    "netWorth": 84750.43,
    "totalAssets": 97200.00,
    "totalLiabilities": 12449.57,
    "monthlyIncome": 6500.00,
    "monthlyExpenses": 4120.35,
    "monthlyNet": 2379.65
  }
}
```

**curl Example:**

```bash
curl http://localhost:3000/api/dashboard/summary
```

---

#### `GET /api/dashboard/trends`

Returns net-worth trend data points over a configurable number of months. Data is sourced from `NetWorthSnapshot` records when available, otherwise generated from transaction history.

**Query Parameters:**

| Parameter   | Type   | Default | Description                                          |
| ----------- | ------ | ------- | ---------------------------------------------------- |
| `period`    | number | `6`     | Number of months of history to return                 |
| `accountId` | string | —       | Optional account ID to scope the trend to one account |

**Response:**

```json
{
  "data": [
    { "date": "2024-08-01", "value": 72100.00 },
    { "date": "2024-09-01", "value": 74500.50 },
    { "date": "2024-10-01", "value": 76800.25 },
    { "date": "2024-11-01", "value": 79350.00 },
    { "date": "2024-12-01", "value": 82000.10 },
    { "date": "2025-01-01", "value": 84750.43 }
  ]
}
```

**curl Example:**

```bash
curl "http://localhost:3000/api/dashboard/trends?period=12"
curl "http://localhost:3000/api/dashboard/trends?period=3&accountId=clxyz123abc"
```

---

#### `GET /api/dashboard/spending-by-category`

Returns spending totals grouped by category for the given date range. Only negative-amount (expense) transactions are included. Results are sorted by total descending.

**Query Parameters:**

| Parameter   | Type   | Default            | Description                        |
| ----------- | ------ | ------------------ | ---------------------------------- |
| `startDate` | string | —                  | ISO 8601 date (`YYYY-MM-DD`) start |
| `endDate`   | string | —                  | ISO 8601 date (`YYYY-MM-DD`) end   |

**Response:**

```json
{
  "data": [
    {
      "category": { "id": "clx001", "name": "Groceries", "icon": "ShoppingCart", "color": "green" },
      "total": 845.20
    },
    {
      "category": { "id": "clx002", "name": "Dining Out", "icon": "Utensils", "color": "orange" },
      "total": 312.50
    },
    {
      "category": { "id": null, "name": "Uncategorized", "icon": "HelpCircle", "color": "gray" },
      "total": 54.99
    }
  ]
}
```

**curl Example:**

```bash
curl "http://localhost:3000/api/dashboard/spending-by-category?startDate=2025-01-01&endDate=2025-01-31"
```

---

### 3. Accounts

#### `GET /api/accounts`

Returns all active accounts ordered by type then name.

**Query Parameters:** None

**Response:**

```json
{
  "data": [
    {
      "id": "clxabc001",
      "name": "Primary Checking",
      "institution": "Chase",
      "type": "CHECKING",
      "currency": "USD",
      "balance": 5432.10,
      "availableBalance": 5400.00,
      "balanceDate": "2025-01-15T00:00:00.000Z",
      "transactionCount": 142
    },
    {
      "id": "clxabc002",
      "name": "High-Yield Savings",
      "institution": "Marcus by Goldman Sachs",
      "type": "SAVINGS",
      "currency": "USD",
      "balance": 28500.00,
      "availableBalance": null,
      "balanceDate": "2025-01-15T00:00:00.000Z",
      "transactionCount": 12
    },
    {
      "id": "clxabc003",
      "name": "Visa Platinum",
      "institution": "Capital One",
      "type": "CREDIT_CARD",
      "currency": "USD",
      "balance": -1249.57,
      "availableBalance": -1249.57,
      "balanceDate": "2025-01-14T00:00:00.000Z",
      "transactionCount": 67
    }
  ]
}
```

**curl Example:**

```bash
curl http://localhost:3000/api/accounts
```

---

#### `GET /api/accounts/:id`

Returns a single account by ID, including the 20 most recent transactions.

**Path Parameters:**

| Parameter | Type   | Description |
| --------- | ------ | ----------- |
| `id`      | string | Account ID  |

**Response:**

```json
{
  "data": {
    "id": "clxabc001",
    "externalId": "ext-chase-checking-001",
    "name": "Primary Checking",
    "institution": "Chase",
    "institutionDomain": "chase.com",
    "type": "CHECKING",
    "currency": "USD",
    "balance": 5432.10,
    "availableBalance": 5400.00,
    "balanceDate": "2025-01-15T00:00:00.000Z",
    "isActive": true,
    "loanDetails": {
      "loanType": "MORTGAGE",
      "originalPrincipal": 559000.00,
      "currentPrincipal": 538830.46,
      "interestType": "FIXED",
      "interestRateAnnual": 5.05,
      "paymentAmount": 1631.86,
      "paymentFrequency": "SEMI_MONTHLY",
      "termStartDate": "2024-08-01T00:00:00.000Z",
      "termMaturityDate": "2027-08-01T00:00:00.000Z",
      "originalAmortizationMonths": 300,
      "remainingAmortizationMonths": 279,
      "renewalDate": "2027-08-01T00:00:00.000Z",
      "notes": "Primary residence mortgage",
      "lastVerifiedAt": "2026-04-20T00:00:00.000Z",
      "source": "USER_ENTERED",
      "updatedBy": "system",
      "createdAt": "2026-04-14T00:00:00.000Z",
      "updatedAt": "2026-04-20T00:00:00.000Z"
    },
    "transactionCount": 142,
    "recentTransactions": [
      {
        "id": "cltx001",
        "posted": "2025-01-14T00:00:00.000Z",
        "amount": -85.32,
        "description": "WHOLEFDS MKT #10432",
        "payee": "Whole Foods Market",
        "category": { "id": "clx001", "name": "Groceries", "icon": "ShoppingCart", "color": "green" }
      },
      {
        "id": "cltx002",
        "posted": "2025-01-13T00:00:00.000Z",
        "amount": 3250.00,
        "description": "DIRECT DEPOSIT - ACME CORP",
        "payee": "Acme Corp",
        "category": { "id": "clx010", "name": "Income", "icon": "DollarSign", "color": "emerald" }
      }
    ]
  }
}
```

**Error Responses:**

| Status | Code        | Condition              |
| ------ | ----------- | ---------------------- |
| 404    | `NOT_FOUND` | Account ID not found   |

**curl Example:**

```bash
curl http://localhost:3000/api/accounts/clxabc001
```

---

#### `PATCH /api/accounts/:id/balance`

Updates the stored account balance snapshot so holdings and net worth can be reconciled to institution-reported balances after an import.

**Path Parameters:**

| Parameter | Type   | Description |
| --------- | ------ | ----------- |
| `id`      | string | Account ID  |

**Request Body:**

| Field              | Type                 | Required | Description                         |
| ------------------ | -------------------- | -------- | ----------------------------------- |
| `balance`          | number               | Yes      | Current account balance             |
| `availableBalance` | number or `null`     | No       | Optional available balance override |
| `balanceDate`      | ISO 8601 date string | No       | Optional effective balance date     |

**Request Example:**

```json
{
  "balance": 12854.77,
  "availableBalance": 12854.77,
  "balanceDate": "2026-04-13"
}
```

**Response:**

```json
{
  "data": {
    "id": "clxabc001",
    "externalId": "ext-chase-checking-001",
    "name": "Primary Checking",
    "institution": "Chase",
    "institutionDomain": "chase.com",
    "type": "CHECKING",
    "currency": "USD",
    "balance": 12854.77,
    "availableBalance": 12854.77,
    "balanceDate": "2026-04-13T00:00:00.000Z",
    "isActive": true,
    "transactionCount": 142,
    "recentTransactions": []
  }
}
```

**Error Responses:**

| Status | Code               | Condition                  |
| ------ | ------------------ | -------------------------- |
| 400    | `VALIDATION_ERROR` | Invalid numeric/date input |
| 404    | `NOT_FOUND`        | Account ID not found       |

**curl Example:**

```bash
curl -X PATCH http://localhost:3000/api/accounts/clxabc001/balance \
  -H 'Content-Type: application/json' \
  -d '{"balance":12854.77,"availableBalance":12854.77,"balanceDate":"2026-04-13"}'
```

---

#### `PATCH /api/accounts/:id/loan-details`

Creates or updates loan metadata for a liability account (`CREDIT_CARD`, `LOAN`, `MORTGAGE`). Existing account balances and transaction history are unaffected.

**Path Parameters:**

| Parameter | Type   | Description |
| --------- | ------ | ----------- |
| `id`      | string | Account ID  |

**Request Body:**

| Field                         | Type                                                | Required | Description |
| ----------------------------- | --------------------------------------------------- | -------- | ----------- |
| `loanType`                    | `MORTGAGE` \| `AUTO_LOAN` \| `PERSONAL_LOAN` \| `HELOC` \| `OTHER` | Yes | Loan classification |
| `originalPrincipal`           | number or `null`                                    | No | Original principal amount |
| `currentPrincipal`            | number or `null`                                    | No | Current principal amount |
| `interestType`                | `FIXED` \| `VARIABLE` \| `null`                     | No | Interest type |
| `interestRateAnnual`          | number or `null`                                    | No | Annual rate percentage (non-negative) |
| `paymentAmount`               | number or `null`                                    | No | Scheduled payment amount |
| `paymentFrequency`            | `WEEKLY` \| `BIWEEKLY` \| `SEMI_MONTHLY` \| `MONTHLY` \| `null` | No | Payment cadence |
| `termStartDate`               | ISO 8601 date string or `null`                      | No | Loan term start date |
| `termMaturityDate`            | ISO 8601 date string or `null`                      | No | Loan term maturity date (must be on/after term start) |
| `originalAmortizationMonths`  | integer or `null`                                   | No | Original amortization in months |
| `remainingAmortizationMonths` | integer or `null`                                   | No | Remaining amortization in months (cannot exceed original) |
| `renewalDate`                 | ISO 8601 date string or `null`                      | No | Optional renewal date |
| `notes`                       | string or `null`                                    | No | Optional notes |
| `lastVerifiedAt`              | ISO 8601 date string or `null`                      | No | Last metadata verification timestamp |
| `source`                      | `USER_ENTERED` \| `IMPORTED` \| `SYNCED`            | No | Metadata source (defaults to `USER_ENTERED`) |

**Request Example:**

```json
{
  "loanType": "MORTGAGE",
  "originalPrincipal": 559000,
  "currentPrincipal": 538830.46,
  "interestType": "FIXED",
  "interestRateAnnual": 5.05,
  "paymentAmount": 1631.86,
  "paymentFrequency": "SEMI_MONTHLY",
  "termStartDate": "2024-08-01T00:00:00.000Z",
  "termMaturityDate": "2027-08-01T00:00:00.000Z",
  "originalAmortizationMonths": 300,
  "remainingAmortizationMonths": 279,
  "renewalDate": "2027-08-01T00:00:00.000Z",
  "lastVerifiedAt": "2026-04-20T00:00:00.000Z",
  "source": "USER_ENTERED"
}
```

**Response:**

Returns the same shape as `GET /api/accounts/:id`, including `loanDetails`.

**Error Responses:**

| Status | Code               | Condition |
| ------ | ------------------ | --------- |
| 400    | `VALIDATION_ERROR` | Invalid field value, invalid enum, invalid date relationship, or non-liability account |
| 404    | `NOT_FOUND`        | Account ID not found |

**curl Example:**

```bash
curl -X PATCH http://localhost:3000/api/accounts/clxabc001/loan-details \
  -H 'Content-Type: application/json' \
  -d '{"loanType":"MORTGAGE","interestType":"FIXED","interestRateAnnual":5.05,"source":"USER_ENTERED"}'
```

---

### 4. Transactions

#### `GET /api/transactions`

Returns a paginated, filterable list of transactions ordered by posted date descending. Supports full-text search across description, payee, and memo fields.

**Query Parameters:**

| Parameter   | Type   | Default | Description                                                  |
| ----------- | ------ | ------- | ------------------------------------------------------------ |
| `page`      | number | `1`     | Page number (1-indexed)                                      |
| `limit`     | number | `50`    | Results per page                                             |
| `accountId` | string | —       | Filter to a specific account                                 |
| `categoryId`| string | —       | Filter to a specific category                                |
| `startDate` | string | —       | ISO 8601 date — include transactions on or after this date   |
| `endDate`   | string | —       | ISO 8601 date — include transactions on or before this date  |
| `search`    | string | —       | Case-insensitive search across description, payee, and memo  |

**Response:**

```json
{
  "data": [
    {
      "id": "cltx001",
      "posted": "2025-01-14T00:00:00.000Z",
      "amount": -85.32,
      "description": "WHOLEFDS MKT #10432",
      "payee": "Whole Foods Market",
      "memo": null,
      "isReviewed": true,
      "account": { "id": "clxabc001", "name": "Primary Checking", "institution": "Chase" },
      "category": { "id": "clx001", "name": "Groceries", "icon": "ShoppingCart", "color": "green" }
    },
    {
      "id": "cltx002",
      "posted": "2025-01-13T00:00:00.000Z",
      "amount": -42.00,
      "description": "NETFLIX.COM",
      "payee": "Netflix",
      "memo": "Monthly subscription",
      "isReviewed": false,
      "account": { "id": "clxabc003", "name": "Visa Platinum", "institution": "Capital One" },
      "category": { "id": "clx005", "name": "Entertainment", "icon": "Film", "color": "purple" }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 243,
    "totalPages": 5
  }
}
```

**curl Examples:**

```bash
# Basic paginated list
curl "http://localhost:3000/api/transactions?page=1&limit=20"

# Filter by account and date range
curl "http://localhost:3000/api/transactions?accountId=clxabc001&startDate=2025-01-01&endDate=2025-01-31"

# Full-text search
curl "http://localhost:3000/api/transactions?search=whole+foods"

# Combined filters
curl "http://localhost:3000/api/transactions?categoryId=clx001&startDate=2025-01-01&limit=10"
```

---

#### `POST /api/transactions/import`

Imports transactions from an uploaded institution export file. Supports `CSV`, `OFX`, `QFX`, and `XLSX`.

The endpoint de-duplicates transactions (both within the uploaded file and against existing account transactions), writes only new rows, and triggers transaction categorization for newly imported records. Excel activity exports can include multiple accounts in a single workbook; when no manual destination account is provided, the API will split rows by account metadata and create or reuse accounts automatically.

**Request Content Type:** `multipart/form-data`

**Form Fields:**

| Field            | Type   | Required | Description |
| ---------------- | ------ | -------- | ----------- |
| `file`           | file   | Yes      | Upload file (`.csv`, `.ofx`, `.qfx`, `.xlsx`) |
| `accountId`      | string | Conditionally | Existing account ID to import into. If provided, no new account is created. |
| `accountName`    | string | Conditionally | Used to create a new account when `accountId` is omitted. Not required for Excel multi-account imports that include account metadata. |
| `institution`    | string | No       | New account institution (new account flow only). |
| `currency`       | string | No       | New account currency (e.g., `USD`) (new account flow only). |
| `accountType`    | string | No       | New account type (`CHECKING`, `SAVINGS`, `CREDIT_CARD`, `INVESTMENT`, `LOAN`, `MORTGAGE`, `OTHER`). |
| `accountBalance` | number | No       | Starting balance for the new account. |
| `format`         | string | No       | Explicit format override: `csv`, `ofx`, `qfx`, or `xlsx`. If omitted, format is detected from file extension. |

**Response:**

```json
{
  "data": {
    "format": "csv",
    "parsedCount": 120,
    "importedCount": 87,
    "skippedCount": 33,
    "account": {
      "id": "clxacc123",
      "name": "Primary Checking",
      "created": false
    },
    "accounts": [
      {
        "id": "clxacc123",
        "name": "Primary Checking",
        "created": false
      }
    ],
    "categorizationTriggered": true
  }
}
```

**Error Responses:**

| Status | Code               | Condition |
| ------ | ------------------ | --------- |
| 400    | `VALIDATION_ERROR` | Missing/invalid form fields, missing file, unsupported format, or no account destination information |
| 404    | `NOT_FOUND`        | `accountId` does not match an existing account |

**curl Examples:**

```bash
# Import to an existing account
curl -X POST http://localhost:3000/api/transactions/import \
  -F "accountId=clxacc123" \
  -F "file=@./statement.ofx"

# Import and create a new account
curl -X POST http://localhost:3000/api/transactions/import \
  -F "accountName=Imported Checking" \
  -F "institution=My Bank" \
  -F "currency=USD" \
  -F "accountType=CHECKING" \
  -F "file=@./transactions.csv"

# Import a multi-account Excel activity export and let the API map accounts from the file
curl -X POST http://localhost:3000/api/transactions/import \
  -F "file=@./Activities_for_01Jan2020_to_13Apr2026.xlsx"
```

---

#### `PATCH /api/transactions/:id`

Updates the category of a single transaction and marks it as reviewed.

**Path Parameters:**

| Parameter | Type   | Description    |
| --------- | ------ | -------------- |
| `id`      | string | Transaction ID |

**Request Body:**

```json
{
  "categoryId": "clx001"
}
```

| Field        | Type   | Required | Description                    |
| ------------ | ------ | -------- | ------------------------------ |
| `categoryId` | string | Yes      | ID of the category to assign   |

**Response:**

```json
{
  "data": {
    "id": "cltx001",
    "externalId": "ext-txn-001",
    "accountId": "clxabc001",
    "posted": "2025-01-14T00:00:00.000Z",
    "amount": "-85.32",
    "description": "WHOLEFDS MKT #10432",
    "payee": "Whole Foods Market",
    "memo": null,
    "categoryId": "clx001",
    "isReviewed": true,
    "createdAt": "2025-01-14T12:00:00.000Z",
    "updatedAt": "2025-01-15T09:30:00.000Z",
    "category": { "id": "clx001", "name": "Groceries", "icon": "ShoppingCart", "color": "green" }
  }
}
```

**Error Responses:**

| Status | Code               | Condition                  |
| ------ | ------------------ | -------------------------- |
| 400    | `VALIDATION_ERROR` | `categoryId` not provided  |

**curl Example:**

```bash
curl -X PATCH http://localhost:3000/api/transactions/cltx001 \
  -H "Content-Type: application/json" \
  -d '{"categoryId": "clx001"}'
```

---

### 5. Holdings

#### `GET /api/holdings`

Returns a portfolio overview with total assets, total liabilities, net worth, and a list of all active accounts with balance details.

**Query Parameters:** None

**Response:**

```json
{
  "data": {
    "totalAssets": 97200.00,
    "totalLiabilities": 12449.57,
    "netWorth": 84750.43,
    "accounts": [
      {
        "id": "clxabc001",
        "name": "Primary Checking",
        "institution": "Chase",
        "type": "CHECKING",
        "currency": "USD",
        "balance": 5432.10,
        "availableBalance": 5400.00,
        "balanceDate": "2025-01-15T00:00:00.000Z",
        "transactionCount": 142
      },
      {
        "id": "clxabc002",
        "name": "High-Yield Savings",
        "institution": "Marcus by Goldman Sachs",
        "type": "SAVINGS",
        "currency": "USD",
        "balance": 28500.00,
        "availableBalance": null,
        "balanceDate": "2025-01-15T00:00:00.000Z",
        "transactionCount": 12
      },
      {
        "id": "clxabc004",
        "name": "Brokerage Account",
        "institution": "Fidelity",
        "type": "INVESTMENT",
        "currency": "USD",
        "balance": 63267.90,
        "availableBalance": null,
        "balanceDate": "2025-01-15T00:00:00.000Z",
        "transactionCount": 35
      },
      {
        "id": "clxabc003",
        "name": "Visa Platinum",
        "institution": "Capital One",
        "type": "CREDIT_CARD",
        "currency": "USD",
        "balance": -1249.57,
        "availableBalance": -1249.57,
        "balanceDate": "2025-01-14T00:00:00.000Z",
        "transactionCount": 67
      },
      {
        "id": "clxabc005",
        "name": "Auto Loan",
        "institution": "Wells Fargo",
        "type": "LOAN",
        "currency": "USD",
        "balance": -11200.00,
        "availableBalance": null,
        "balanceDate": "2025-01-01T00:00:00.000Z",
        "transactionCount": 6
      }
    ]
  }
}
```

**Asset types:** `CHECKING`, `SAVINGS`, `INVESTMENT`, `OTHER`
**Liability types:** `CREDIT_CARD`, `LOAN`, `MORTGAGE`

**curl Example:**

```bash
curl http://localhost:3000/api/holdings
```

---

#### `GET /api/holdings/history`

Returns historical net-worth data points from `NetWorthSnapshot` records.

**Query Parameters:**

| Parameter | Type   | Default | Description                                   |
| --------- | ------ | ------- | --------------------------------------------- |
| `period`  | number | `12`    | Number of months of history to return          |

**Response:**

```json
{
  "data": [
    { "date": "2024-02-01", "value": 58200.00 },
    { "date": "2024-03-01", "value": 60150.75 },
    { "date": "2024-04-01", "value": 62300.00 },
    { "date": "2024-05-01", "value": 65800.50 },
    { "date": "2024-06-01", "value": 68100.00 },
    { "date": "2024-07-01", "value": 70500.25 },
    { "date": "2024-08-01", "value": 72100.00 },
    { "date": "2024-09-01", "value": 74500.50 },
    { "date": "2024-10-01", "value": 76800.25 },
    { "date": "2024-11-01", "value": 79350.00 },
    { "date": "2024-12-01", "value": 82000.10 },
    { "date": "2025-01-01", "value": 84750.43 }
  ]
}
```

**curl Example:**

```bash
curl "http://localhost:3000/api/holdings/history?period=6"
```

---

### 6. Budgets

#### `GET /api/budgets`

Returns all budgets with current-month spending progress. Spending is calculated from negative-amount transactions in the current calendar month matching each budget's category.

**Query Parameters:** None

**Response:**

```json
{
  "data": [
    {
      "id": "clbgt001",
      "categoryId": "clx002",
      "categoryName": "Dining Out",
      "categoryIcon": "Utensils",
      "categoryColor": "orange",
      "amount": 400.00,
      "spent": 312.50,
      "remaining": 87.50,
      "percentUsed": 78.125,
      "period": "MONTHLY",
      "startDate": "2025-01-01T00:00:00.000Z",
      "endDate": null
    },
    {
      "id": "clbgt002",
      "categoryId": "clx001",
      "categoryName": "Groceries",
      "categoryIcon": "ShoppingCart",
      "categoryColor": "green",
      "amount": 800.00,
      "spent": 645.20,
      "remaining": 154.80,
      "percentUsed": 80.65,
      "period": "MONTHLY",
      "startDate": "2025-01-01T00:00:00.000Z",
      "endDate": null
    }
  ]
}
```

**curl Example:**

```bash
curl http://localhost:3000/api/budgets
```

---

#### `POST /api/budgets`

Creates a new budget for a category.

**Request Body:**

```json
{
  "categoryId": "clx005",
  "amount": 150.00,
  "period": "MONTHLY",
  "startDate": "2025-02-01",
  "endDate": "2025-12-31"
}
```

| Field        | Type   | Required | Default     | Description                                          |
| ------------ | ------ | -------- | ----------- | ---------------------------------------------------- |
| `categoryId` | string | Yes      | —           | ID of the category this budget covers                |
| `amount`     | number | Yes      | —           | Budget limit amount                                  |
| `period`     | string | No       | `"MONTHLY"` | One of `WEEKLY`, `MONTHLY`, `QUARTERLY`, `YEARLY`    |
| `startDate`  | string | No       | now         | ISO 8601 date for when the budget takes effect       |
| `endDate`    | string | No       | —           | ISO 8601 date for when the budget expires (optional) |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "clbgt003",
    "categoryId": "clx005",
    "amount": "150",
    "period": "MONTHLY",
    "startDate": "2025-02-01T00:00:00.000Z",
    "endDate": "2025-12-31T00:00:00.000Z",
    "createdAt": "2025-01-15T09:30:00.000Z",
    "updatedAt": "2025-01-15T09:30:00.000Z",
    "category": {
      "id": "clx005",
      "name": "Entertainment",
      "icon": "Film",
      "color": "purple",
      "parentId": null,
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  }
}
```

**Error Responses:**

| Status | Code               | Condition                              |
| ------ | ------------------ | -------------------------------------- |
| 400    | `VALIDATION_ERROR` | `categoryId` or `amount` not provided  |

**curl Example:**

```bash
curl -X POST http://localhost:3000/api/budgets \
  -H "Content-Type: application/json" \
  -d '{"categoryId": "clx005", "amount": 150, "period": "MONTHLY", "startDate": "2025-02-01"}'
```

---

#### `PUT /api/budgets/:id`

Updates an existing budget. Only the provided fields are changed.

**Path Parameters:**

| Parameter | Type   | Description |
| --------- | ------ | ----------- |
| `id`      | string | Budget ID   |

**Request Body:**

```json
{
  "amount": 500.00,
  "period": "MONTHLY",
  "endDate": "2025-06-30"
}
```

| Field     | Type   | Required | Description                                       |
| --------- | ------ | -------- | ------------------------------------------------- |
| `amount`  | number | No       | Updated budget limit                              |
| `period`  | string | No       | One of `WEEKLY`, `MONTHLY`, `QUARTERLY`, `YEARLY` |
| `endDate` | string | No       | Updated end date (ISO 8601)                       |

**Response:**

```json
{
  "data": {
    "id": "clbgt001",
    "categoryId": "clx002",
    "amount": "500",
    "period": "MONTHLY",
    "startDate": "2025-01-01T00:00:00.000Z",
    "endDate": "2025-06-30T00:00:00.000Z",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-15T10:00:00.000Z",
    "category": {
      "id": "clx002",
      "name": "Dining Out",
      "icon": "Utensils",
      "color": "orange",
      "parentId": null,
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  }
}
```

**curl Example:**

```bash
curl -X PUT http://localhost:3000/api/budgets/clbgt001 \
  -H "Content-Type: application/json" \
  -d '{"amount": 500, "endDate": "2025-06-30"}'
```

---

#### `DELETE /api/budgets/:id`

Deletes a budget.

**Path Parameters:**

| Parameter | Type   | Description |
| --------- | ------ | ----------- |
| `id`      | string | Budget ID   |

**Response:** `204 No Content` (empty body)

**curl Example:**

```bash
curl -X DELETE http://localhost:3000/api/budgets/clbgt001
```

---

### 7. Categories

#### `GET /api/categories`

Returns all categories as a tree. Top-level categories (those with no parent) are returned with their `children` nested.

**Query Parameters:** None

**Response:**

```json
{
  "data": [
    {
      "id": "clx002",
      "name": "Dining Out",
      "icon": "Utensils",
      "color": "orange",
      "parentId": null,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "children": []
    },
    {
      "id": "clx005",
      "name": "Entertainment",
      "icon": "Film",
      "color": "purple",
      "parentId": null,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "children": [
        {
          "id": "clx005a",
          "name": "Streaming Services",
          "icon": "Tv",
          "color": "purple",
          "parentId": "clx005",
          "createdAt": "2025-01-01T00:00:00.000Z"
        },
        {
          "id": "clx005b",
          "name": "Movies & Shows",
          "icon": "Film",
          "color": "purple",
          "parentId": "clx005",
          "createdAt": "2025-01-01T00:00:00.000Z"
        }
      ]
    },
    {
      "id": "clx001",
      "name": "Groceries",
      "icon": "ShoppingCart",
      "color": "green",
      "parentId": null,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "children": []
    },
    {
      "id": "clx010",
      "name": "Income",
      "icon": "DollarSign",
      "color": "emerald",
      "parentId": null,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "children": [
        {
          "id": "clx010a",
          "name": "Salary",
          "icon": "Briefcase",
          "color": "emerald",
          "parentId": "clx010",
          "createdAt": "2025-01-01T00:00:00.000Z"
        }
      ]
    }
  ]
}
```

**curl Example:**

```bash
curl http://localhost:3000/api/categories
```

---

#### `POST /api/categories`

Creates a new category. Optionally nest it under a parent.

**Request Body:**

```json
{
  "name": "Home Improvement",
  "icon": "Hammer",
  "color": "yellow",
  "parentId": "clx020"
}
```

| Field      | Type   | Required | Description                                   |
| ---------- | ------ | -------- | --------------------------------------------- |
| `name`     | string | Yes      | Unique category name                          |
| `icon`     | string | No       | Icon identifier (e.g. Lucide icon name)       |
| `color`    | string | No       | Color identifier for UI rendering             |
| `parentId` | string | No       | ID of the parent category to nest under       |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "clx021",
    "name": "Home Improvement",
    "icon": "Hammer",
    "color": "yellow",
    "parentId": "clx020",
    "createdAt": "2025-01-15T09:30:00.000Z"
  }
}
```

**curl Example:**

```bash
curl -X POST http://localhost:3000/api/categories \
  -H "Content-Type: application/json" \
  -d '{"name": "Home Improvement", "icon": "Hammer", "color": "yellow"}'
```

---

### 8. Reports

#### `GET /api/reports`

Returns a paginated list of generated reports ordered by generation date descending.

**Query Parameters:**

| Parameter | Type   | Default | Description             |
| --------- | ------ | ------- | ----------------------- |
| `page`    | number | `1`     | Page number (1-indexed) |
| `limit`   | number | `10`    | Results per page        |

**Response:**

```json
{
  "data": [
    {
      "id": "clrpt001",
      "title": "January 2025 Monthly Summary",
      "type": "MONTHLY_SUMMARY",
      "content": {
        "totalIncome": 6500.00,
        "totalExpenses": 4120.35,
        "netSavings": 2379.65,
        "topCategories": ["Groceries", "Dining Out", "Transportation"]
      },
      "period": "2025-01",
      "generatedAt": "2025-02-01T00:00:00.000Z"
    },
    {
      "id": "clrpt002",
      "title": "Q4 2024 Spending Analysis",
      "type": "SPENDING_ANALYSIS",
      "content": {
        "totalSpent": 12450.00,
        "categoryBreakdown": {}
      },
      "period": "2024-Q4",
      "generatedAt": "2025-01-02T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 14,
    "totalPages": 2
  }
}
```

Report types: `MONTHLY_SUMMARY`, `SPENDING_ANALYSIS`, `NET_WORTH_TREND`, `BUDGET_REVIEW`

**curl Example:**

```bash
curl "http://localhost:3000/api/reports?page=1&limit=5"
```

---

#### `GET /api/reports/:id`

Returns a single report by ID.

**Path Parameters:**

| Parameter | Type   | Description |
| --------- | ------ | ----------- |
| `id`      | string | Report ID   |

**Response:**

```json
{
  "data": {
    "id": "clrpt001",
    "title": "January 2025 Monthly Summary",
    "type": "MONTHLY_SUMMARY",
    "content": {
      "totalIncome": 6500.00,
      "totalExpenses": 4120.35,
      "netSavings": 2379.65,
      "topCategories": ["Groceries", "Dining Out", "Transportation"]
    },
    "period": "2025-01",
    "generatedAt": "2025-02-01T00:00:00.000Z"
  }
}
```

**Error Responses:**

| Status | Code        | Condition            |
| ------ | ----------- | -------------------- |
| 404    | `NOT_FOUND` | Report ID not found  |

**curl Example:**

```bash
curl http://localhost:3000/api/reports/clrpt001
```

---

### 9. Sync

#### `GET /api/sync/status`

Returns the most recent sync log entry.

**Query Parameters:** None

**Response:**

```json
{
  "data": {
    "id": "clsync001",
    "status": "SUCCESS",
    "accountCount": 5,
    "transactionCount": 47,
    "errorMessage": null,
    "startedAt": "2025-01-15T08:00:00.000Z",
    "completedAt": "2025-01-15T08:00:12.000Z"
  }
}
```

Sync statuses: `RUNNING`, `SUCCESS`, `FAILED`

When the last sync failed:

```json
{
  "data": {
    "id": "clsync002",
    "status": "FAILED",
    "accountCount": 0,
    "transactionCount": 0,
    "errorMessage": "Connection to data provider timed out",
    "startedAt": "2025-01-15T12:00:00.000Z",
    "completedAt": "2025-01-15T12:00:30.000Z"
  }
}
```

**curl Example:**

```bash
curl http://localhost:3000/api/sync/status
```

---

#### `GET /api/sync/history`

Returns recent sync log entries ordered by start time descending.

**Query Parameters:**

| Parameter | Type   | Default | Description                        |
| --------- | ------ | ------- | ---------------------------------- |
| `limit`   | number | `10`    | Maximum number of entries to return |

**Response:**

```json
{
  "data": [
    {
      "id": "clsync001",
      "status": "SUCCESS",
      "accountCount": 5,
      "transactionCount": 47,
      "errorMessage": null,
      "startedAt": "2025-01-15T08:00:00.000Z",
      "completedAt": "2025-01-15T08:00:12.000Z"
    },
    {
      "id": "clsync000",
      "status": "SUCCESS",
      "accountCount": 5,
      "transactionCount": 23,
      "errorMessage": null,
      "startedAt": "2025-01-14T08:00:00.000Z",
      "completedAt": "2025-01-14T08:00:09.000Z"
    }
  ]
}
```

**curl Example:**

```bash
curl "http://localhost:3000/api/sync/history?limit=5"
```

---

#### `POST /api/sync/trigger`

Triggers a new data sync. In production this would enqueue a job via a message queue or call the sync worker directly.

**Request Body:** None

**Response:**

```json
{
  "data": {
    "message": "Sync triggered",
    "status": "queued"
  }
}
```

**curl Example:**

```bash
curl -X POST http://localhost:3000/api/sync/trigger
```

---

## Data Types Reference

### Account Types

| Value         | Classification | Description              |
| ------------- | -------------- | ------------------------ |
| `CHECKING`    | Asset          | Checking account         |
| `SAVINGS`     | Asset          | Savings account          |
| `INVESTMENT`  | Asset          | Investment / brokerage   |
| `OTHER`       | Asset          | Other asset account      |
| `CREDIT_CARD` | Liability      | Credit card              |
| `LOAN`        | Liability      | Personal / auto loan     |
| `MORTGAGE`    | Liability      | Mortgage                 |

### Budget Periods

`WEEKLY` · `MONTHLY` · `QUARTERLY` · `YEARLY`

### Report Types

`MONTHLY_SUMMARY` · `SPENDING_ANALYSIS` · `NET_WORTH_TREND` · `BUDGET_REVIEW`

### Sync Statuses

`RUNNING` · `SUCCESS` · `FAILED`

---

## Endpoint Summary

| Method   | Path                                  | Description                        |
| -------- | ------------------------------------- | ---------------------------------- |
| `GET`    | `/api/health`                         | Health check                       |
| `GET`    | `/api/dashboard/summary`              | Financial overview                 |
| `GET`    | `/api/dashboard/trends`               | Net-worth trend data               |
| `GET`    | `/api/dashboard/spending-by-category` | Spending grouped by category       |
| `GET`    | `/api/accounts`                       | List all active accounts           |
| `GET`    | `/api/accounts/:id`                   | Get account with recent txns       |
| `PATCH`  | `/api/accounts/:id/balance`           | Update account balance snapshot    |
| `PATCH`  | `/api/accounts/:id/loan-details`      | Create/update loan metadata        |
| `GET`    | `/api/transactions`                   | List transactions (paginated)      |
| `POST`   | `/api/transactions/import`            | Import transactions from file      |
| `PATCH`  | `/api/transactions/:id`               | Update transaction category        |
| `GET`    | `/api/holdings`                       | Portfolio overview                 |
| `GET`    | `/api/holdings/history`               | Historical net-worth snapshots     |
| `GET`    | `/api/budgets`                        | List budgets with spending progress|
| `POST`   | `/api/budgets`                        | Create a budget                    |
| `PUT`    | `/api/budgets/:id`                    | Update a budget                    |
| `DELETE` | `/api/budgets/:id`                    | Delete a budget                    |
| `GET`    | `/api/categories`                     | List categories (tree)             |
| `POST`   | `/api/categories`                     | Create a category                  |
| `GET`    | `/api/reports`                        | List reports (paginated)           |
| `GET`    | `/api/reports/:id`                    | Get a single report                |
| `GET`    | `/api/sync/status`                    | Latest sync status                 |
| `GET`    | `/api/sync/history`                   | Sync history                       |
| `POST`   | `/api/sync/trigger`                   | Trigger a new sync                 |
