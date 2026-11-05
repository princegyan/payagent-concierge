# PayAgent Concierge

### Shop through a conversation. Compare real offers. Pay with confidence.

PayAgent Concierge is an AI-powered shopping and checkout assistant that
turns a natural-language shopping request into a guided commerce
journey. Customers describe what they need, explore product results,
compare merchant offers, choose a specific listing and continue to
PayPal Checkout---without handing payment authority to the AI.

> **Hackathon build:** PayPal Sandbox · Groq AI · Channel3 product
> intelligence · Supabase audit and order ledger

------------------------------------------------------------------------

## The problem

Online shopping is fragmented. Customers often have to translate an idea
into search terms, visit multiple stores, compare listings that may not
represent the same product, verify whether an offer is still available
and then complete checkout on a separate site.

That process is time-consuming and makes it easy to compare unlike
products or act on stale pricing.

## Our solution

PayAgent Concierge brings product discovery, comparison and payment
preparation into one conversational interface.

A customer can ask for a product in everyday language, refine the
request with follow-up constraints such as a budget or preferred
merchant, inspect product information and select a specific offer.
Before checkout, the server re-queries the product provider to verify
the selected product and merchant offer. It then creates a PayPal order
for the verified amount and sends the customer to PayPal to review and
approve payment.

**The AI assists with shopping; the customer remains in control of
payment approval.**

## Why it matters

-   **Less search friction:** start with a natural-language request
    instead of manually constructing filters.
-   **More useful comparisons:** compare merchant offers and distinguish
    genuine same-product comparisons from unrelated listings.
-   **Safer checkout preparation:** the server verifies the selected
    offer again rather than trusting a price supplied by the browser.
-   **Clear payment state:** an order being created is not represented
    as a completed payment.
-   **Operational visibility:** an administrator can inspect orders, AI
    activity and webhook records through a protected dashboard.

------------------------------------------------------------------------

## Product capabilities

  -----------------------------------------------------------------------
  Capability                          What it does
  ----------------------------------- -----------------------------------
  Conversational shopping             Uses Groq-powered intent parsing to
                                      interpret product requests and
                                      follow-up instructions.

  Product discovery                   Searches Channel3 for structured
                                      product, image, feature, variant
                                      and merchant-offer data.

  Product filtering                   Supports budget, merchant,
                                      required-feature and price-sort
                                      constraints.

  Merchant comparison                 Summarises merchant offers and only
                                      labels a comparison as the same
                                      product when the provider returns a
                                      shared canonical product ID.

  Offer re-verification               Re-queries Channel3 immediately
                                      before creating a PayPal order.

  PayPal Checkout                     Creates PayPal Orders API orders
                                      using the verified offer amount and
                                      redirects the customer to PayPal
                                      approval.

  Payment capture                     Captures an approved PayPal order
                                      through a server-side endpoint.

  Audit and order ledger              Persists commerce activity, order
                                      records and payment states in
                                      Supabase.

  Admin dashboard                     Provides protected operational
                                      summaries and recent order,
                                      activity and webhook records, with
                                      date-range filtering.
  -----------------------------------------------------------------------

### Current payment environment

The current implementation is configured for **PayPal Sandbox** and
**USD checkout**. It does not silently convert other currencies. Sandbox
transactions are for demonstration and testing, not real-money
settlement.

### AI and agentic behaviour

The AI interprets customer intent and helps coordinate the shopping
journey. It does not independently authorise or execute a payment. A
selected product is re-verified by the server and the customer must
approve the PayPal order on PayPal.

------------------------------------------------------------------------

## How it works

``` mermaid
flowchart TD
    A[Customer describes shopping need] --> B[Next.js chat API]
    B --> C[Groq intent parsing]
    C --> D[Channel3 product search]
    D --> E[Filter and compare structured offers]
    E --> F[Customer selects a product and merchant]
    F --> G[Server re-verifies selected offer with Channel3]
    G --> H[Create PayPal Sandbox order]
    H --> I[Customer reviews and approves on PayPal]
    I --> J[Server captures approved order]
    J --> K[Update Supabase order ledger and audit trail]
    K --> L[Protected admin dashboard]
```

### Technology stack

  -------------------------------------------------------------------------
  Layer                   Technology                Responsibility
  ----------------------- ------------------------- -----------------------
  Web application         Next.js App Router,       Customer experience and
                          React, TypeScript,        server routes
                          Tailwind CSS              

  AI                      Groq SDK                  Natural-language intent
                          (`openai/gpt-oss-120b`)   extraction

  Product intelligence    Channel3 Search API       Product catalogue,
                                                    structured attributes
                                                    and merchant offers

  Payments                PayPal Checkout Orders    Order creation,
                          API                       customer approval and
                                                    capture

  Data and audit          Supabase (Postgres + REST Order ledger, activity
                          API)                      logs, webhook event
                                                    records and dashboard
                                                    summaries

  Admin interface         Next.js, React, Lucide,   Operational monitoring
                          AG Grid dependencies      
  -------------------------------------------------------------------------

------------------------------------------------------------------------

## Architecture and important trust boundaries

PayAgent is designed so that the browser is not the authority for prices
or payment status.

1.  **Intent:** the customer message is sent to the Next.js chat
    endpoint. The server uses Groq to interpret the request.
2.  **Discovery:** the server queries Channel3 and normalises the
    returned catalogue and offer data.
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
8.  **Operations:** protected admin endpoints read the audit and order
    data for the dashboard.

**Security design choices**

-   API credentials are server-side environment variables; they must
    never be exposed in client-side code.
-   The admin dashboard API requires a Bearer token.
-   The order ledger and activity log tables have Row Level Security
    enabled and direct `anon`/`authenticated` table access revoked in
    the supplied audit schema.
-   Activity logs are designed as append-only records.
-   The payment amount is derived from a fresh server-side offer
    verification.
-   The customer approves payment on PayPal; creating an order is not
    the same as capturing payment.

> **Important:** The project is a hackathon prototype. Before production
> use, complete a security review of the current capture and webhook
> routes, validate PayPal webhook signature verification and
> duplicate-event handling, add rate limiting and abuse protection, and
> conduct end-to-end failure/reconciliation tests.

------------------------------------------------------------------------

## Getting started

### Prerequisites

-   Node.js **20.9 or newer**
-   npm
-   A Supabase project
-   A Groq API key
-   A Channel3 API key
-   PayPal Developer account and Sandbox REST app credentials
-   Git

### 1. Clone the repository

Replace the placeholder with the public repository URL used for the
submission:

``` bash
git clone <YOUR_PUBLIC_REPOSITORY_URL>
cd payagent-concierge
```

If the repository directory has a different name, change into that
directory instead.

### 2. Install dependencies

``` bash
npm install
```

### 3. Configure environment variables

Create a file named `.env.local` in the project root.

``` env
# Groq — AI intent parsing
GROQ_API_KEY=

# Channel3 — product search
CHANNEL3_API_KEY=

# PayPal Developer Sandbox REST application
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=

# Public base URL used for PayPal return/cancel URLs
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Supabase server-side access
SUPABASE_URL=
SUPABASE_SECRET_KEY=

# Admin dashboard access — use a long, random ASCII token
PAYAGENT_ADMIN_TOKEN=
```

**Do not commit `.env.local`.** Do not paste credentials into issues,
screenshots, demo recordings or public chat. Use the server-side
Supabase secret key. If your Supabase project still uses the legacy
service-role key, the backend supports `SUPABASE_SERVICE_ROLE_KEY` as an
alternative to `SUPABASE_SECRET_KEY`; use only one.

Generate a strong admin token in Git Bash or a terminal with Node.js:

``` bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the generated value into `PAYAGENT_ADMIN_TOKEN`. Use only ASCII
characters. Restart the development server after changing environment
variables.

### 4. Configure Supabase

Create or use a Supabase project and copy its project URL and
server-side secret key into `.env.local`.

Run the database SQL in the Supabase SQL Editor, in this order:

1.  **Audit and order ledger schema** --- creates `agent_activity_logs`,
    `payagent_orders`, the append-only audit trigger, indexes and access
    controls.
2.  **Webhook event schema** --- creates
    `payagent_paypal_webhook_events` and its indexes/access controls.
3.  **Admin dashboard summary functions** --- creates the summary RPC
    used by the dashboard.
4.  **Date-range summary function overload** --- adds the `p_start_at`
    and `p_end_at` summary function used by dashboard date filters.

The project history includes the audit migration named
`202611030001_payagent_audit_ledger.sql` and the dashboard migration
named `202611040001_payagent_admin_dashboard.sql`. The dashboard SQL was
also applied directly in the Supabase SQL Editor during development.
Ensure the corresponding SQL is included in the public repository under
a clearly documented `supabase/migrations/` or `database/` directory
before submission; do not assume a migration file exists just because it
was executed in the hosted database.

The backend expects these tables:

-   `public.agent_activity_logs`
-   `public.payagent_orders`
-   `public.payagent_paypal_webhook_events`

It also expects the RPC function:

-   `public.payagent_admin_dashboard_summary()`
-   `public.payagent_admin_dashboard_summary(p_start_at timestamptz, p_end_at timestamptz)`

The admin summary function should be executable by `service_role` only.
Do not grant browser roles access to the audit or order ledger.

### 5. Configure PayPal Sandbox

1.  Sign in to the PayPal Developer Dashboard.
2.  Create or select a Sandbox REST application.
3.  Copy its Client ID and Secret into `.env.local`.
4.  Set the application to the Sandbox environment used by the project.
5.  Configure the webhook endpoint URL for the deployed application if
    testing real webhook delivery.
6.  Subscribe to the PayPal event types handled by the current webhook
    implementation.
7.  Store the webhook ID in `PAYPAL_WEBHOOK_ID`.

For local webhook testing, expose the local application through a secure
development tunnel and configure the resulting HTTPS endpoint in the
PayPal Developer Dashboard. Do not describe simulator-generated events
as proof of live PayPal webhook delivery.

### 6. Start the application

``` bash
npm run dev
```

Open:

-   Customer application: <http://localhost:3000>
-   Admin dashboard: <http://localhost:3000/admin>

Enter the `PAYAGENT_ADMIN_TOKEN` value on the admin login screen.

### 7. Production build check

Before deploying or submitting, run:

``` bash
npm run build
```

Resolve all build and TypeScript errors before recording the demo.

------------------------------------------------------------------------

## API overview

The following routes are part of the application architecture. Confirm
the exact request and response schemas against the current source before
publishing external API documentation.

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

The admin endpoints require:

``` http
Authorization: Bearer YOUR_PAYAGENT_ADMIN_TOKEN
```

The admin token must remain private. Do not include it in the README,
public Postman collection or demo video.

------------------------------------------------------------------------

## Suggested judge walkthrough

A concise demonstration should show the complete value proposition
rather than a collection of disconnected screens.

### Demo scenario

1.  **Start with a natural request.** Ask PayAgent to find a mechanical
    keyboard for a stated budget and with a specific feature.
2.  **Show AI understanding.** Explain how the assistant turns the
    request into structured search criteria.
3.  **Show live product discovery.** Display product images, key
    features, prices and merchant offers returned by Channel3.
4.  **Refine the request.** Add a follow-up constraint such as a maximum
    budget or a preferred merchant.
5.  **Compare offers.** Show merchant comparison and explain that a
    same-product comparison requires a shared canonical product ID.
6.  **Select an offer.** Choose one product and merchant.
7.  **Explain re-verification.** Point out that the backend checks the
    current offer again before creating the PayPal order.
8.  **Approve in PayPal Sandbox.** Show the customer reviewing and
    approving the order on PayPal.
9.  **Show the payment result.** Demonstrate the captured payment state
    and corresponding order record.
10. **Show operational accountability.** Open `/admin` and show the
    order, activity and webhook records.

Keep the video under three minutes if using it for a hackathon
submission. Use a fresh Sandbox transaction and remove personal
information from the recording.

------------------------------------------------------------------------

## Testing and verification

The development work completed so far has included these recorded
checks:

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
-   Test the AI with ambiguous product names, budget follow-ups and
    new-versus-used product preferences.

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

------------------------------------------------------------------------

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

-   **Live demo:** `<ADD_PUBLIC_DEMO_URL>`
-   **Source repository:** `<https://github.com/princegyan/payagent-concierge.git>`
-   **Demo video:** `<ADD_PUBLIC_YOUTUBE_URL>`
-   **Hackathon submission:** `<ADD_SUBMISSION_URL_IF_APPLICABLE>`

Replace these placeholders before submission. If no hosted demo is
available, provide complete setup instructions and a public repository
that judges can run.

## Team

**Project:** PayAgent Concierge\
**Team / builder:** `<Alfred Prince Gyan>`\
**Contact:** `<princealfredgyan@gmail.com>`

## Licence

 MIT License 
------------------------------------------------------------------------

## A better way to shop

PayAgent Concierge makes shopping more conversational, comparisons more
deliberate and checkout more accountable---bringing AI assistance and
customer-controlled PayPal payments into one connected experience.
