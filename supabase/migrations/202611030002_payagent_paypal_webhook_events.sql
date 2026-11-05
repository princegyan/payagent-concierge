-- PayAgent Concierge — PayPal webhook event inbox
-- Schema follows the fields and status transitions used by app/api/paypal/webhook/route.ts.

create table if not exists public.payagent_paypal_webhook_events (
  id uuid primary key default gen_random_uuid(),
  paypal_event_id text not null unique,
  event_type text not null,
  resource_id text,
  paypal_order_id text,
  status text not null default 'RECEIVED'
    check (status in ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED')),
  error_message text,
  event_summary jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists payagent_webhook_events_received_at_idx
  on public.payagent_paypal_webhook_events (received_at desc);
create index if not exists payagent_webhook_events_status_idx
  on public.payagent_paypal_webhook_events (status, received_at desc);
create index if not exists payagent_webhook_events_paypal_order_id_idx
  on public.payagent_paypal_webhook_events (paypal_order_id)
  where paypal_order_id is not null;

alter table public.payagent_paypal_webhook_events enable row level security;

revoke all on table public.payagent_paypal_webhook_events from anon, authenticated;
grant all on table public.payagent_paypal_webhook_events to service_role;

comment on table public.payagent_paypal_webhook_events is
  'Idempotent PayPal webhook inbox. paypal_event_id is unique to prevent duplicate event processing.';
