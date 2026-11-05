-- PayAgent Concierge — Phase 2 audit and order ledger
-- Recovered from the SQL migration previously used for the working project.
-- Server-side requests use the Supabase secret/service-role key only.

create extension if not exists pgcrypto;

create table if not exists public.agent_activity_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  session_id text,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  action text,
  status text not null default 'success'
    check (status in ('success', 'failed', 'pending')),
  search_query text,
  merchant_domain text,
  product_id text,
  product_name text,
  amount numeric(14, 2),
  currency varchar(3),
  paypal_order_id text,
  tool_name text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  filters jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists agent_activity_logs_created_at_idx
  on public.agent_activity_logs (created_at desc);
create index if not exists agent_activity_logs_request_id_idx
  on public.agent_activity_logs (request_id);
create index if not exists agent_activity_logs_session_id_idx
  on public.agent_activity_logs (session_id);
create index if not exists agent_activity_logs_event_type_idx
  on public.agent_activity_logs (event_type, created_at desc);
create index if not exists agent_activity_logs_paypal_order_id_idx
  on public.agent_activity_logs (paypal_order_id)
  where paypal_order_id is not null;

create or replace function public.payagent_reject_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'PayAgent activity logs are immutable; append a new event instead.';
end;
$$;

drop trigger if exists payagent_activity_logs_immutable on public.agent_activity_logs;
create trigger payagent_activity_logs_immutable
before update or delete on public.agent_activity_logs
for each row execute function public.payagent_reject_audit_mutation();

create table if not exists public.payagent_orders (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  session_id text,
  user_id uuid references auth.users(id) on delete set null,
  channel3_product_id text not null,
  product_name text not null,
  merchant_domain text not null,
  amount numeric(14, 2) not null check (amount > 0),
  currency varchar(3) not null,
  paypal_order_id text not null unique,
  paypal_status text not null default 'CREATED',
  payment_status text not null default 'NOT_CAPTURED'
    check (payment_status in ('NOT_CAPTURED', 'PENDING', 'COMPLETED', 'DECLINED', 'CANCELLED', 'REFUNDED', 'UNKNOWN')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payagent_orders_created_at_idx
  on public.payagent_orders (created_at desc);
create index if not exists payagent_orders_session_id_idx
  on public.payagent_orders (session_id);
create index if not exists payagent_orders_payment_status_idx
  on public.payagent_orders (payment_status, created_at desc);
create index if not exists payagent_orders_paypal_status_idx
  on public.payagent_orders (paypal_status, created_at desc);

create or replace function public.payagent_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payagent_orders_set_updated_at on public.payagent_orders;
create trigger payagent_orders_set_updated_at
before update on public.payagent_orders
for each row execute function public.payagent_set_updated_at();

alter table public.agent_activity_logs enable row level security;
alter table public.payagent_orders enable row level security;

revoke all on table public.agent_activity_logs from anon, authenticated;
revoke all on table public.payagent_orders from anon, authenticated;
grant all on table public.agent_activity_logs to service_role;
grant all on table public.payagent_orders to service_role;

comment on table public.agent_activity_logs is
  'Append-only PayAgent request, search, comparison, and tool activity audit events.';
comment on table public.payagent_orders is
  'PayAgent PayPal order ledger. NOT_CAPTURED means an order was created but payment has not been captured.';
