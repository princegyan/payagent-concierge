
"use client";

import { FormEvent, useCallback, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  CreditCard,
  DollarSign,
  FileText,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Webhook,
} from "lucide-react";

type Order = {
  id: string;
  product_name: string;
  merchant_domain: string;
  amount: number;
  currency: string;
  paypal_order_id: string;
  paypal_status: string;
  payment_status: string;
  session_id: string | null;
  created_at: string;
};

type ActivityRecord = {
  id: string;
  event_type: string;
  action: string | null;
  status: string;
  search_query: string | null;
  product_name: string | null;
  session_id: string | null;
  tool_name: string | null;
  error_message: string | null;
  created_at: string;
};

type WebhookRecord = {
  id: string;
  paypal_event_id: string;
  event_type: string;
  resource_id: string | null;
  paypal_order_id: string | null;
  status: string;
  error_message: string | null;
  received_at: string;
  processed_at: string | null;
};

type DashboardSummary = {
  generated_at?: string;
  orders?: {
    total?: number;
    completed?: number;
    not_captured?: number;
    pending?: number;
    declined?: number;
    cancelled?: number;
    refunded?: number;
    unknown?: number;
  };
  revenue_by_currency?: Record<string, number>;
  activity?: {
    total?: number;
    sessions?: number;
    failed_events?: number;
    product_searches?: number;
    merchant_comparisons?: number;
  };
  webhooks?: {
    total?: number;
    received?: number;
    processing?: number;
    processed?: number;
    failed?: number;
  };
  last_24_hours?: {
    orders?: number;
    activity_events?: number;
    webhook_events?: number;
  };
};

type DashboardData = {
  generated_at: string;
  range?: DateRange;
  start_at?: string;
  end_at?: string;
  limit: number;
  summary: DashboardSummary;
  recent_orders: Order[];
  recent_activity: ActivityRecord[];
  recent_webhooks: WebhookRecord[];
  counts: {
    recent_orders: number;
    recent_activity: number;
    recent_webhooks: number;
  };
};

type DateRange = "today" | "7" | "30" | "all";

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

type Tab = "orders" | "activity" | "webhooks";

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(value?: string | null) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function shortId(value?: string | null) {
  if (!value) return "—";
  return value.length > 20 ? `${value.slice(0, 17)}...` : value;
}

function StatusBadge({ value }: { value: string }) {
  const normalized = (value || "UNKNOWN").toUpperCase();

  let styles = "border-white/10 bg-white/5 text-white/65";

  if (["COMPLETED", "PROCESSED", "SUCCESS"].includes(normalized)) {
    styles = "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
  } else if (["FAILED", "DECLINED", "DENIED"].includes(normalized)) {
    styles = "border-red-400/20 bg-red-400/10 text-red-300";
  } else if (
    ["PENDING", "PROCESSING", "RECEIVED", "NOT_CAPTURED", "CREATED"].includes(
      normalized,
    )
  ) {
    styles = "border-amber-400/20 bg-amber-400/10 text-amber-300";
  }

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wide ${styles}`}
    >
      {normalized.replaceAll("_", " ")}
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#191919] p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-white/45">{label}</span>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-2">
          <Icon className="h-4 w-4 text-white/65" />
        </div>
      </div>
      <div className="mt-5 text-3xl font-semibold tracking-tight text-white">
        {value}
      </div>
      <p className="mt-2 text-xs text-white/35">{detail}</p>
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "orders", label: "Orders", icon: ShoppingBag },
  { id: "activity", label: "Activity", icon: FileText },
  { id: "webhooks", label: "Webhooks", icon: Webhook },
];

export default function AdminDashboardPage() {
  const [token, setToken] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("orders");
  const [dateRange, setDateRange] = useState<DateRange>("7");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  const loadDashboard = useCallback(
    async (adminToken: string, selectedRange: DateRange) => {
      setLoading(true);
      setError("");

      try {
        const query = new URLSearchParams({
          range: selectedRange,
          limit: "10",
        });

        const response = await fetch(
          `/api/admin/dashboard?${query.toString()}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${adminToken}`,
              Accept: "application/json",
            },
            cache: "no-store",
          },
        );

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          setAuthenticated(false);
          setData(null);
        }

        throw new Error(
          result.error || result.detail || "Unable to load dashboard.",
        );
      }

        setData(result as DashboardData);
        setAuthenticated(true);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Something went wrong while loading the dashboard.",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token.trim()) {
      setError("Enter your admin access token.");
      return;
    }

    await loadDashboard(token.trim(), dateRange);
  };

  const handleLogout = () => {
    setToken("");
    setData(null);
    setAuthenticated(false);
    setError("");
    setDateRange("7");
  };

  const handleDateRangeChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const nextRange = event.target.value as DateRange;
    setDateRange(nextRange);

    if (authenticated && token.trim()) {
      void loadDashboard(token.trim(), nextRange);
    }
  };

  const refresh = () => {
    if (token) void loadDashboard(token, dateRange);
  };

  if (!authenticated || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#111111] px-5 text-white">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center justify-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-black">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <div className="text-lg font-semibold">PayAgent</div>
              <div className="text-xs text-white/40">Administration</div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#191919] p-7 shadow-2xl">
            <h1 className="text-2xl font-semibold">Admin access</h1>
            <p className="mt-2 text-sm leading-6 text-white/45">
              Enter your server-configured admin token to access the dashboard.
            </p>

            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="admin-token"
                  className="mb-2 block text-xs font-medium text-white/60"
                >
                  Admin token
                </label>
                <input
                  id="admin-token"
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  autoComplete="off"
                  placeholder="Enter PAYAGENT_ADMIN_TOKEN"
                  className="h-12 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/30"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !token.trim()}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-black hover:bg-white/85 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying access...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    Access dashboard
                  </>
                )}
              </button>
            </form>

            <p className="mt-5 text-center text-[11px] leading-5 text-white/30">
              Your token is held in page memory only and is not saved in browser
              storage.
            </p>
          </div>

          <p className="mt-6 text-center text-[11px] text-white/25">
            PayAgent Concierge · Admin Console
          </p>
        </div>
      </main>
    );
  }

  const summary = data.summary;
  const orders = summary.orders || {};
  const activity = summary.activity || {};
  const webhooks = summary.webhooks || {};
  const revenue = summary.revenue_by_currency || {};
  const last24 = summary.last_24_hours || {};
  const selectedRangeLabel =
    DATE_RANGES.find((item) => item.value === dateRange)?.label ??
    "Last 7 days";

  const revenueText =
    Object.entries(revenue)
      .map(([currency, amount]) =>
        formatMoney(Number(amount), currency),
      )
      .join(" · ") || "—";

  return (
    <main className="min-h-screen bg-[#111111] text-white">
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#111111]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-black">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">PayAgent</div>
              <div className="text-[10px] text-white/40">
                Administration console
              </div>
            </div>
            <span className="ml-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
              Sandbox
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-white/35 sm:block">
              Updated {lastUpdated}
            </span>
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="flex h-9 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs text-white/70 hover:bg-white/5 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="flex h-9 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs text-white/60 hover:bg-white/5"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-5 py-8 sm:px-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-white/35">
              Overview
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Dashboard
            </h1>
            <p className="mt-2 text-sm text-white/40">
              Monitor PayAgent commerce activity, payments and operations.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label
                htmlFor="dashboard-date-range"
                className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.15em] text-white/40"
              >
                Date range
              </label>
              <select
                id="dashboard-date-range"
                value={dateRange}
                onChange={handleDateRangeChange}
                disabled={loading}
                className="h-10 min-w-[155px] rounded-xl border border-white/10 bg-[#191919] px-3 text-xs text-white outline-none transition hover:border-white/20 focus:border-white/40 disabled:opacity-50"
              >
                {DATE_RANGES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="pb-1 text-xs text-white/35">
              <div>Data generated</div>
              <div className="mt-1 text-white/55">
                {formatDate(summary.generated_at || data.generated_at)}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-300">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs text-white/35">
            Showing dashboard metrics for:{" "}
            <span className="font-medium text-white/65">
              {selectedRangeLabel}
            </span>
          </p>
          {loading && (
            <span className="flex items-center gap-2 text-xs text-white/40">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Updating dashboard...
            </span>
          )}
        </div>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Total orders"
            value={orders.total ?? 0}
            detail={`${last24.orders ?? 0} created in the last 24 hours`}
            icon={ShoppingBag}
          />
          <MetricCard
            label="Completed payments"
            value={orders.completed ?? 0}
            detail={`${orders.not_captured ?? 0} orders not yet captured`}
            icon={CheckCircle2}
          />
          <MetricCard
            label="Completed revenue"
            value={revenueText}
            detail="Grouped by currency"
            icon={DollarSign}
          />
          <MetricCard
            label="Activity events"
            value={activity.total ?? 0}
            detail={`${last24.activity_events ?? 0} recorded in the last 24 hours`}
            icon={Activity}
          />
        </section>

        <section className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/[0.08] bg-[#191919] p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-white/75">
              <CreditCard className="h-4 w-4 text-white/45" />
              Payment status
            </div>
            <div className="mt-5 space-y-4">
              {[
                { label: "Completed", value: orders.completed ?? 0, color: "bg-emerald-400" },
                { label: "Not captured", value: orders.not_captured ?? 0, color: "bg-amber-400" },
                { label: "Pending", value: orders.pending ?? 0, color: "bg-blue-400" },
                { label: "Declined", value: orders.declined ?? 0, color: "bg-red-400" },
                { label: "Refunded", value: orders.refunded ?? 0, color: "bg-purple-400" },
              ].map((item) => {
                const total = Math.max(orders.total ?? 0, 1);
                const percentage = (item.value / total) * 100;

                return (
                  <div key={item.label}>
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="text-white/55">{item.label}</span>
                      <span className="font-medium text-white/80">{item.value}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className={`h-full rounded-full ${item.color}`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#191919] p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-white/75">
              <Activity className="h-4 w-4 text-white/45" />
              Customer activity
            </div>
            <div className="mt-6 grid grid-cols-2 gap-5">
              <div>
                <div className="text-3xl font-semibold">{activity.sessions ?? 0}</div>
                <p className="mt-1 text-xs text-white/40">Sessions</p>
              </div>
              <div>
                <div className="text-3xl font-semibold">{activity.product_searches ?? 0}</div>
                <p className="mt-1 text-xs text-white/40">Product searches</p>
              </div>
              <div>
                <div className="text-3xl font-semibold">{activity.merchant_comparisons ?? 0}</div>
                <p className="mt-1 text-xs text-white/40">Comparisons</p>
              </div>
              <div>
                <div className="text-3xl font-semibold text-red-300">{activity.failed_events ?? 0}</div>
                <p className="mt-1 text-xs text-white/40">Failed events</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#191919] p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-white/75">
              <Webhook className="h-4 w-4 text-white/45" />
              PayPal webhooks
            </div>
            <div className="mt-6 flex items-end justify-between">
              <div>
                <div className="text-3xl font-semibold">{webhooks.total ?? 0}</div>
                <p className="mt-1 text-xs text-white/40">Total events</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold text-emerald-300">{webhooks.processed ?? 0}</div>
                <p className="mt-1 text-xs text-white/40">Processed</p>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <StatusBadge value={`RECEIVED: ${webhooks.received ?? 0}`} />
              <StatusBadge value={`PROCESSING: ${webhooks.processing ?? 0}`} />
              <StatusBadge value={`FAILED: ${webhooks.failed ?? 0}`} />
            </div>
            <p className="mt-4 text-xs text-white/35">
              {last24.webhook_events ?? 0} webhook events in the last 24 hours
            </p>
          </div>
        </section>

        <section className="mt-8 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#191919]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
            <div>
              <h2 className="font-semibold">Operations</h2>
              <p className="mt-1 text-xs text-white/40">
                Review transactions, agent activity and PayPal webhook events.
              </p>
            </div>
            <div className="flex rounded-xl border border-white/[0.08] bg-black/20 p-1">
              {TABS.map((tab) => {
                const Icon = tab.icon;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition ${
                      activeTab === tab.id
                        ? "bg-white text-black"
                        : "text-white/50 hover:text-white"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="overflow-x-auto">
            {activeTab === "orders" && (
              <table className="w-full min-w-[850px] text-left text-xs">
                <thead className="bg-white/[0.025] text-[10px] uppercase tracking-wider text-white/35">
                  <tr>
                    <th className="px-5 py-4 font-medium">Product</th>
                    <th className="px-5 py-4 font-medium">Merchant</th>
                    <th className="px-5 py-4 font-medium">Amount</th>
                    <th className="px-5 py-4 font-medium">Payment</th>
                    <th className="px-5 py-4 font-medium">PayPal order</th>
                    <th className="px-5 py-4 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {data.recent_orders.map((order) => (
                    <tr key={order.id} className="hover:bg-white/[0.02]">
                      <td className="max-w-[260px] px-5 py-4">
                        <div className="truncate font-medium text-white/85">{order.product_name}</div>
                        <div className="mt-1 text-[10px] text-white/30">{shortId(order.id)}</div>
                      </td>
                      <td className="px-5 py-4 text-white/55">{order.merchant_domain}</td>
                      <td className="px-5 py-4 font-medium text-white/80">
                        {formatMoney(Number(order.amount), order.currency)}
                      </td>
                      <td className="px-5 py-4"><StatusBadge value={order.payment_status} /></td>
                      <td className="px-5 py-4 font-mono text-white/45">{shortId(order.paypal_order_id)}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-white/40">{formatDate(order.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeTab === "activity" && (
              <table className="w-full min-w-[750px] text-left text-xs">
                <thead className="bg-white/[0.025] text-[10px] uppercase tracking-wider text-white/35">
                  <tr>
                    <th className="px-5 py-4 font-medium">Event</th>
                    <th className="px-5 py-4 font-medium">Query / product</th>
                    <th className="px-5 py-4 font-medium">Tool</th>
                    <th className="px-5 py-4 font-medium">Status</th>
                    <th className="px-5 py-4 font-medium">Session</th>
                    <th className="px-5 py-4 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {data.recent_activity.map((item) => (
                    <tr key={item.id} className="hover:bg-white/[0.02]">
                      <td className="px-5 py-4 font-medium text-white/75">{item.event_type}</td>
                      <td className="max-w-[230px] truncate px-5 py-4 text-white/50">
                        {item.search_query || item.product_name || "—"}
                      </td>
                      <td className="px-5 py-4 text-white/40">{item.tool_name || "—"}</td>
                      <td className="px-5 py-4"><StatusBadge value={item.status} /></td>
                      <td className="px-5 py-4 font-mono text-white/35">{shortId(item.session_id)}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-white/40">{formatDate(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeTab === "webhooks" && (
              <table className="w-full min-w-[750px] text-left text-xs">
                <thead className="bg-white/[0.025] text-[10px] uppercase tracking-wider text-white/35">
                  <tr>
                    <th className="px-5 py-4 font-medium">Event type</th>
                    <th className="px-5 py-4 font-medium">Event ID</th>
                    <th className="px-5 py-4 font-medium">Resource</th>
                    <th className="px-5 py-4 font-medium">Status</th>
                    <th className="px-5 py-4 font-medium">Received</th>
                    <th className="px-5 py-4 font-medium">Processed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {data.recent_webhooks.map((item) => (
                    <tr key={item.id} className="hover:bg-white/[0.02]">
                      <td className="px-5 py-4 font-medium text-white/75">{item.event_type}</td>
                      <td className="px-5 py-4 font-mono text-white/40">{shortId(item.paypal_event_id)}</td>
                      <td className="px-5 py-4 font-mono text-white/40">{shortId(item.resource_id)}</td>
                      <td className="px-5 py-4"><StatusBadge value={item.status} /></td>
                      <td className="whitespace-nowrap px-5 py-4 text-white/40">{formatDate(item.received_at)}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-white/40">{formatDate(item.processed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {((activeTab === "orders" && data.recent_orders.length === 0) ||
              (activeTab === "activity" && data.recent_activity.length === 0) ||
              (activeTab === "webhooks" && data.recent_webhooks.length === 0)) && (
              <div className="flex flex-col items-center justify-center px-5 py-16 text-center">
                <Search className="h-6 w-6 text-white/25" />
                <p className="mt-3 text-sm text-white/55">No records found</p>
                <p className="mt-1 text-xs text-white/30">
                  New records will appear here when available.
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] px-5 py-3 text-[11px] text-white/35">
            <span>
              Showing{" "}
              {activeTab === "orders"
                ? data.counts.recent_orders
                : activeTab === "activity"
                  ? data.counts.recent_activity
                  : data.counts.recent_webhooks}{" "}
              recent records
            </span>
            <span>Latest 10 · Read-only view</span>
          </div>
        </section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 text-[10px] text-white/25">
          <span>PayAgent Concierge · Admin Dashboard</span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3 w-3" />
            Protected admin access
          </span>
        </footer>
      </div>
    </main>
  );
}
