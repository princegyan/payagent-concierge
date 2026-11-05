# Judge demo run sheet

Target duration: 2 minutes 30 seconds (keep the public video under 3 minutes).

## 0:00–0:20 — The problem
Introduce PayAgent Concierge as an AI shopping assistant that helps users discover products, compare merchant offers, and proceed to a PayPal checkout flow.

## 0:20–0:55 — Conversational product discovery
Enter a realistic shopping request with a budget and important requirements. Show the assistant interpreting the request and returning product options with prices and merchant information.

## 0:55–1:25 — Comparison and selection
Ask a follow-up question or request a merchant comparison. Explain that comparisons are only made when the results support a reliable same-product match. Select an offer.

## 1:25–1:55 — Trust boundary and PayPal
Explain that the server re-checks the selected offer before creating a PayPal Sandbox order. Complete the PayPal approval step if the demo environment is ready. Do not expose credentials or personal account details.

## 1:55–2:20 — Audit trail
Show the order ledger and activity in the protected admin dashboard. Point out the recorded payment status and webhook event status.

## 2:20–2:30 — Close
Summarise the value: conversational discovery, grounded merchant comparison, server-side offer verification, PayPal checkout, and an auditable order journey.

## Recording checklist
- Use a clean browser profile and reset demo data if needed.
- Confirm the app, database, Channel3, Groq, and PayPal Sandbox are working.
- Use only synthetic/demo customer data.
- Hide browser password managers, tokens, environment files, and private account details.
- Keep the video public and below 3 minutes.
- Do not present the webhook simulator as proof of PayPal signature verification.
