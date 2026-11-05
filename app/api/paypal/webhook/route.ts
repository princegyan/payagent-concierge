
import { NextRequest, NextResponse } from "next/server";
import {
  randomUUID,
  createVerify,
} from "node:crypto";
import { Buffer } from "node:buffer";


type JsonRecord = {
  [key: string]: any;
};

type SupabaseConfig = {
  url: string;
  secretKey: string;
};

type LedgerOrder = {
  id: string;
  request_id: string | null;
  session_id: string | null;
  paypal_order_id: string;
  product_name: string;
  merchant_domain: string | null;
  amount: number | string;
  currency: string;
  paypal_status: string;
  payment_status: string;
};

type WebhookRegistration =
  | "new"
  | "duplicate"
  | "retry";

type VerificationResult =
  | "REAL_PAYPAL"
  | "SIMULATOR";

const PAYPAL_API =
  "https://api-m.sandbox.paypal.com";

const SUPPORTED_EVENTS = [
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.REFUNDED",
];

// --------------------------------------------------
// SUPABASE CONFIGURATION
// --------------------------------------------------

function getSupabaseConfig(): SupabaseConfig {
  const url = process.env.SUPABASE_URL;

  const secretKey =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Supabase environment variables are missing.",
    );
  }

  return {
    url: url.replace(/\/$/, ""),
    secretKey,
  };
}

function supabaseHeaders(config: SupabaseConfig) {
  return {
    apikey: config.secretKey,
    Authorization: `Bearer ${config.secretKey}`,
    "Content-Type": "application/json",
  };
}

// --------------------------------------------------
// PAYPAL AUTHENTICATION
// --------------------------------------------------

function getPayPalCredentials() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "PayPal credentials are missing.",
    );
  }

  return {
    clientId,
    clientSecret,
  };
}

async function getPayPalAccessToken(): Promise<string> {
  const { clientId, clientSecret } =
    getPayPalCredentials();

  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`,
  ).toString("base64");

  const response = await fetch(
    `${PAYPAL_API}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    console.error(
      "PayPal OAuth failed:",
      response.status,
      await response.text(),
    );

    throw new Error(
      "Could not authenticate with PayPal.",
    );
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error(
      "PayPal did not return an access token.",
    );
  }

  return data.access_token;
}

// --------------------------------------------------
// PAYPAL SIGNATURE VERIFICATION
// --------------------------------------------------

function getHeader(
  request: NextRequest,
  name: string,
): string {
  return request.headers.get(name) ?? "";
}

function calculateCrc32(input: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of input) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);

      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

async function downloadPayPalCertificate(
  certUrl: string,
): Promise<string> {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(certUrl);
  } catch {
    throw new Error(
      "PayPal certificate URL is invalid.",
    );
  }

  const allowedHosts = [
    "api-m.sandbox.paypal.com",
    "api.sandbox.paypal.com",
    "api-m.paypal.com",
    "api.paypal.com",
  ];

  if (
    parsedUrl.protocol !== "https:" ||
    !allowedHosts.includes(parsedUrl.hostname) ||
    !parsedUrl.pathname.startsWith(
      "/v1/notifications/certs/",
    )
  ) {
    throw new Error(
      "PayPal certificate URL is not trusted.",
    );
  }

  const response = await fetch(certUrl, {
    method: "GET",
    redirect: "error",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      "Could not download the PayPal signing certificate.",
    );
  }

  const certificate = await response.text();

  if (
    !certificate.includes("-----BEGIN CERTIFICATE-----") ||
    !certificate.includes("-----END CERTIFICATE-----")
  ) {
    throw new Error(
      "PayPal returned an invalid signing certificate.",
    );
  }

  return certificate;
}

async function verifyPayPalSignatureWithId(
  request: NextRequest,
  rawBody: string,
  webhookId: string,
): Promise<boolean> {
  const transmissionId = getHeader(
    request,
    "paypal-transmission-id",
  );

  const transmissionTime = getHeader(
    request,
    "paypal-transmission-time",
  );

  const transmissionSig = getHeader(
    request,
    "paypal-transmission-sig",
  );

  const certUrl = getHeader(
    request,
    "paypal-cert-url",
  );

  const authAlgo = getHeader(
    request,
    "paypal-auth-algo",
  );

  if (
    !transmissionId ||
    !transmissionTime ||
    !transmissionSig ||
    !certUrl ||
    !authAlgo
  ) {
    throw new Error(
      "Required PayPal signature headers are missing.",
    );
  }

  if (authAlgo !== "SHA256withRSA") {
    throw new Error(
      `Unsupported PayPal signature algorithm: ${authAlgo}`,
    );
  }

  const certificate =
    await downloadPayPalCertificate(certUrl);

  // PayPal requires the CRC32 of the ORIGINAL raw body.
  // Do not parse and re-serialize the JSON for this calculation.
  const rawBuffer = Buffer.from(rawBody, "utf8");

  const crc32 = calculateCrc32(rawBuffer);

  const signedMessage = [
    transmissionId,
    transmissionTime,
    webhookId,
    String(crc32),
  ].join("|");

  const verifier = createVerify("RSA-SHA256");

  verifier.update(signedMessage, "utf8");
  verifier.end();

  const signatureBuffer = Buffer.from(
    transmissionSig,
    "base64",
  );

  return verifier.verify(
    certificate,
    signatureBuffer,
  );
}

async function verifyPayPalSignature(
  request: NextRequest,
  rawBody: string,
): Promise<VerificationResult | null> {
  const configuredWebhookId =
    process.env.PAYPAL_WEBHOOK_ID;

  if (!configuredWebhookId) {
    throw new Error(
      "PAYPAL_WEBHOOK_ID is not configured.",
    );
  }

  // First verify against the actual registered webhook ID.
  const realSignatureValid =
    await verifyPayPalSignatureWithId(
      request,
      rawBody,
      configuredWebhookId,
    );

  if (realSignatureValid) {
    return "REAL_PAYPAL";
  }

  // PayPal simulator messages use the special WEBHOOK_ID.
  // Only a valid cryptographic signature using that ID
  // can qualify an event as a simulator event.
  const simulatorSignatureValid =
    await verifyPayPalSignatureWithId(
      request,
      rawBody,
      "WEBHOOK_ID",
    );

  if (simulatorSignatureValid) {
    return "SIMULATOR";
  }

  return null;
}

// --------------------------------------------------
// PAYPAL CAPTURE LOOKUP
// --------------------------------------------------

async function getCaptureDetails(
  captureId: string,
  accessToken: string,
): Promise<JsonRecord> {
  const response = await fetch(
    `${PAYPAL_API}/v2/payments/captures/${encodeURIComponent(captureId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    console.error(
      "PayPal capture lookup failed:",
      response.status,
      await response.text(),
    );

    throw new Error(
      "Could not retrieve PayPal capture details.",
    );
  }

  return response.json();
}

// --------------------------------------------------
// REFUND CAPTURE ID EXTRACTION
// --------------------------------------------------

function getRefundCaptureId(
  resource: JsonRecord,
): string {
  const links = Array.isArray(resource.links)
    ? resource.links
    : [];

  const parentLink = links.find(
    (link: JsonRecord) => link.rel === "up",
  );

  const href = String(
    parentLink?.href ?? "",
  );

  if (!href) {
    throw new Error(
      "PayPal refund event does not contain its original capture link.",
    );
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(href);
  } catch {
    throw new Error(
      "PayPal refund capture link is invalid.",
    );
  }

  const allowedHosts = [
    "api-m.sandbox.paypal.com",
    "api.sandbox.paypal.com",
  ];

  if (
    parsedUrl.protocol !== "https:" ||
    !allowedHosts.includes(parsedUrl.hostname)
  ) {
    throw new Error(
      "PayPal refund link contains an unexpected API host.",
    );
  }

  const match = parsedUrl.pathname.match(
    /^\/v2\/payments\/captures\/([^/]+)$/,
  );

  if (!match) {
    throw new Error(
      "Could not extract the original capture ID from the refund link.",
    );
  }

  return decodeURIComponent(match[1]);
}

// --------------------------------------------------
// SUPABASE ORDER LEDGER
// --------------------------------------------------

async function readLedgerOrder(
  config: SupabaseConfig,
  orderId: string,
): Promise<LedgerOrder> {
  const response = await fetch(
    `${config.url}/rest/v1/payagent_orders?paypal_order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=2`,
    {
      headers: supabaseHeaders(config),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    console.error(
      "Ledger lookup failed:",
      response.status,
      await response.text(),
    );

    throw new Error(
      "Could not retrieve the PayAgent order ledger.",
    );
  }

  const rows =
    (await response.json()) as LedgerOrder[];

  if (rows.length !== 1) {
    throw new Error(
      rows.length === 0
        ? "The PayPal order does not exist in the PayAgent ledger."
        : "Duplicate PayAgent ledger records exist for this order.",
    );
  }

  return rows[0];
}

// --------------------------------------------------
// WEBHOOK EVENT REGISTRATION
// --------------------------------------------------

async function registerWebhookEvent(
  config: SupabaseConfig,
  event: JsonRecord,
  summary: JsonRecord,
): Promise<WebhookRegistration> {
  const eventId = String(event.id ?? "");
  const eventType = String(
    event.event_type ?? "",
  );

  if (!eventId || !eventType) {
    throw new Error(
      "PayPal webhook event ID or type is missing.",
    );
  }

  const response = await fetch(
    `${config.url}/rest/v1/payagent_paypal_webhook_events?on_conflict=paypal_event_id`,
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(config),
        Prefer:
          "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify({
        paypal_event_id: eventId,
        event_type: eventType,
        resource_id: summary.resource_id ?? null,
        paypal_order_id:
          summary.paypal_order_id ?? null,
        status: "PROCESSING",
        event_summary: summary,
        updated_at: new Date().toISOString(),
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    console.error(
      "Webhook event registration failed:",
      response.status,
      await response.text(),
    );

    throw new Error(
      "Could not register the PayPal webhook event.",
    );
  }

  const inserted =
    (await response.json()) as Array<{
      id: string;
    }>;

  if (inserted.length > 0) {
    return "new";
  }

  const existingResponse = await fetch(
    `${config.url}/rest/v1/payagent_paypal_webhook_events?paypal_event_id=eq.${encodeURIComponent(eventId)}&select=status,updated_at`,
    {
      headers: supabaseHeaders(config),
      cache: "no-store",
    },
  );

  if (!existingResponse.ok) {
    throw new Error(
      "Could not check the existing webhook event.",
    );
  }

  const existing =
    (await existingResponse.json()) as Array<{
      status: string;
      updated_at: string;
    }>;

  if (existing.length !== 1) {
    throw new Error(
      "Could not uniquely identify the existing webhook event.",
    );
  }

  const current = existing[0];

  if (current.status === "PROCESSED") {
    return "duplicate";
  }

  if (current.status === "PROCESSING") {
    // Recover an abandoned processing attempt after five minutes.
    const staleBefore = new Date(
      Date.now() - 5 * 60 * 1000,
    ).toISOString();

    const recoveryResponse = await fetch(
      `${config.url}/rest/v1/payagent_paypal_webhook_events?paypal_event_id=eq.${encodeURIComponent(eventId)}&status=eq.PROCESSING&updated_at=lt.${encodeURIComponent(staleBefore)}`,
      {
        method: "PATCH",
        headers: {
          ...supabaseHeaders(config),
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          status: "PROCESSING",
          error_message: null,
          updated_at: new Date().toISOString(),
        }),
        cache: "no-store",
      },
    );

    if (!recoveryResponse.ok) {
      throw new Error(
        "Could not recover the stalled webhook event.",
      );
    }

    const recovered =
      (await recoveryResponse.json()) as Array<{
        id: string;
      }>;

    return recovered.length > 0
      ? "retry"
      : "duplicate";
  }

  // Atomically claim a RECEIVED or FAILED event.
  const retryResponse = await fetch(
    `${config.url}/rest/v1/payagent_paypal_webhook_events?paypal_event_id=eq.${encodeURIComponent(eventId)}&status=in.(RECEIVED,FAILED)`,
    {
      method: "PATCH",
      headers: {
        ...supabaseHeaders(config),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        status: "PROCESSING",
        error_message: null,
        updated_at: new Date().toISOString(),
      }),
      cache: "no-store",
    },
  );

  if (!retryResponse.ok) {
    throw new Error(
      "Could not claim the webhook event for retry.",
    );
  }

  const claimed =
    (await retryResponse.json()) as Array<{
      id: string;
    }>;

  return claimed.length > 0
    ? "retry"
    : "duplicate";
}

// --------------------------------------------------
// WEBHOOK EVENT STATUS
// --------------------------------------------------

async function updateWebhookEvent(
  config: SupabaseConfig,
  eventId: string,
  status: "PROCESSED" | "FAILED",
  errorMessage?: string,
): Promise<void> {
  const body: JsonRecord = {
    status,
    error_message: errorMessage ?? null,
    updated_at: new Date().toISOString(),
  };

  if (status === "PROCESSED") {
    body.processed_at = new Date().toISOString();
  }

  const response = await fetch(
    `${config.url}/rest/v1/payagent_paypal_webhook_events?paypal_event_id=eq.${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        ...supabaseHeaders(config),
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    console.error(
      "Webhook event status update failed:",
      response.status,
      await response.text(),
    );

    throw new Error(
      "Could not update the PayPal webhook event.",
    );
  }
}

// --------------------------------------------------
// PAYMENT STATUS MAPPING
// --------------------------------------------------

function getPaymentUpdate(
  eventType: string,
  captureStatus: string,
): {
  paypal_status: string;
  payment_status: string;
} | null {
  switch (eventType) {
    case "PAYMENT.CAPTURE.COMPLETED":
      return {
        paypal_status: "COMPLETED",
        payment_status: "COMPLETED",
      };

    case "PAYMENT.CAPTURE.DENIED":
      return {
        paypal_status: "DENIED",
        payment_status: "DECLINED",
      };

    case "PAYMENT.CAPTURE.PENDING":
      return {
        paypal_status: "PENDING",
        payment_status: "PENDING",
      };

    case "PAYMENT.CAPTURE.REFUNDED":
      if (
        captureStatus === "PARTIALLY_REFUNDED"
      ) {
        return null;
      }

      if (captureStatus !== "REFUNDED") {
        throw new Error(
          `Unexpected capture status for refund event: ${captureStatus}`,
        );
      }

      return {
        paypal_status: "REFUNDED",
        payment_status: "REFUNDED",
      };

    default:
      return null;
  }
}

// --------------------------------------------------
// UPDATE PAYMENT LEDGER
// --------------------------------------------------

async function updatePaymentLedger(
  config: SupabaseConfig,
  order: LedgerOrder,
  eventType: string,
  captureStatus: string,
): Promise<void> {
  const update = getPaymentUpdate(
    eventType,
    captureStatus,
  );

  if (!update) {
    return;
  }

  const currentStatus = String(
    order.payment_status,
  ).toUpperCase();

  const nextStatus = update.payment_status;

  if (
    currentStatus === "REFUNDED" &&
    nextStatus !== "REFUNDED"
  ) {
    return;
  }

  if (
    currentStatus === "COMPLETED" &&
    ["PENDING", "DECLINED"].includes(nextStatus)
  ) {
    return;
  }

  const response = await fetch(
    `${config.url}/rest/v1/payagent_orders?id=eq.${encodeURIComponent(order.id)}`,
    {
      method: "PATCH",
      headers: {
        ...supabaseHeaders(config),
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        paypal_status: update.paypal_status,
        payment_status: update.payment_status,
        updated_at: new Date().toISOString(),
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    console.error(
      "Payment ledger update failed:",
      response.status,
      await response.text(),
    );

    throw new Error(
      "Could not update the PayAgent payment ledger.",
    );
  }
}

// --------------------------------------------------
// REAL PAYPAL WEBHOOK AUDIT
// --------------------------------------------------

async function writeWebhookAudit(
  config: SupabaseConfig,
  order: LedgerOrder,
  event: JsonRecord,
  requestId: string,
  captureId: string,
  captureStatus: string,
): Promise<void> {
  const paymentUpdate = getPaymentUpdate(
    String(event.event_type),
    captureStatus,
  );

  const response = await fetch(
    `${config.url}/rest/v1/agent_activity_logs`,
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(config),
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        event_type: "paypal_webhook",
        status: "success",
        request_id: requestId,
        session_id: order.session_id,
        filters: {},
        metadata: {
          paypal_event_id: event.id,
          paypal_event_type: event.event_type,
          paypal_order_id: order.paypal_order_id,
          capture_id: captureId,
          capture_status: captureStatus,
          product_name: order.product_name,
          merchant_domain: order.merchant_domain,
          amount: order.amount,
          currency: order.currency,
          payment_status:
            paymentUpdate?.payment_status ??
            order.payment_status,
        },
        created_at: new Date().toISOString(),
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    console.error(
      "Webhook audit insertion failed:",
      response.status,
      await response.text(),
    );

    throw new Error(
      "Could not write the PayPal webhook audit record.",
    );
  }
}

// --------------------------------------------------
// SIMULATOR AUDIT
// --------------------------------------------------

async function writeSimulatorAudit(
  config: SupabaseConfig,
  event: JsonRecord,
  requestId: string,
): Promise<void> {
  const resource = (
    event.resource ?? {}
  ) as JsonRecord;

  const response = await fetch(
    `${config.url}/rest/v1/agent_activity_logs`,
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(config),
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        event_type: "paypal_webhook_simulator",
        status: "success",
        request_id: requestId,
        filters: {},
        metadata: {
          paypal_event_id: event.id,
          paypal_event_type: event.event_type,
          simulator: true,
          resource_id: resource.id ?? null,
          summary: event.summary ?? null,
          note:
            "Verified PayPal simulator event. No payment ledger was changed.",
        },
        created_at: new Date().toISOString(),
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    console.error(
      "Simulator audit insertion failed:",
      response.status,
      await response.text(),
    );

    throw new Error(
      "Could not write the simulator audit record.",
    );
  }
}

// --------------------------------------------------
// MAIN WEBHOOK HANDLER
// --------------------------------------------------

export async function POST(
  request: NextRequest,
) {
  let config: SupabaseConfig | null = null;
  let eventId = "";
  let eventRegistered = false;

  const requestId = randomUUID();

  try {
    config = getSupabaseConfig();

    // Preserve the exact original body for CRC32 verification.
    const rawBody = await request.text();

    if (!rawBody) {
      return NextResponse.json(
        {
          error: "Empty PayPal webhook body.",
        },
        { status: 400 },
      );
    }

    let event: JsonRecord;

    try {
      event = JSON.parse(rawBody) as JsonRecord;
    } catch {
      return NextResponse.json(
        {
          error: "Invalid PayPal webhook JSON.",
        },
        { status: 400 },
      );
    }

    eventId = String(event.id ?? "");

    const eventType = String(
      event.event_type ?? "",
    );

    const resource = (
      event.resource ?? {}
    ) as JsonRecord;

    if (!eventId || !eventType) {
      return NextResponse.json(
        {
          error: "Invalid PayPal webhook event.",
        },
        { status: 400 },
      );
    }

    // ------------------------------------------------
    // VERIFY SIGNATURE
    // ------------------------------------------------

    const verification =
      await verifyPayPalSignature(
        request,
        rawBody,
      );

    if (!verification) {
      return NextResponse.json(
        {
          error:
            "PayPal webhook signature verification failed.",
        },
        { status: 401 },
      );
    }

    // ------------------------------------------------
    // SIMULATOR EVENT
    // ------------------------------------------------

    if (verification === "SIMULATOR") {
      const summary = {
        resource_id: resource.id ?? null,
        paypal_order_id: null,
        simulator: true,
      };

      const registration =
        await registerWebhookEvent(
          config,
          event,
          summary,
        );

      if (registration === "duplicate") {
        return NextResponse.json({
          received: true,
          duplicate: true,
          simulator: true,
          eventId,
        });
      }

      eventRegistered = true;

      await writeSimulatorAudit(
        config,
        event,
        requestId,
      );

      await updateWebhookEvent(
        config,
        eventId,
        "PROCESSED",
      );

      eventRegistered = false;

      return NextResponse.json({
        received: true,
        verified: true,
        simulator: true,
        processed: true,
        eventId,
        eventType,
        ledgerUpdated: false,
      });
    }

    // ------------------------------------------------
    // REAL PAYPAL EVENT
    // ------------------------------------------------

    const accessToken =
      await getPayPalAccessToken();

    const relatedIds = (
      resource.supplementary_data?.related_ids ?? {}
    ) as JsonRecord;

    // Ignore unsupported event types safely.
    if (!SUPPORTED_EVENTS.includes(eventType)) {
      const summary = {
        resource_id: resource.id ?? null,
        paypal_order_id:
          relatedIds.order_id ?? null,
        ignored: true,
      };

      const registration =
        await registerWebhookEvent(
          config,
          event,
          summary,
        );

      if (registration === "duplicate") {
        return NextResponse.json({
          received: true,
          duplicate: true,
          eventId,
        });
      }

      eventRegistered = true;

      await updateWebhookEvent(
        config,
        eventId,
        "PROCESSED",
      );

      eventRegistered = false;

      return NextResponse.json({
        received: true,
        ignored: true,
        eventType,
      });
    }

    // ------------------------------------------------
    // IDENTIFY ORIGINAL CAPTURE
    // ------------------------------------------------

    let captureId = "";

    if (
      eventType === "PAYMENT.CAPTURE.REFUNDED"
    ) {
      captureId = getRefundCaptureId(resource);
    } else {
      captureId = String(
        relatedIds.capture_id ??
        resource.id ??
        "",
      );
    }

    if (!captureId) {
      throw new Error(
        "PayPal event did not contain a capture ID.",
      );
    }

    const capture = await getCaptureDetails(
      captureId,
      accessToken,
    );

    // ------------------------------------------------
    // IDENTIFY PAYPAL ORDER
    // ------------------------------------------------

    const orderId = String(
      relatedIds.order_id ??
      capture.supplementary_data?.related_ids
        ?.order_id ??
      "",
    );

    if (!orderId) {
      throw new Error(
        "Could not identify the PayPal order associated with this capture.",
      );
    }

    const order = await readLedgerOrder(
      config,
      orderId,
    );

    // ------------------------------------------------
    // VERIFY AMOUNT AND CURRENCY
    // ------------------------------------------------

    if (
      capture.amount?.currency_code !==
        order.currency ||
      !capture.amount?.value ||
      Number(capture.amount.value).toFixed(2) !==
        Number(order.amount).toFixed(2)
    ) {
      throw new Error(
        "PayPal capture amount or currency does not match the PayAgent ledger.",
      );
    }

    const captureStatus = String(
      capture.status ?? "",
    );

    // ------------------------------------------------
    // REGISTER WEBHOOK EVENT
    // ------------------------------------------------

    const summary = {
      resource_id: resource.id ?? captureId,
      paypal_order_id: orderId,
      capture_id: captureId,
      capture_status: captureStatus,
      amount: capture.amount.value,
      currency: capture.amount.currency_code,
    };

    const registration =
      await registerWebhookEvent(
        config,
        event,
        summary,
      );

    if (registration === "duplicate") {
      return NextResponse.json({
        received: true,
        duplicate: true,
        eventId,
      });
    }

    eventRegistered = true;

    // ------------------------------------------------
    // UPDATE PAYMENT LEDGER
    // ------------------------------------------------

    await updatePaymentLedger(
      config,
      order,
      eventType,
      captureStatus,
    );

    // ------------------------------------------------
    // WRITE AUDIT LOG
    // ------------------------------------------------

    await writeWebhookAudit(
      config,
      order,
      event,
      requestId,
      captureId,
      captureStatus,
    );

    // ------------------------------------------------
    // MARK EVENT PROCESSED
    // ------------------------------------------------

    await updateWebhookEvent(
      config,
      eventId,
      "PROCESSED",
    );

    eventRegistered = false;

    return NextResponse.json({
      received: true,
      verified: true,
      processed: true,
      simulator: false,
      eventId,
      eventType,
      orderId,
      captureId,
      captureStatus,
      paymentStatus:
        getPaymentUpdate(
          eventType,
          captureStatus,
        )?.payment_status ??
        order.payment_status,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected PayPal webhook error.";

    console.error(
      "PayAgent PayPal webhook error:",
      message,
    );

    if (
      config &&
      eventId &&
      eventRegistered
    ) {
      try {
        await updateWebhookEvent(
          config,
          eventId,
          "FAILED",
          message,
        );
      } catch (updateError) {
        console.error(
          "Could not record webhook failure:",
          updateError,
        );
      }
    }

    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
}
