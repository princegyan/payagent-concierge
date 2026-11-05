# Contributing

Thanks for your interest in improving PayAgent Concierge.

## Before you start
- Check existing issues and discussions before opening a new one.
- For substantial changes, describe the problem and proposed approach first.
- Never commit API keys, access tokens, customer data, PayPal credentials, or `.env.local`.

## Development
1. Fork or clone the repository.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local` and fill in your own development credentials.
4. Apply the documented Supabase SQL migrations in order.
5. Run `npm run dev`.
6. Run `npm run build` before submitting a pull request.

## Pull requests
- Keep changes focused and explain the user-facing impact.
- Include reproduction steps for bug fixes.
- Update documentation when environment variables, API routes, database schema, or setup steps change.
- Do not claim payment, webhook, or security behavior unless it has been tested.
