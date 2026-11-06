"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { BryntumSchedulerProps } from "@bryntum/scheduler-react-community";

type Order = {
  id: string;
  product_name: string;
  merchant_domain: string;
  amount: number;
  currency: string;
  paypal_order_id: string;
  paypal_status: string;
  payment_status: string;
  created_at: string;
  updated_at?: string | null;
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
  paypal_order_id?: string | null;
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

type PaymentTimelineProps = {
  orders: Order[];
  activity: ActivityRecord[];
  webhooks: WebhookRecord[];
  startAt?: string | null;
  endAt?: string | null;
};

type TimelineResource = {
  id: string;
  name: string;
};

type TimelineEvent = {
  id: string;
  name: string;
  resourceId: string;
  startDate: string;
  duration: number;
  durationUnit: "minute";
  eventColor: string;
  readOnly: boolean;
  draggable: boolean;
  resizable: boolean;
};

const BryntumScheduler = dynamic(
  () =>
    import("@bryntum/scheduler-react-community").then(
      (module) => module.BryntumScheduler,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[460px] items-center justify-center text-sm text-white/40">
        Loading payment timeline...
      </div>
    ),
  },
);

function validDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shortId(value?: string | null): string {
  if (!value) return "";
  return value.length > 14 ? `${value.slice(0, 11)}...` : value;
}

function statusColor(status?: string | null): string {
  const value = (status || "").toUpperCase();

  if (["COMPLETED", "PROCESSED", "SUCCESS", "CAPTURED"].includes(value)) {
    return "green";
  }
  if (["FAILED", "DECLINED", "DENIED", "ERROR"].includes(value)) {
    return "red";
  }
  if (
    ["PENDING", "PROCESSING", "RECEIVED", "CREATED", "NOT_CAPTURED"].includes(
      value,
    )
  ) {
    return "orange";
  }
  return "blue";
}

function readableEventName(value?: string | null): string {
  return (value || "Activity")
    .replaceAll("_", " ")
    .replaceAll(".", " · ");
}

export default function PaymentTimeline({
  orders,
  activity,
  webhooks,
  startAt,
  endAt,
}: PaymentTimelineProps) {
  const timeline = useMemo(() => {
    const resources: TimelineResource[] = [];
    const events: TimelineEvent[] = [];
    const orderLabels = new Map<string, string>();
    const dates: Date[] = [];

    const addDate = (value?: string | null) => {
      const date = validDate(value);
      if (date) dates.push(date);
      return date;
    };

    // Each recorded event gets its own scheduler row. Bryntum milestone labels
    // otherwise overlap when several zero-duration events share one order row.
    const addEvent = (
      id: string,
      rowLabel: string,
      eventLabel: string,
      timestamp?: string | null,
      color = "blue",
    ) => {
      const date = addDate(timestamp);
      if (!date) return;

      const resourceId = `event-row-${id}`;
      resources.push({
        id: resourceId,
        name: rowLabel,
      });

      events.push({
        id,
        name: eventLabel,
        resourceId,
        startDate: date.toISOString(),
        duration: 0,
        durationUnit: "minute",
        eventColor: color,
        readOnly: true,
        draggable: false,
        resizable: false,
      });
    };

    orders.forEach((order) => {
      const product = order.product_name || "Order";
      const orderRef = shortId(order.paypal_order_id);
      const rowPrefix = orderRef ? `${product} · ${orderRef}` : product;

      if (order.paypal_order_id) {
        orderLabels.set(order.paypal_order_id, rowPrefix);
      }

      addEvent(
        `order-created-${order.id}`,
        `${rowPrefix} — Created`,
        "Created",
        order.created_at,
        statusColor(order.payment_status),
      );

      const created = validDate(order.created_at);
      const updated = validDate(order.updated_at);

      if (updated && (!created || updated.getTime() > created.getTime())) {
        addEvent(
          `order-updated-${order.id}`,
          `${rowPrefix} — Updated`,
          "Updated",
          order.updated_at,
          statusColor(order.payment_status),
        );
      }
    });

    activity.forEach((item) => {
      const orderLabel = item.paypal_order_id
        ? orderLabels.get(item.paypal_order_id)
        : undefined;
      const eventType = readableEventName(item.event_type);
      const rowPrefix = orderLabel || "Unmatched agent activity";

      addEvent(
        `activity-${item.id}`,
        `${rowPrefix} — ${eventType}`,
        "Activity",
        item.created_at,
        statusColor(item.status),
      );
    });

    webhooks.forEach((item) => {
      const orderLabel = item.paypal_order_id
        ? orderLabels.get(item.paypal_order_id)
        : undefined;
      const rowPrefix = orderLabel || "Unmatched PayPal webhook";

      addEvent(
        `webhook-received-${item.id}`,
        `${rowPrefix} — Webhook received`,
        "Received",
        item.received_at,
        "orange",
      );

      if (item.processed_at) {
        addEvent(
          `webhook-processed-${item.id}`,
          `${rowPrefix} — Webhook ${item.status.toLowerCase()}`,
          item.status.toUpperCase() === "PROCESSED" ? "Processed" : "Updated",
          item.processed_at,
          statusColor(item.status),
        );
      }
    });

    const requestedStart = validDate(startAt);
    const requestedEnd = validDate(endAt);

    const earliest = dates.length
      ? new Date(Math.min(...dates.map((date) => date.getTime())))
      : new Date();

    const latest = dates.length
      ? new Date(Math.max(...dates.map((date) => date.getTime())))
      : new Date();

    const rangeStart =
      requestedStart ||
      new Date(earliest.getTime() - 12 * 60 * 60 * 1000);

    const rangeEnd =
      requestedEnd ||
      new Date(latest.getTime() + 12 * 60 * 60 * 1000);

    if (rangeEnd.getTime() <= rangeStart.getTime()) {
      rangeEnd.setTime(rangeStart.getTime() + 24 * 60 * 60 * 1000);
    }

    return {
      resources,
      events,
      startDate: rangeStart,
      endDate: rangeEnd,
    };
  }, [orders, activity, webhooks, startAt, endAt]);

  const schedulerProps: BryntumSchedulerProps = {
    resources: timeline.resources,
    events: timeline.events,
    startDate: timeline.startDate,
    endDate: timeline.endDate,
    viewPreset: "dayAndWeek",
    columns: [
      {
        text: "Recorded event",
        field: "name",
        width: 340,
      },
    ],
    rowHeight: 62,
    barMargin: 8,
    resourceMargin: 8,
    eventStyle: "rounded",
    readOnly: true,
    eventDragFeature: false,
    eventDragCreateFeature: false,
    eventResizeFeature: false,
    eventEditFeature: false,
    eventMenuFeature: false,
    scheduleMenuFeature: false,
    resourceMenuFeature: false,
    height: 560,
  };

  return (
    <div className="space-y-4 p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">
            Payment lifecycle
          </h3>
          <p className="mt-1 text-xs text-white/40">
            Each recorded event has its own row to keep timestamps and labels readable.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[10px] text-white/55">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Successful
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            Pending / received
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-400" />
            Failed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-blue-400" />
            Other activity
          </span>
        </div>
      </div>

      {timeline.events.length === 0 ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-white/[0.08] bg-black/10 text-center">
          <p className="text-sm text-white/55">No timeline events available</p>
          <p className="mt-2 text-xs text-white/30">
            Recorded events will appear here when available.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white">
          <BryntumScheduler {...schedulerProps} />
        </div>
      )}

      <p className="text-[10px] text-white/35">
        {timeline.events.length} recorded events · {timeline.resources.length} event rows · Read-only
      </p>
    </div>
  );
}
