import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";


const PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com";

type LedgerOrder = {
  request_id: string;
  session_id: string | null;
  channel3_product_id: string | null;
  product_name: string;
  merchant_domain: string;
  amount: string | number;
  currency: string;
  paypal_order_id: string;
  paypal_status: string;
  payment_status: string;
};

type PayPalOrder = {
  id?: string;
  status?: string;
  purchase_units?: Array<{
    amount?: { value?: string; currency_code?: string };
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        amount?: { value?: string; currency_code?: string };
      }>;
    };
  }>;
};

function getSupabaseConfig() {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
  ).replace(/\/+$/, "");
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

function supabaseHeaders(apiKey: string, useLegacyBearer: boolean) {
  return {
    apikey: apiKey,
    ...(useLegacyBearer ? { Authorization: `Bearer ${apiKey}` } : {}),
    "Content-Type": "application/json",
  };
}

async function getPayPalAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("PayPal Sandbox credentials are not configured.");
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
      "Accept-Language": "en_US",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!response.ok) {
    console.error("PayPal OAuth failed:", response.status, await response.text());
    throw new Error("Could not authenticate with PayPal Sandbox.");
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("PayPal did not return an access token.");
  return data.access_token;
}

async function readLedgerOrder(
  orderId: string,
): Promise<{ config: NonNullable<ReturnType<typeof getSupabaseConfig>>; order: LedgerOrder }> {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase server credentials are not configured.");

  const response = await fetch(
    `${config.url}/rest/v1/payagent_orders?paypal_order_id=eq.${encodeURIComponent(orderId)}&select=request_id,session_id,channel3_product_id,product_name,merchant_domain,amount,currency,paypal_order_id,paypal_status,payment_status`,
    {
      headers: supabaseHeaders(config.apiKey, config.useLegacyBearer),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    console.error("Supabase ledger lookup failed:", response.status, await response.text());
    throw new Error("Could not verify this order in the PayAgent ledger.");
  }

  const rows = (await response.json()) as LedgerOrder[];
  if (rows.length !== 1) {
    throw new Error(
      rows.length === 0
        ? "This PayPal order is not recorded in the PayAgent ledger."
        : "More than one ledger record exists for this PayPal order. Capture has been stopped.",
    );
  }

  return { config, order: rows[0] };
}

async function getPayPalOrder(
  orderId: string,
  accessToken: string,
): Promise<PayPalOrder> {
  const response = await fetch(
    `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    console.error("PayPal order lookup failed:", response.status, await response.text());
    throw new Error("PayPal could not verify this order.");
  }

  return (await response.json()) as PayPalOrder;
}

async function updateLedgerAsCaptured(
  config: NonNullable<ReturnType<typeof getSupabaseConfig>>,
  orderId: string,
) {
  const url =
    `${config.url}/rest/v1/payagent_orders` +
    `?paypal_order_id=eq.${encodeURIComponent(orderId)}` +
    "&payment_status=eq.NOT_CAPTURED";

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(config.apiKey, config.useLegacyBearer),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      paypal_status: "COMPLETED",
      payment_status: "COMPLETED",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    console.error("Supabase capture ledger update failed:", response.status, await response.text());
    throw new Error(
      "PayPal reports a completed capture, but the PayAgent ledger update failed. Do not retry payment; reconcile this order.",
    );
  }

  const updated = (await response.json()) as Array<{ paypal_order_id: string }>;
  if (updated.length === 1) return;

  // A previous request may already have updated this row. Verify before treating it as idempotent.
  const check = await fetch(
    `${config.url}/rest/v1/payagent_orders?paypal_order_id=eq.${encodeURIComponent(orderId)}&select=payment_status,paypal_status`,
    {
      headers: supabaseHeaders(config.apiKey, config.useLegacyBearer),
      cache: "no-store",
    },
  );

  if (!check.ok) {
    throw new Error("Could not confirm the final payment status in the ledger.");
  }

  const rows = (await check.json()) as Array<{
    payment_status: string;
    paypal_status: string;
  }>;

  if (
    rows.length !== 1 ||
    rows[0].payment_status !== "COMPLETED" ||
    rows[0].paypal_status !== "COMPLETED"
  ) {
    throw new Error("The capture completed, but the ledger status needs manual reconciliation.");
  }
}

async function writeCaptureAudit(input: {
  config: NonNullable<ReturnType<typeof getSupabaseConfig>>;
  order: LedgerOrder;
  orderId: string;
  status: "success" | "failed";
  requestId: string;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
}) {
  const { config, order } = input;
  const response = await fetch(`${config.url}/rest/v1/agent_activity_logs`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(config.apiKey, config.useLegacyBearer),
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      request_id: order.request_id || input.requestId,
      session_id: order.session_id,
      user_id: null,
      event_type: "paypal_capture",
      action: "paypal_capture",
      status: input.status,
      product_id: order.channel3_product_id,
      product_name: order.product_name,
      merchant_domain: order.merchant_domain,
      amount: Number(order.amount),
      currency: order.currency,
      paypal_order_id: input.orderId,
      tool_name: "paypal_capture_api",
      duration_ms: null,
      filters: {},
      metadata: input.metadata ?? {},
      error_message: input.errorMessage ?? null,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    console.error("PayAgent capture audit insert failed:", response.status, await response.text());
  }
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();

  try {
    const body = (await req.json().catch(() => null)) as { orderId?: unknown; token?: unknown } | null;
    const orderId =
      typeof body?.orderId === "string"
        ? body.orderId.trim()
        : typeof body?.token === "string"
          ? body.token.trim()
          : "";

    if (!/^[A-Za-z0-9]{8,64}$/.test(orderId)) {
      return NextResponse.json({ error: "A valid PayPal order ID is required." }, { status: 400 });
    }

    const { config, order } = await readLedgerOrder(orderId);

    if (order.payment_status === "COMPLETED" && order.paypal_status === "COMPLETED") {
      return NextResponse.json({
        success: true,
        alreadyCaptured: true,
        orderId,
        paymentStatus: "COMPLETED",
        message: "This order has already been completed.",
      });
    }

    if (order.payment_status !== "NOT_CAPTURED") {
      return NextResponse.json(
        { error: `This ledger order is not eligible for capture (${order.payment_status}).` },
        { status: 409 },
      );
    }

    const accessToken = await getPayPalAccessToken();
    const paypalOrder = await getPayPalOrder(orderId, accessToken);

    if (paypalOrder.id !== orderId) {
      throw new Error("PayPal returned an order ID that does not match the ledger.");
    }

    const purchaseUnit = paypalOrder.purchase_units?.[0];
    const paypalAmount = purchaseUnit?.amount?.value;
    const paypalCurrency = purchaseUnit?.amount?.currency_code;
    const expectedAmount = Number(order.amount).toFixed(2);

    if (
      !paypalAmount ||
      !paypalCurrency ||
      Number(paypalAmount).toFixed(2) !== expectedAmount ||
      paypalCurrency !== order.currency
    ) {
      throw new Error("The PayPal order amount or currency does not match the PayAgent ledger.");
    }

    let capture: {
      id?: string;
      status?: string;
      amount?: { value?: string; currency_code?: string };
    } | undefined;

    if (paypalOrder.status === "COMPLETED") {
      capture = purchaseUnit?.payments?.captures?.find((item) => item.status === "COMPLETED");
      if (!capture) {
        throw new Error("PayPal marks this order completed but did not return a completed capture.");
      }
    } else if (paypalOrder.status === "APPROVED") {
      const idempotencyKey = `payagent-${createHash("sha256").update(orderId).digest("hex").slice(0, 24)}`;
      const captureResponse = await fetch(
        `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "PayPal-Request-Id": idempotencyKey,
          },
          body: "{}",
          cache: "no-store",
        },
      );

      if (!captureResponse.ok) {
        const detail = await captureResponse.text();
        console.error("PayPal capture failed:", captureResponse.status, detail);
        await writeCaptureAudit({
          config,
          order,
          orderId,
          requestId,
          status: "failed",
          metadata: { paypal_http_status: captureResponse.status },
          errorMessage: "PayPal capture request failed.",
        });
        return NextResponse.json(
          { error: "PayPal could not capture this payment. Check the order in PayPal before trying again." },
          { status: 502 },
        );
      }

      const capturedOrder = (await captureResponse.json()) as PayPalOrder;
      if (capturedOrder.status !== "COMPLETED") {
        await writeCaptureAudit({
          config,
          order,
          orderId,
          requestId,
          status: "failed",
          metadata: { paypal_status: capturedOrder.status ?? "UNKNOWN" },
          errorMessage: "PayPal did not confirm a completed capture.",
        });
        return NextResponse.json(
          {
            error: "PayPal has not confirmed payment completion.",
            paypalStatus: capturedOrder.status ?? "UNKNOWN",
          },
          { status: 409 },
        );
      }

      capture = capturedOrder.purchase_units?.[0]?.payments?.captures?.find(
        (item) => item.status === "COMPLETED",
      );
      if (!capture) {
        throw new Error("PayPal completed the order but no completed capture record was returned.");
      }
    } else {
      return NextResponse.json(
        {
          error: `This PayPal order is not approved for capture yet (PayPal status: ${paypalOrder.status ?? "UNKNOWN"}).`,
          paypalStatus: paypalOrder.status ?? "UNKNOWN",
        },
        { status: 409 },
      );
    }

    if (
      capture.amount?.currency_code !== order.currency ||
      !capture.amount.value ||
      Number(capture.amount.value).toFixed(2) !== expectedAmount
    ) {
      throw new Error("The captured amount or currency does not match the PayAgent ledger.");
    }

    await updateLedgerAsCaptured(config, orderId);
    await writeCaptureAudit({
      config,
      order,
      orderId,
      requestId,
      status: "success",
      metadata: {
        paypal_status: "COMPLETED",
        payment_status: "COMPLETED",
        capture_id: capture.id ?? null,
        captured_amount: capture.amount.value,
        currency: capture.amount.currency_code,
      },
    });

    return NextResponse.json({
      success: true,
      alreadyCaptured: false,
      orderId,
      captureId: capture.id ?? null,
      paymentStatus: "COMPLETED",
      paypalStatus: "COMPLETED",
      amount: capture.amount.value,
      currency: capture.amount.currency_code,
      message: "PayPal confirmed the payment. The PayAgent ledger has been updated.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected capture error.";
    console.error("PayAgent PayPal capture error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
