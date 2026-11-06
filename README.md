# PayAgent Concierge

### Shop through a conversation. Compare real offers. Pay with confidence.

PayAgent Concierge is an AI-powered shopping and checkout assistant.
Customers describe what they need in natural language, explore product
results, compare merchant offers, select a specific listing and continue
to PayPal Checkout. The AI assists with shopping, but the customer
remains in control of payment approval.

**Hackathon build:** PayPal Sandbox · Groq AI · Channel3 product
intelligence · Supabase audit and order ledger · AG Grid · Bryntum
Scheduler

-   **Live application:** https://payagent-concierge.vercel.app
-   **Source repository:**
    https://github.com/princegyan/payagent-concierge
-   **Demo video:** Add the public YouTube URL here (under 3 minutes).

------------------------------------------------------------------------

## The problem

Online shopping is fragmented. Customers translate ideas into search
terms, visit multiple stores, compare listings that may not represent
the same product, verify offer availability and complete checkout
separately. This takes time and can lead to comparing unlike products or
relying on stale prices.

## Our solution

PayAgent Concierge brings product discovery, comparison and payment
preparation into one conversational interface. Customers can refine
requests with a budget, preferred merchant or required features. Before
checkout, the server re-queries Channel3 to verify the selected product
and merchant offer, then creates a PayPal order using the verified
amount.

**The AI assists with shopping; the customer remains in control of
payment approval.**

## Features and functionality

### Conversational AI shopping

-   Uses Groq (`openai/gpt-oss-120b`) to interpret natural-language
    product requests.
-   Supports follow-up instructions and shopping constraints.
-   Converts shopping intent into structured search criteria.

### Product discovery and merchant comparison

-   Searches Channel3 for structured product, image, feature, variant
    and merchant-offer data.
-   Supports budget, merchant, required-feature and price-sort
    constraints.
-   Only describes offers as the same-product comparison when Channel3
    returns a shared canonical product ID.

### Offer re-verification and PayPal Checkout

-   Re-queries Channel3 immediately before creating a PayPal order.
-   Derives the checkout amount from the freshly verified offer on the
    server, not from a client-submitted price.
-   Creates PayPal Orders API orders in the Sandbox environment.
-   Sends the customer to PayPal to review and approve the transaction.
-   Captures an approved order through a server-side endpoint.
-   Current checkout scope is USD only; the application does not
    silently convert currencies.

### Audit, order ledger and admin dashboard

-   Persists commerce activity, order records and PayPal webhook event
    records in Supabase.
-   Provides protected admin endpoints using a Bearer token.
-   Displays dashboard summaries and recent orders, activity and webhook
    records.
-   Supports date-range filters.
-   Admin views are read-only operational interfaces.

### AG Grid --- interactive Orders table

The admin **Orders** view uses **AG Grid Community**
(`ag-grid-community` and `ag-grid-react`) to make payment records easier
to inspect.

-   Sortable columns.
-   Column filtering and floating filters.
-   Quick search across displayed order data.
-   Pagination with page sizes of 10, 20 or 50 rows.
-   Stable row identity for consistent grid updates.

AG Grid is used as a functional operational data table, not as a static
visual. It gives administrators practical tools to find and inspect
order records.

### Bryntum Scheduler --- Payment Timeline

The admin **Payment Timeline** view uses **Bryntum Scheduler Community**
(`@bryntum/scheduler-community` and
`@bryntum/scheduler-react-community`) to visualise recorded payment
operations over time.

-   Brings together PayPal order records, agent activity events and
    PayPal webhook events.
-   Uses recorded timestamps.
-   Associates activity and webhook events with an order only when an
    exact PayPal order ID match is available.
-   Keeps events that cannot be reliably matched in separate groups.
-   Remains read-only and does not invent event durations or change
    payment state.

This gives administrators a chronological view of payment operations
alongside the tabular Orders view.

### Current payment environment

The current implementation is configured for **PayPal Sandbox** and
**USD checkout**. Sandbox transactions are for demonstration and
testing, not real-money settlement.

------------------------------------------------------------------------

## How it works

``` mermaid
flowchart TD
    A[Customer describes shopping need] --> B[Next.js chat API]
    B --> C[Groq intent parsing]
    C --> D[Channel3 product search]
    D --> E[Filter and compare structured offers]
    E --> F[Customer selects product and merchant]
    F --> G[Server re-verifies selected offer]
    G --> H[Create PayPal Sandbox order]
    H --> I[Customer approves on PayPal]
    I --> J[Server captures approved order]
    J --> K[Supabase order ledger and audit trail]
    K --> L[Protected admin dashboard]
    L --> M[AG Grid Orders table]
    L --> N[Bryntum Payment Timeline]
```

## Technology stack

  -------------------------------------------------------------------------
  Layer                   Technology                Responsibility
  ----------------------- ------------------------- -----------------------
  Web application         Next.js App Router,       Customer experience,
                          React, TypeScript,        admin interface and
                          Tailwind CSS              server routes

  AI                      Groq SDK                  Natural-language intent
                          (`openai/gpt-oss-120b`)   extraction

  Product intelligence    Channel3 Search API       Product catalogue,
                                                    structured attributes
                                                    and merchant offers

  Payments                PayPal Checkout Orders    Order creation,
                          API                       customer approval and
                                                    capture

  Data and audit          Supabase (Postgres + REST Order ledger, activity
                          API)                      logs, webhook events
                                                    and dashboard summaries

  Admin data grid         AG Grid Community         Sortable, filterable,
                                                    searchable and
                                                    paginated Orders table

  Admin timeline          Bryntum Scheduler         Read-only chronological
                          Community                 payment operations
                                                    timeline

  Hosting                 Vercel                    Hosted Next.js
                                                    application
  -------------------------------------------------------------------------

Both AG Grid and Bryntum are integrated into the admin dashboard and
operate on application data. The project uses their Community packages;
refer to the vendors' licensing terms and the hackathon sponsor terms
for applicable conditions.

------------------------------------------------------------------------

## Architecture and trust boundaries

The browser is not the authority for prices or payment status.

1.  **Intent:** the customer message is sent to the Next.js chat
    endpoint. The server uses Groq to interpret the request.
2.  **Discovery:** the server queries Channel3 and normalises catalogue
    and offer data.
3.  **Selection:** the customer chooses a specific product and merchant
    offer.
4.  **Verification:** the server queries Channel3 again and validates
    the selected product/offer. The browser does not supply the amount
    to charge.
5.  **Order creation:** the server obtains a PayPal access token and
    creates a USD order with `intent: CAPTURE`.
6.  **Approval:** the customer is redirected to PayPal to review and
    approve the order.
7.  **Capture:** the server calls PayPal to capture the approved order
    and records the result in Supabase.
8.  **Operations:** protected admin endpoints read audit and order data.
    AG Grid presents order records; Bryntum Scheduler visualises
    recorded events.

### Security design choices

-   API credentials are server-side environment variables and must never
    be exposed in client-side code.
-   The admin dashboard API requires a Bearer token.
-   The order ledger and activity log tables have Row Level Security
    enabled and direct `anon`/`authenticated` table access revoked in
    the supplied audit schema.
-   Activity logs are designed as append-only records.
-   The payment amount is derived from a fresh server-side offer
    verification.
-   The customer approves payment on PayPal; creating an order is not
    the same as capturing payment.
-   AG Grid and Bryntum views are read-only.

> **Prototype notice:** Before production use, complete a security
> review of the capture and webhook routes, validate PayPal webhook
> signature verification and duplicate-event handling, add rate limiting
> and abuse protection, and conduct end-to-end failure and
> reconciliation tests.

------------------------------------------------------------------------

## Getting started

### Prerequisites

-   Node.js **20.9 or newer**
-   npm and Git
-   A Supabase project
-   A Groq API key
-   A Channel3 API key
-   A PayPal Developer account and Sandbox REST app credentials

### 1. Clone the repository

``` bash
git clone https://github.com/princegyan/payagent-concierge.git
cd payagent-concierge
```

### 2. Install dependencies

``` bash
npm install
```

This installs the application dependencies, including the AG Grid and
Bryntum Community packages used by the admin dashboard.

### 3. Configure environment variables

Create `.env.local` in the project root. Add your own credentials
locally; do not commit this file.

``` env
# Groq — AI intent parsing
GROQ_API_KEY=

# Channel3 — product search
CHANNEL3_API_KEY=

# PayPal Developer Sandbox REST application
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=

# Supabase server-side access
SUPABASE_URL=
SUPABASE_SECRET_KEY=

# Admin dashboard access — use a long, random ASCII token
PAYAGENT_ADMIN_TOKEN=

# Application base URL
APP_URL=http://localhost:3000
```

If your Supabase project still uses the legacy service-role key, the
backend supports `SUPABASE_SERVICE_ROLE_KEY` as an alternative to
`SUPABASE_SECRET_KEY`; use only one.

Generate a strong admin token in Git Bash or a terminal with Node.js:

``` bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the generated value into `PAYAGENT_ADMIN_TOKEN`. Use only ASCII
characters. Restart the development server after changing environment
variables.

**Deployment note:** For a hosted deployment, the PayPal return and
cancellation URLs must use the deployed HTTPS domain, never `localhost`.
Confirm this with a newly created Sandbox order after deployment or
environment changes.

### 4. Configure Supabase

Create or use a Supabase project and copy its project URL and
server-side secret key into `.env.local`.

The application expects these tables:

-   `public.agent_activity_logs`
-   `public.payagent_orders`
-   `public.payagent_paypal_webhook_events`

It also expects these functions:

-   `public.payagent_admin_dashboard_summary()`
-   `public.payagent_admin_dashboard_summary(p_start_at timestamptz, p_end_at timestamptz)`

Run the database SQL in the Supabase SQL Editor in this order:

1.  Audit and order ledger schema --- creates `agent_activity_logs`,
    `payagent_orders`, the append-only audit trigger, indexes and access
    controls.
2.  Webhook event schema --- creates `payagent_paypal_webhook_events`
    and its indexes/access controls.
3.  Admin dashboard summary functions.
4.  Date-range summary function overload used by dashboard date filters.

The development history includes migrations named
`202611030001_payagent_audit_ledger.sql` and
`202611040001_payagent_admin_dashboard.sql`. Before submission, ensure
all SQL required for a fresh database setup is committed in the public
repository and that this README identifies the exact file paths and
execution order. SQL applied manually in a hosted Supabase project is
not automatically present in a fresh clone.

The admin summary functions should be executable by `service_role` only.
Do not grant browser roles access to the audit or order ledger.

### 5. Configure PayPal Sandbox

1.  Sign in to the [PayPal Developer
    Dashboard](https://developer.paypal.com/dashboard/).
2.  Create or select a Sandbox REST application.
3.  Copy its Client ID and Secret into `.env.local`.
4.  Use the Sandbox environment for testing.
5.  For live webhook testing, configure the webhook endpoint as
    `https://YOUR_DEPLOYED_DOMAIN/api/paypal/webhook`.
6.  Subscribe to the PayPal event types handled by the current webhook
    implementation.
7.  Store the webhook ID in `PAYPAL_WEBHOOK_ID`.

For local webhook testing, expose the local application through a secure
development tunnel and configure the resulting HTTPS endpoint in the
PayPal Developer Dashboard. Simulator-generated events are not proof of
live PayPal webhook delivery.

### 6. Run the application locally

``` bash
npm run dev
```

Open:

-   Customer application: http://localhost:3000
-   Admin dashboard: http://localhost:3000/admin

Enter the `PAYAGENT_ADMIN_TOKEN` value on the admin login screen.

### 7. Create a production build

``` bash
npm run build
```

Resolve all build and TypeScript errors before deploying or recording
the demo.

------------------------------------------------------------------------

## Admin dashboard guide

The admin dashboard is available at `/admin` and requires the admin
Bearer token.

### Orders --- AG Grid

-   Use quick search to find records.
-   Sort columns to organise results.
-   Use column filters/floating filters to narrow displayed records.
-   Change page size to 10, 20 or 50 rows.

### Payment Timeline --- Bryntum Scheduler

-   Review recorded order, activity and webhook events chronologically.
-   Use the timeline to understand event ordering and operational
    history.
-   Unmatched activity or webhook events remain in separate groups when
    an exact PayPal order ID association is unavailable.
-   The timeline is read-only; it does not edit orders or payment state.

### Activity and Webhooks

Use the Activity and Webhooks tabs to inspect recent audit activity and
webhook event records. The dashboard includes date-range filtering and
refresh controls.

------------------------------------------------------------------------

## API overview

  ------------------------------------------------------------------------
  Method                  Route                    Purpose
  ----------------------- ------------------------ -----------------------
  `POST`                  `/api/chat`              Conversational AI,
                                                   product search, offer
                                                   selection and PayPal
                                                   order creation

  `POST`                  `/api/paypal/capture`    Capture an approved
                                                   PayPal order

  `POST`                  `/api/paypal/webhook`    Receive PayPal webhook
                                                   events

  `GET`                   `/api/admin/audit`       Read protected audit
                                                   records

  `GET`                   `/api/admin/dashboard`   Read protected
                                                   dashboard summary and
                                                   recent records
  ------------------------------------------------------------------------

Admin endpoints require:

``` http
Authorization: Bearer YOUR_PAYAGENT_ADMIN_TOKEN
```

Keep the admin token private. Do not include it in the README, public
Postman collection or demo video.

------------------------------------------------------------------------

## Suggested judge walkthrough

1.  **Natural-language request:** ask PayAgent to find a mechanical
    keyboard within a stated budget and with a specific feature.
2.  **AI understanding:** show how the assistant turns the request into
    structured search criteria.
3.  **Live discovery:** display product images, features, prices and
    merchant offers returned by Channel3.
4.  **Refine:** add a maximum budget or preferred merchant.
5.  **Compare:** show merchant comparison and explain the shared
    canonical product ID requirement for same-product comparisons.
6.  **Select:** choose one product and merchant.
7.  **Re-verify:** explain that the backend checks the current offer
    again before creating the PayPal order.
8.  **PayPal approval:** show the customer reviewing and approving the
    order in PayPal Sandbox.
9.  **Payment result:** demonstrate the captured payment state and
    corresponding order record.
10. **AG Grid:** show sorting, filtering, quick search and pagination on
    the Orders tab.
11. **Bryntum:** show the Payment Timeline and explain how recorded
    order, activity and webhook events appear chronologically.
12. **Operational accountability:** show Activity and Webhooks records.

Keep the public demo video under three minutes. Use a fresh Sandbox
transaction and remove personal information from the recording.

------------------------------------------------------------------------

## Testing and verification

Development checks completed to date have included:

-   Product search and merchant comparison using Channel3 data.
-   Same-product comparison safeguards using canonical product IDs.
-   Server-side offer re-verification before PayPal order creation.
-   PayPal Sandbox order creation and customer approval.
-   A successful Sandbox capture recorded as `COMPLETED` in the order
    ledger.
-   Supabase activity and order persistence.
-   Admin API authentication checks for missing, invalid and valid
    tokens.
-   Admin dashboard summary and recent-record retrieval.
-   Dashboard date filters for `today`, `7`, `30` and `all`.
-   A webhook simulator event recorded as `PROCESSED`.
-   AG Grid Orders table rendering and interaction.
-   Bryntum Payment Timeline rendering with separate event rows to avoid
    overlapping labels.
-   Production build verification after the admin dashboard
    integrations.

### Remaining verification before production or final claims

-   Test a real PayPal-signed webhook delivery against a publicly
    reachable HTTPS endpoint.
-   Confirm invalid webhook signatures are rejected.
-   Confirm duplicate PayPal event delivery is idempotent.
-   Confirm webhook capture events reconcile the correct order and
    capture IDs.
-   Test cancelled, denied, failed, pending and refunded payment paths.
-   Test repeated capture requests and repeated success-page visits.
-   Confirm ledger state remains correct when PayPal succeeds but a
    Supabase write fails.
-   Reconcile the current capture route's status values with the
    database `payment_status` constraint.
-   Run a full fresh-user journey from chat request to captured Sandbox
    payment.
-   Test ambiguous product names, budget follow-ups and new-versus-used
    product preferences.
-   Verify setup from a fresh clone using only the public repository
    instructions.

Do not mark a test as passed until it has been executed against the
current code.

------------------------------------------------------------------------

## Limitations and scope

-   **Sandbox only:** PayPal transactions in the current demo are test
    transactions.
-   **USD checkout:** the current checkout implementation supports USD
    only and does not perform currency conversion.
-   **Catalogue dependency:** product coverage, merchant availability,
    price accuracy and offer depth depend on Channel3's returned data.
-   **Offer freshness:** the server re-verifies the selected offer
    before order creation, but merchant inventory or price can still
    change after verification.
-   **Prototype readiness:** production deployment requires the
    outstanding webhook, idempotency, rate-limit, monitoring and
    payment-reconciliation checks described above.

## Responsible use of AI and payments

PayAgent is designed as an assistive commerce agent. It can interpret
shopping intent, retrieve and organise product information, and prepare
a checkout order. It does not make the final payment decision on behalf
of the customer.

The customer reviews and approves the transaction through PayPal. The
server independently verifies the selected offer and records the
resulting payment state. The application should communicate uncertainty
clearly when product data, merchant availability or payment status
cannot be confirmed.

------------------------------------------------------------------------

## Project links

-   **Live application:** https://payagent-concierge.vercel.app
-   **Source repository:**
    https://github.com/princegyan/payagent-concierge
-   **Demo video:** Add the public YouTube URL here (under 3 minutes).

## Team

**Project:** PayAgent Concierge\
**Builder:** Alfred Prince Gyan\
**Contact:** princealfredgyan@gmail.com

## Licence

This project is released under the MIT License. Include the complete
`LICENSE` file in the repository root so judges and users can review the
licence terms.

------------------------------------------------------------------------

## A better way to shop

PayAgent Concierge makes shopping more conversational, comparisons more
deliberate and checkout more accountable---bringing AI assistance and
customer-controlled PayPal payments into one connected experience.
