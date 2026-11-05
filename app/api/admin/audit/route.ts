import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";


function getSupabaseConfig() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const apiKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !apiKey) return null;
  return { url, apiKey, useLegacyBearer: !apiKey.startsWith("sb_secret_") };
}

function tokenMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function readTable(
  config: { url: string; apiKey: string; useLegacyBearer: boolean },
  table: string,
  params: URLSearchParams,
) {
  const response = await fetch(`${config.url}/rest/v1/${table}?${params.toString()}`, {
    method: "GET",
    headers: {
      apikey: config.apiKey,
      ...(config.useLegacyBearer ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Supabase read failed for ${table} (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export async function GET(request: NextRequest) {
  const expectedToken = process.env.PAYAGENT_ADMIN_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { error: "PAYAGENT_ADMIN_TOKEN is not configured on the server." },
      { status: 503 },
    );
  }

  const authorization = request.headers.get("authorization") || "";
  const providedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!providedToken || !tokenMatches(providedToken, expectedToken)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Supabase server configuration is missing. Check SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 },
    );
  }

  const search = request.nextUrl.searchParams;
  const requestedLimit = Number(search.get("limit") || 25);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 25;
  const eventType = search.get("event_type");
  const sessionId = search.get("session_id");

  const logsParams = new URLSearchParams({
    select: "id,request_id,session_id,event_type,action,status,search_query,merchant_domain,product_id,product_name,amount,currency,paypal_order_id,tool_name,duration_ms,filters,metadata,error_message,created_at",
    order: "created_at.desc",
    limit: String(limit),
  });
  if (eventType) logsParams.set("event_type", `eq.${eventType}`);
  if (sessionId) logsParams.set("session_id", `eq.${sessionId}`);

  const ordersParams = new URLSearchParams({
    select: "id,request_id,session_id,channel3_product_id,product_name,merchant_domain,amount,currency,paypal_order_id,paypal_status,payment_status,metadata,created_at,updated_at",
    order: "created_at.desc",
    limit: String(limit),
  });
  if (sessionId) ordersParams.set("session_id", `eq.${sessionId}`);

  try {
    const [logs, orders] = await Promise.all([
      readTable(config, "agent_activity_logs", logsParams),
      readTable(config, "payagent_orders", ordersParams),
    ]);
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      filters: { limit, event_type: eventType, session_id: sessionId },
      counts: {
        activity_logs: Array.isArray(logs) ? logs.length : 0,
        orders: Array.isArray(orders) ? orders.length : 0,
      },
      activity_logs: logs,
      orders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected audit read error.";
    console.error("PayAgent admin audit read failed:", error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
