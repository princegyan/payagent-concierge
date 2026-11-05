import Link from "next/link";

export default function CheckoutCancelPage() {
  return (
    <main className="min-h-screen bg-[#07090e] text-slate-100 flex items-center justify-center px-5 py-12">
      <section className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0c0f17] p-8 shadow-2xl">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-2xl text-amber-300">
          !
        </div>
        <h1 className="text-2xl font-semibold">Checkout cancelled</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          You returned from PayPal without completing checkout. No payment has been
          captured by this cancellation page.
        </p>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          If you approved the order before returning here, check its status in PayPal
          and the PayAgent ledger before attempting another payment.
        </p>
        <Link
          href="/"
          className="mt-7 inline-flex rounded-lg border border-white/15 px-5 py-3 text-sm font-medium hover:bg-white/5"
        >
          Return to PayAgent
        </Link>
      </section>
    </main>
  );
}
