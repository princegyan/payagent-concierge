-- PayAgent Concierge — admin dashboard aggregate (all-time)
-- This zero-argument RPC is retained for compatibility with earlier dashboard builds.

create or replace function public.payagent_admin_dashboard_summary()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  with order_stats as (
    select
      count(*)::bigint as total,
      count(*) filter (where payment_status = 'PENDING')::bigint as pending,
      count(*) filter (where payment_status = 'UNKNOWN')::bigint as unknown,
      count(*) filter (where payment_status = 'DECLINED')::bigint as declined,
      count(*) filter (where payment_status = 'REFUNDED')::bigint as refunded,
      count(*) filter (where payment_status = 'CANCELLED')::bigint as cancelled,
      count(*) filter (where payment_status = 'COMPLETED')::bigint as completed,
      count(*) filter (where payment_status = 'NOT_CAPTURED')::bigint as not_captured
    from public.payagent_orders
  ),
  revenue as (
    select coalesce(jsonb_object_agg(currency, total_amount), '{}'::jsonb) as by_currency
    from (
      select currency, round(sum(amount), 2) as total_amount
      from public.payagent_orders
      where payment_status = 'COMPLETED'
      group by currency
    ) r
  ),
  activity as (
    select
      count(*)::bigint as total,
      count(distinct session_id)::bigint as sessions,
      count(*) filter (where status = 'failed')::bigint as failed_events,
      count(*) filter (where event_type = 'product_search')::bigint as product_searches,
      count(*) filter (where event_type = 'merchant_comparison')::bigint as merchant_comparisons
    from public.agent_activity_logs
  ),
  webhooks as (
    select
      count(*)::bigint as total,
      count(*) filter (where status = 'FAILED')::bigint as failed,
      count(*) filter (where status = 'RECEIVED')::bigint as received,
      count(*) filter (where status = 'PROCESSED')::bigint as processed,
      count(*) filter (where status = 'PROCESSING')::bigint as processing
    from public.payagent_paypal_webhook_events
  ),
  recent as (
    select
      (select count(*) from public.payagent_orders where created_at >= now() - interval '24 hours')::bigint as orders,
      (select count(*) from public.agent_activity_logs where created_at >= now() - interval '24 hours')::bigint as activity_events,
      (select count(*) from public.payagent_paypal_webhook_events where received_at >= now() - interval '24 hours')::bigint as webhook_events
  )
  select jsonb_build_object(
    'orders', (select to_jsonb(order_stats) from order_stats),
    'revenue_by_currency', (select by_currency from revenue),
    'activity', (select to_jsonb(activity) from activity),
    'webhooks', (select to_jsonb(webhooks) from webhooks),
    'last_24_hours', (select to_jsonb(recent) from recent),
    'generated_at', now()
  );
$$;

revoke all on function public.payagent_admin_dashboard_summary() from public, anon, authenticated;
grant execute on function public.payagent_admin_dashboard_summary() to service_role;
