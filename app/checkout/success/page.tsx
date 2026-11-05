"use client";

import { useEffect, useRef, useState } from "react";

type CaptureResult = {
  success?: boolean;
  alreadyCaptured?: boolean;
  orderId?: string;
  paymentStatus?: string;
  paypalStatus?: string;
  amount?: string;
  currency?: string;
  message?: string;
  error?: string;
};

export default function CheckoutSuccessPage() {
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [result, setResult] = useState<CaptureResult | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = new URLSearchParams(window.location.search).get("token");

    if (!token) {
      setStatus("error");
      setResult({ error: "PayPal did not return an order ID. No payment was captured." });
      return;
    }

    const capturePayment = async () => {
      try {
        const response = await fetch("/api/paypal/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: token }),
        });
        const data = (await response.json()) as CaptureResult;
        setResult(data);
        setStatus(response.ok && data.success ? "success" : "error");
      } catch {
        setResult({
          error: "We could not reach the payment server. Check your order status before trying again.",
        });
        setStatus("error");
      }
    };

    void capturePayment();
  }, []);

  return (
    <main className="min-h-screen bg-[#07090e] text-slate-100 flex items-center justify-center px-5 py-12">
      <section className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0c0f17] p-8 shadow-2xl">
        {status === "processing" && (
          <>
            <div className="mb-5 h-10 w-10 animate-spin rounded-full border-4 border-cyan-400/20 border-t-cyan-400" />
            <h1 className="text-2xl font-semibold">Confirming your payment</h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              PayPal approval is not the same as a completed payment. We are securely
              asking PayPal to capture the order and verify the result.
            </p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-2xl text-emerald-400">
              ✓
            </div>
            <h1 className="text-2xl font-semibold">Payment confirmed</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {result?.message ?? "PayPal confirmed your payment."}
            </p>
            {result?.amount && (
              <p className="mt-4 text-lg font-semibold">
                {result.amount} {result.currency}
              </p>
            )}
            {result?.orderId && (
              <p className="mt-3 break-all text-xs text-slate-500">
                PayPal order: {result.orderId}
              </p>
            )}
            <a
              href="/"
              className="mt-7 inline-flex rounded-lg bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
            >
              Return to PayAgent
            </a>
          </>
        )}

        {status === "error" && (
          <>
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-2xl text-amber-300">
              !
            </div>
            <h1 className="text-2xl font-semibold">Payment not confirmed</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {result?.error ?? "We could not confirm the payment."}
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              Do not create another order or retry payment until you have checked the
              existing PayPal order and PayAgent ledger.
            </p>
            {result?.orderId && (
              <p className="mt-3 break-all text-xs text-slate-500">
                PayPal order: {result.orderId}
              </p>
            )}
            <a
              href="/"
              className="mt-7 inline-flex rounded-lg border border-white/15 px-5 py-3 text-sm font-medium hover:bg-white/5"
            >
              Return to PayAgent
            </a>
          </>
        )}
      </section>
    </main>
  );
}
