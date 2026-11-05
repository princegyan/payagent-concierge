
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";


type SupabaseConfig = {
  url: string;
  apiKey: string;
  useLegacyBearer: boolean;
};

type DateRange = "today" | "7" | "30" | "all";

function getSupabaseConfig(): SupabaseConfig | null {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");

  const apiKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !apiKey) return null;

  return {
    url,
    apiKey,
    useLegacyBearer: !apiKey.startsWith("sb_secret_"),
  };
}

function tokenMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);

  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}

function supabaseHeaders(config: SupabaseConfig) {
  return {
    apikey: config.apiKey,
    ...(config.useLegacyBearer
      ? { Authorization: `Bearer ${config.apiKey}` }
      : {}),
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function getDateRange(range: DateRange) {
  const now = new Date();
  const endAt = now.toISOString();

  let startDate = new Date(now);

  switch (range) {
    case "today":
      startDate.setUTCHours(0, 0, 0, 0);
      break;

    case "7":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;

    case "30":
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;

    case "all":
      startDate = new Date("1970-01-01T00:00:00.000Z");
      break;
  }

  return {
    startAt: startDate.toISOString(),
    endAt,
  };
}

async function readTable(
  config: SupabaseConfig,
  table: string,
  params: URLSearchParams
) {
  const response = await fetch(
    `${config.url}/rest/v1/${table}?${params.toString()}`,
    {
      method: "GET",
      headers: supabaseHeaders(config),
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `Supabase read failed for ${table} (${response.status}): ${detail}`
    );
  }

  return response.json();
}

async function readDashboardSummary(
  config: SupabaseConfig,
  startAt: string,
  endAt: string
) {
  const response = await fetch(
    `${config.url}/rest/v1/rpc/payagent_admin_dashboard_summary`,
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(config),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        p_start_at: startAt,
        p_end_at: endAt,
      }),
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `Dashboard summary RPC failed (${response.status}): ${detail}`
    );
  }

  const result = await response.json();

  return Array.isArray(result) ? result[0] ?? {} : result;
}

function createDateFilter(
  column: string,
  startAt: string,
  endAt: string
) {
  return `(${column}.gte.${startAt},${column}.lt.${endAt})`;
}

export async function GET(request: NextRequest) {
  const expectedToken = process.env.PAYAGENT_ADMIN_TOKEN;

  if (!expectedToken) {
    return NextResponse.json(
      { error: "PAYAGENT_ADMIN_TOKEN is not configured on the server." },
      { status: 503 }
    );
  }

  const authorization = request.headers.get("authorization") || "";

  const providedToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!providedToken || !tokenMatches(providedToken, expectedToken)) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 }
    );
  }

  const config = getSupabaseConfig();

  if (!config) {
    return NextResponse.json(
      {
        error:
          "Supabase server configuration is missing. Check SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.",
      },
      { status: 503 }
    );
  }

  const requestedLimit = Number(
    request.nextUrl.searchParams.get("limit") || 10
  );

  const limit = Number.isFinite(requestedLimit)
    ? Math.min(50, Math.max(1, Math.floor(requestedLimit)))
    : 10;

  const requestedRange =
    request.nextUrl.searchParams.get("range") || "7";

  const allowedRanges: DateRange[] = [
    "today",
    "7",
    "30",
    "all",
  ];

  if (!allowedRanges.includes(requestedRange as DateRange)) {
    return NextResponse.json(
      {
        error: "Invalid date range.",
        allowed_ranges: allowedRanges,
      },
      { status: 400 }
    );
  }

  const range = requestedRange as DateRange;
  const { startAt, endAt } = getDateRange(range);

  const ordersParams = new URLSearchParams({
    select:
      "id,request_id,session_id,channel3_product_id,product_name,merchant_domain,amount,currency,paypal_order_id,paypal_status,payment_status,metadata,created_at,updated_at",
    order: "created_at.desc",
    limit: String(limit),
  });

  const activityParams = new URLSearchParams({
    select:
      "id,request_id,session_id,event_type,action,status,search_query,merchant_domain,product_id,product_name,amount,currency,paypal_order_id,tool_name,duration_ms,filters,metadata,error_message,created_at",
    order: "created_at.desc",
    limit: String(limit),
  });

  const webhookParams = new URLSearchParams({
    select:
      "id,paypal_event_id,event_type,resource_id,paypal_order_id,status,error_message,event_summary,received_at,processed_at,updated_at",
    order: "received_at.desc",
    limit: String(limit),
  });

  if (range !== "all") {
    ordersParams.set(
      "and",
      createDateFilter("created_at", startAt, endAt)
    );

    activityParams.set(
      "and",
      createDateFilter("created_at", startAt, endAt)
    );

    webhookParams.set(
      "and",
      createDateFilter("received_at", startAt, endAt)
    );
  }

  try {
    const [
      summary,
      recentOrders,
      recentActivity,
      recentWebhooks,
    ] = await Promise.all([
      readDashboardSummary(config, startAt, endAt),
      readTable(config, "payagent_orders", ordersParams),
      readTable(config, "agent_activity_logs", activityParams),
      readTable(
        config,
        "payagent_paypal_webhook_events",
        webhookParams
      ),
    ]);

    return NextResponse.json(
      {
        generated_at: new Date().toISOString(),
        range,
        start_at: startAt,
        end_at: endAt,
        limit,
        summary,
        recent_orders: recentOrders,
        recent_activity: recentActivity,
        recent_webhooks: recentWebhooks,
        counts: {
          recent_orders: Array.isArray(recentOrders)
            ? recentOrders.length
            : 0,
          recent_activity: Array.isArray(recentActivity)
            ? recentActivity.length
            : 0,
          recent_webhooks: Array.isArray(recentWebhooks)
            ? recentWebhooks.length
            : 0,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected dashboard read error.";

    console.error("PayAgent admin dashboard read failed:", error);

    return NextResponse.json(
      {
        error: "Unable to load the admin dashboard.",
        detail: message,
      },
      { status: 502 }
    );
  }
}
