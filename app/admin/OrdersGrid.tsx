"use client";

import { useMemo, useState } from "react";
import {
  AllCommunityModule,
  colorSchemeDark,
  type ColDef,
  type ICellRendererParams,
  themeQuartz,
} from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";

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

const modules = [AllCommunityModule];

const gridTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: "#191919",
  foregroundColor: "#e5e5e5",
  headerBackgroundColor: "#202020",
  headerTextColor: "#a3a3a3",
  borderColor: "rgba(255,255,255,0.08)",
  accentColor: "#60a5fa",
  fontSize: 12,
  headerFontSize: 11,
  spacing: 8,
});

export default function OrdersGrid({ orders }: { orders: Order[] }) {
  const [quickFilter, setQuickFilter] = useState("");

  const columnDefs = useMemo<ColDef<Order>[]>(
    () => [
      {
        field: "product_name",
        headerName: "Product",
        minWidth: 210,
        flex: 2,
        tooltipField: "product_name",
        filter: "agTextColumnFilter",
      },
      {
        field: "merchant_domain",
        headerName: "Merchant",
        minWidth: 140,
        flex: 1,
        filter: "agTextColumnFilter",
      },
      {
        field: "amount",
        headerName: "Amount",
        minWidth: 125,
        filter: "agNumberColumnFilter",
        valueFormatter: (params) =>
          formatMoney(
            Number(params.value ?? 0),
            params.data?.currency ?? "USD",
          ),
      },
      {
        field: "payment_status",
        headerName: "Payment",
        minWidth: 145,
        filter: "agTextColumnFilter",
        cellRenderer: (params: ICellRendererParams<Order, string>) => (
          <StatusBadge value={params.value ?? "UNKNOWN"} />
        ),
      },
      {
        field: "paypal_order_id",
        headerName: "PayPal order",
        minWidth: 175,
        flex: 1,
        filter: "agTextColumnFilter",
        valueFormatter: (params) => {
          const value = params.value;
          if (!value) return "—";
          return value.length > 20
            ? `${value.slice(0, 17)}...`
            : value;
        },
      },
      {
        field: "created_at",
        headerName: "Created",
        minWidth: 175,
        filter: "agDateColumnFilter",
        valueFormatter: (params) => formatDate(params.value),
        comparator: (a, b) =>
          new Date(a).getTime() - new Date(b).getTime(),
      },
    ],
    [],
  );

  const defaultColDef = useMemo<ColDef<Order>>(
    () => ({
      sortable: true,
      resizable: true,
      filter: true,
      floatingFilter: true,
      suppressHeaderMenuButton: false,
    }),
    [],
  );

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
        <div>
          <h3 className="text-sm font-medium text-white/80">
            Transaction records
          </h3>
          <p className="mt-1 text-xs text-white/35">
            Search, sort and filter your PayAgent orders.
          </p>
        </div>

        <input
          type="search"
          value={quickFilter}
          onChange={(event) => setQuickFilter(event.target.value)}
          placeholder="Search transactions..."
          aria-label="Search transactions"
          className="h-9 w-full max-w-xs rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-white outline-none placeholder:text-white/30 focus:border-white/30"
        />
      </div>

      <div className="w-full" style={{ height: 520 }}>
        <AgGridProvider modules={modules}>
          <AgGridReact<Order>
            theme={gridTheme}
            rowData={orders}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            quickFilterText={quickFilter}
            pagination
            paginationPageSize={10}
            paginationPageSizeSelector={[10, 20, 50]}
            animateRows
            rowHeight={54}
            headerHeight={44}
            floatingFiltersHeight={38}
            getRowId={(params) => params.data.id}
            overlayNoRowsTemplate='<span class="text-sm text-gray-400">No orders found</span>'
          />
        </AgGridProvider>
      </div>

      <div className="border-t border-white/[0.07] px-5 py-3 text-[11px] text-white/35">
        {orders.length} orders loaded · Read-only transaction data
      </div>
    </div>
  );
}
