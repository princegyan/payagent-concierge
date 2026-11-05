"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Image as ImageIcon,
  Menu,
  MessageSquarePlus,
  PackageSearch,
  PanelLeftClose,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";

type Role = "user" | "assistant";

type ProductOffer = {
  url?: string | null;
  domain?: string | null;
  availability?: string | null;
  condition?: string | null;
  price?: {
    price?: number | string | null;
    currency?: string;
    compare_at_price?: number | string | null;
  };
};

type SelectedProductOffer = {
  product_id: string;
  title: string;
  offer_domain: string;
};

type ProductImage = {
  url?: string;
  cleaned_url?: string | null;
  is_main_image?: boolean;
  alt_text?: string;
};

type ChannelProduct = {
  id?: string;
  title?: string;
  description?: string;
  brands?: Array<{ id?: string; name?: string }>;
  images?: ProductImage[];
  image_url?: string;
  image?: string;
  offers?: ProductOffer[];
  price?: number | string;
  currency?: string;
  category?: { title?: string; slug?: string };
  key_features?: string[];
};

type ComparisonOffer = {
  product_id: string;
  product_title: string;
  merchant: string;
  domain: string;
  price: number;
  currency: string;
  availability: string | null;
  url: string | null;
};

type MerchantComparison = {
  requested_merchants: string[];
  merchant_summaries: Array<{
    merchant: string;
    product_count: number;
    offer_count: number;
    currency_breakdown: Array<{
      currency: string;
      offer_count: number;
      lowest_offer: ComparisonOffer | null;
      lowest_available_offer: ComparisonOffer | null;
    }>;
  }>;
  same_product_comparisons: Array<{
    product_id: string;
    product_title: string;
    offers: ComparisonOffer[];
  }>;
  best_overall_offer: ComparisonOffer | null;
  best_overall_currency: string | null;
  note: string;
};

type AppliedSearchFilters = {
  max_price: number | null;
  currency: string;
  merchant_filters: string[];
  required_features: string[];
  sort_by: "price_asc" | "price_desc";
};

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  products?: ChannelProduct[];
  comparison?: MerchantComparison;
  appliedFilters?: AppliedSearchFilters;
  searchQuery?: string;
  approveUrl?: string;
  executedTools?: string[];
  duration?: number | string;
  error?: boolean;
};

type ApiResponse = Record<string, unknown>;

function createClientSessionId(): string {
  // Session IDs are correlation identifiers, not authentication credentials.
  // Generate them only from event handlers (never during render/prerender).
  // Math.random avoids browser crypto APIs that Next.js may flag during prerender.
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hi! I’m PayAgent. Tell me what you’re looking for and I’ll search products, compare offers, and help prepare a secure PayPal checkout.\n\nTry asking me to find a mechanical keyboard under $60.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function extractProducts(payload: ApiResponse): ChannelProduct[] {
  // Accept the common response shapes used by the chat controller and Channel3 tool.
  const candidates = [
    ["products"],
    ["search_results", "products"],
    ["result", "products"],
    ["channel3", "products"],
    ["channel3_result", "products"],
    ["tool_results", "channel3_search", "products"],
    ["data", "products"],
  ];

  for (const path of candidates) {
    const value = readPath(payload, path);
    if (Array.isArray(value)) return value as ChannelProduct[];
  }
  return [];
}

function extractApprovalUrl(payload: ApiResponse, messageText: string): string | undefined {
  const directCandidates = [
    payload.approveUrl,
    payload.approval_url,
    payload.approve_url,
    readPath(payload, ["paypal", "approval_url"]),
    readPath(payload, ["order", "approval_url"]),
    readPath(payload, ["order", "approve_url"]),
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.startsWith("https://")) return candidate;
  }

  const links = readPath(payload, ["order", "links"]);
  if (Array.isArray(links)) {
    const approval = links.find(
      (link) => isRecord(link) && (link.rel === "approve" || link.rel === "payer-action"),
    );
    if (isRecord(approval) && typeof approval.href === "string") return approval.href;
  }

  const urls = messageText.match(/https?:\/\/[^\s<>"')]+/g) ?? [];
  return urls.find((url) => url.includes("paypal.com/checkoutnow"));
}

function extractMessageText(payload: ApiResponse): string {
  const candidates = [payload.message, payload.reply, payload.response, payload.output];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (isRecord(candidate) && typeof candidate.text === "string") return candidate.text;
  }
  return "I received a response, but it did not contain a readable message.";
}

function productImage(product: ChannelProduct): string | undefined {
  const images = product.images ?? [];
  const preferred = images.find((image) => image.is_main_image) ?? images[0];
  return preferred?.cleaned_url || preferred?.url || product.image_url || product.image;
}

function offerPrice(offer: ProductOffer, product: ChannelProduct): { amount?: number; currency: string } {
  // Never borrow the aggregate product price for a merchant offer with no price of its own.
  const rawAmount = offer.price?.price;
  const amount = rawAmount === undefined || rawAmount === null ? undefined : Number(rawAmount);
  return {
    amount: amount !== undefined && Number.isFinite(amount) ? amount : undefined,
    currency: offer.price?.currency || product.currency || "USD",
  };
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function MerchantComparisonPanel({ comparison }: { comparison: MerchantComparison }) {
  const best = comparison.best_overall_offer;

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#242424] p-4 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Price comparison</p>
          <h3 className="mt-1 text-base font-semibold text-white">{comparison.requested_merchants.join(" vs ")}</h3>
          <p className="mt-1 text-xs leading-5 text-white/45">Lowest returned prices by merchant, based on Channel3 offers.</p>
        </div>
        {best && (
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300/70">Best available offer</p>
            <p className="mt-0.5 text-lg font-semibold text-emerald-200">{formatPrice(best.price, best.currency)}</p>
            <p className="max-w-[220px] break-words text-[10px] text-emerald-100/60">{best.product_title} · {best.merchant}</p>
          </div>
        )}
      </div>

      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        {comparison.merchant_summaries.map((summary) => (
          <div key={summary.merchant} className="min-w-0 rounded-xl border border-white/10 bg-black/15 p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="min-w-0 break-words text-sm font-semibold text-white">{summary.merchant}</h4>
              <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-1 text-[10px] text-white/55">{summary.product_count} products</span>
            </div>
            <p className="mt-1 text-[11px] text-white/40">{summary.offer_count} matching merchant offer{summary.offer_count === 1 ? "" : "s"}</p>
            {summary.currency_breakdown.length > 0 ? (
              <div className="mt-3 space-y-3">
                {summary.currency_breakdown.map((group) => (
                  <div key={`${summary.merchant}-${group.currency}`} className="border-t border-white/8 pt-2">
                    <div className="flex items-center justify-between gap-2 text-[10px] text-white/40">
                      <span>{group.currency} · {group.offer_count} offers</span>
                      <span>Lowest listed</span>
                    </div>
                    {group.lowest_available_offer ? (
                      <>
                        <p className="mt-1 text-lg font-semibold text-white">{formatPrice(group.lowest_available_offer.price, group.lowest_available_offer.currency)}</p>
                        <p className="break-words text-xs leading-5 text-white/55">{group.lowest_available_offer.product_title}</p>
                        <p className="mt-1 text-[10px] text-emerald-300/80">{group.lowest_available_offer.domain} · {group.lowest_available_offer.availability || "Availability not specified"}</p>
                      </>
                    ) : group.lowest_offer ? (
                      <>
                        <p className="mt-1 text-lg font-semibold text-white">{formatPrice(group.lowest_offer.price, group.lowest_offer.currency)}</p>
                        <p className="break-words text-xs leading-5 text-white/55">{group.lowest_offer.product_title}</p>
                        <p className="mt-1 text-[10px] text-amber-300/80">Lowest listing, but in-stock availability was not confirmed</p>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-amber-200/70">No matching offers returned for this merchant.</p>
            )}
          </div>
        ))}
      </div>

      {comparison.same_product_comparisons.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <h4 className="text-xs font-semibold text-white/75">Same-product price matches</h4>
          <div className="mt-2 space-y-2">
            {comparison.same_product_comparisons.map((item) => (
              <div key={item.product_id} className="rounded-xl bg-black/15 p-3">
                <p className="break-words text-xs font-medium text-white/85">{item.product_title}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.offers.map((offer) => (
                    <span key={`${item.product_id}-${offer.merchant}`} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-white/65">
                      {offer.merchant}: <strong className="text-white">{formatPrice(offer.price, offer.currency)}</strong>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 text-[10px] leading-5 text-white/35">{comparison.note}</p>
    </section>
  );
}

function ProductCard({
  product,
  onDraftOrder,
}: {
  product: ChannelProduct;
  onDraftOrder: (product: ChannelProduct, offer: ProductOffer) => void;
}) {
  const imageUrl = productImage(product);
  const brand = product.brands?.map((item) => item.name).filter(Boolean).join(" · ");
  const offers = (product.offers ?? []).filter((offer) => offer.domain);

  return (
    <article className="group min-w-0 max-w-full overflow-hidden rounded-2xl border border-white/10 bg-[#242424] transition hover:border-white/20">
      <div className="relative aspect-[16/10] overflow-hidden bg-[#303030]">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={product.images?.find((image) => image.is_main_image)?.alt_text || product.title || "Product image"}
            loading="lazy"
            className="h-full w-full object-contain p-3 transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-white/30">
            <ImageIcon className="h-9 w-9" />
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-3 p-4">
        <div className="min-h-[70px]">
          {brand && <p className="mb-1 break-words text-[11px] font-medium uppercase tracking-wide text-white/45 [overflow-wrap:anywhere]">{brand}</p>}
          <h3 className="line-clamp-2 break-words text-sm font-semibold leading-5 text-white [overflow-wrap:anywhere]">{product.title || "Untitled product"}</h3>
          {product.category?.title && <p className="mt-1 break-words text-xs text-white/45 [overflow-wrap:anywhere]">{product.category.title}</p>}
          {product.description && <p className="mt-2 line-clamp-2 break-words text-xs leading-5 text-white/45 [overflow-wrap:anywhere]">{product.description}</p>}
        </div>

        {product.key_features && product.key_features.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {product.key_features.slice(0, 3).map((feature, index) => (
              <span key={`${feature}-${index}`} className="max-w-full rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] leading-4 text-white/55 [overflow-wrap:anywhere]">
                {feature}
              </span>
            ))}
          </div>
        )}

        <div className="space-y-2 border-t border-white/10 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Merchant offers</p>
          {offers.length > 0 ? offers.map((offer, index) => {
            const price = offerPrice(offer, product);
            const unavailable = /out.?of.?stock|unavailable|sold.?out|discontinued/i.test(offer.availability || "");
            return (
              <div key={`${offer.domain}-${index}`} className="min-w-0 rounded-xl border border-white/8 bg-black/15 p-3">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-xs font-medium text-white/85 [overflow-wrap:anywhere]">{offer.domain}</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {price.amount !== undefined ? formatPrice(price.amount, price.currency) : "Price unavailable"}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-white/40">
                      {offer.availability && <span>{offer.availability === "InStock" ? "In stock" : offer.availability}</span>}
                      {offer.condition && <span>· {offer.condition}</span>}
                    </div>
                  </div>
                  {offer.url && (
                    <a
                      href={offer.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 px-2.5 py-1.5 text-[10px] font-medium text-white/75 transition hover:bg-white/10"
                    >
                      View offer <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onDraftOrder(product, offer)}
                  disabled={!product.id || !offer.domain || price.amount === undefined || unavailable}
                  className="mt-3 flex w-full min-w-0 items-center justify-center gap-2 rounded-full bg-white px-3 py-2 text-center text-xs font-semibold leading-5 text-[#171717] transition hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <WalletCards className="h-3.5 w-3.5" /> Draft order from {offer.domain}
                </button>
              </div>
            );
          }) : (
            <p className="text-xs text-white/40">No merchant offers are currently available for this product.</p>
          )}
        </div>
      </div>
    </article>
  );
}

function AssistantText({ content }: { content: string }) {
  return (
    <div
      className="min-w-0 max-w-full whitespace-pre-wrap break-words text-[15px] leading-7 text-[#ececec] [overflow-wrap:anywhere] [word-break:break-word]"
      style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
    >
      {content}
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  // A session ID is assigned on the first user action, not during render.
  // This keeps Next.js static prerendering free of browser randomness APIs.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  const sendMessage = async (textOverride?: string, selectedProduct?: SelectedProductOffer) => {
    const userText = (textOverride ?? input).trim();
    if (!userText || loading) return;

    // Event-handler execution is safe for creating a per-chat correlation ID.
    const activeSessionId = sessionId ?? createClientSessionId();
    if (sessionId === null) setSessionId(activeSessionId);

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      content: userText,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        // Send conversation history, not only the latest message.
        body: JSON.stringify({
          session_id: activeSessionId,
          messages: nextMessages
            .filter((message) => message.id !== "welcome")
            .slice(-12)
            .map((message) => ({
              role: message.role,
              content: message.content,
              ...(message.role === "assistant" && message.products?.length && message.appliedFilters
                ? {
                    context: {
                      products: message.products,
                      comparison: message.comparison,
                      applied_filters: message.appliedFilters,
                      search_query: message.searchQuery,
                    },
                  }
                : {}),
            })),
          ...(selectedProduct ? { selected_product: selectedProduct } : {}),
        }),
      });

      const raw: unknown = await response.json().catch(() => ({}));
      const payload: ApiResponse = isRecord(raw) ? raw : {};
      if (!response.ok) {
        const detail =
          (typeof payload.message === "string" && payload.message) ||
          (typeof payload.detail === "string" && payload.detail) ||
          `Request failed with status ${response.status}`;
        throw new Error(detail);
      }

      const assistantText = extractMessageText(payload);
      const assistantMessage: ChatMessage = {
        id: `${Date.now()}-assistant`,
        role: "assistant",
        content: assistantText,
        products: extractProducts(payload),
        comparison: isRecord(payload.comparison) ? (payload.comparison as unknown as MerchantComparison) : undefined,
        appliedFilters: isRecord(payload.applied_filters)
          ? (payload.applied_filters as unknown as AppliedSearchFilters)
          : undefined,
        searchQuery: typeof payload.search_query === "string"
          ? payload.search_query
          : undefined,
        approveUrl: extractApprovalUrl(payload, assistantText),
        executedTools: Array.isArray(payload.executed_tools)
          ? payload.executed_tools.filter((item): item is string => typeof item === "string")
          : undefined,
        duration:
          typeof payload.execution_time_seconds === "number" ||
          typeof payload.execution_time_seconds === "string"
            ? payload.execution_time_seconds
            : undefined,
      };
      setMessages((current) => [...current, assistantMessage]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `${Date.now()}-error`,
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "Something went wrong while contacting the PayAgent backend.",
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const startNewChat = () => {
    setMessages([WELCOME_MESSAGE]);
    // This runs in a click handler, not during render/prerender.
    setSessionId(createClientSessionId());
    setInput("");
  };

  const draftOrder = (product: ChannelProduct, offer: ProductOffer) => {
    if (!product.id || !product.title || !offer.domain) return;
    const price = offerPrice(offer, product);
    const amountText = price.amount !== undefined ? formatPrice(price.amount, price.currency) : "the latest verified price";
    const prompt = `Please verify and draft a PayPal order for ${product.title} from ${offer.domain} at the latest verified offer price (currently displayed as ${amountText}).`;
    void sendMessage(prompt, {
      product_id: product.id,
      title: product.title,
      offer_domain: offer.domain,
    });
  };

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId(null), 1600);
    } catch {
      setCopiedMessageId(null);
    }
  };

  return (
    <div className="flex h-[100dvh] min-h-[560px] overflow-hidden bg-[#212121] text-[#ececec]">
      {/* ChatGPT-inspired collapsible sidebar */}
      <aside
        className={`${sidebarOpen ? "w-[260px]" : "w-0"} hidden shrink-0 flex-col overflow-hidden border-r border-white/5 bg-[#171717] transition-all duration-200 md:flex`}
        aria-hidden={!sidebarOpen}
      >
        <div className="flex h-full min-w-[260px] flex-col p-3">
          <div className="mb-5 flex items-center justify-between px-2 pt-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-[#171717]">
                <Sparkles className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold tracking-tight">PayAgent</span>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded-lg p-2 text-white/55 transition hover:bg-white/10 hover:text-white"
              aria-label="Close sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={startNewChat}
            className="flex items-center gap-3 rounded-xl border border-white/10 px-3 py-3 text-left text-sm text-white/90 transition hover:bg-white/5"
          >
            <MessageSquarePlus className="h-4 w-4" />
            New chat
            <Plus className="ml-auto h-4 w-4 text-white/45" />
          </button>

          <div className="mt-8 px-2 text-[11px] font-semibold uppercase tracking-wider text-white/35">
            Connected services
          </div>
          <div className="mt-3 space-y-1">
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/70">
              <ShoppingBag className="h-4 w-4 text-white/55" />
              Channel3 product search
              <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" />
            </div>
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/70">
              <WalletCards className="h-4 w-4 text-white/55" />
              PayPal Sandbox
              <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" />
            </div>
          </div>

          <div className="mt-auto rounded-xl border border-white/8 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-white/80">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              Secure checkout flow
            </div>
            <p className="mt-2 text-[11px] leading-5 text-white/40">
              Orders are drafted first. Payment should only be captured after buyer approval.
            </p>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {/* Minimal top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/5 px-3 sm:px-5">
          <div className="flex items-center gap-2">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="mr-1 rounded-lg p-2 text-white/65 transition hover:bg-white/10 hover:text-white"
                aria-label="Open sidebar"
              >
                <Menu className="h-4 w-4" />
              </button>
            )}
            <span className="text-sm font-semibold">PayAgent</span>
            <span className="rounded-md bg-white/5 px-2 py-1 text-[10px] font-medium text-white/45">Sandbox</span>
            <ChevronDown className="h-3.5 w-3.5 text-white/35" />
          </div>
          <div className="flex items-center gap-2 text-[11px] text-white/45">
            <span className="hidden sm:inline">Channel3</span>
            <span className="h-1 w-1 rounded-full bg-white/25" />
            <span>PayPal</span>
          </div>
        </header>

        {/* Scrollable conversation */}
        <section className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto" aria-label="Chat conversation">
          <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col px-4 pb-8 pt-6 sm:px-6 sm:pt-10">
            {messages.length === 1 && messages[0].id === "welcome" ? (
              <div className="my-auto flex min-h-[420px] flex-col items-center justify-center pb-10 text-center">
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                  <Sparkles className="h-6 w-6 text-white/85" />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">What can I help you find?</h1>
                <p className="mt-3 max-w-lg text-sm leading-6 text-white/45">
                  Search products, compare merchant offers, and prepare PayPal orders in one conversation.
                </p>
                <div className="mt-8 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    { title: "Find a keyboard under $60", prompt: "Find a mechanical keyboard under $60 and show me product images." },
                    { title: "Compare laptop offers", prompt: "Find three laptop offers and compare their prices and merchants." },
                    { title: "Draft a PayPal order", prompt: "Find a mechanical keyboard under $60 and draft a PayPal order for the best match." },
                    { title: "Search headphones", prompt: "Find wireless headphones under $100." },
                  ].map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion.title}
                      onClick={() => void sendMessage(suggestion.prompt)}
                      className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-left transition hover:border-white/20 hover:bg-white/[0.06]"
                    >
                      <p className="text-sm font-medium text-white/85">{suggestion.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/40">{suggestion.prompt}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="min-w-0 space-y-8">
                {messages.filter((message) => message.id !== "welcome").map((message) => (
                  <div key={message.id} className="w-full min-w-0">
                    {message.role === "user" ? (
                      <div
                        className="ml-auto w-fit min-w-0 max-w-[88%] rounded-[24px] bg-[#303030] px-5 py-3.5 text-[15px] leading-7 text-white [overflow-wrap:anywhere] [word-break:break-word] sm:max-w-[80%]"
                        style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                      >
                        <p
                          className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-word]"
                          style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                        >
                          {message.content}
                        </p>
                      </div>
                    ) : (
                      <div className="flex min-w-0 gap-3 sm:gap-4">
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06]">
                          <Sparkles className="h-3.5 w-3.5 text-white/80" />
                        </div>
                        <div className="min-w-0 max-w-full flex-1 space-y-4">
                          {!message.error && <AssistantText content={message.content} />}

                          {message.comparison && <MerchantComparisonPanel comparison={message.comparison} />}

                          {message.products && message.products.length > 0 && (
                            <div className="space-y-3">
                              <div className="flex items-center gap-2 text-xs font-medium text-white/50">
                                <PackageSearch className="h-4 w-4" />
                                {message.products.length} product{message.products.length === 1 ? "" : "s"} found
                              </div>
                              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                                {message.products.map((product, index) => (
                                  <ProductCard
                                    key={product.id || `${product.title || "product"}-${index}`}
                                    product={product}
                                    onDraftOrder={draftOrder}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {message.approveUrl && (
                            <div className="w-full min-w-0 max-w-md rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
                              <div className="flex min-w-0 items-start gap-3">
                                <div className="rounded-xl bg-emerald-400/10 p-2 text-emerald-300">
                                  <WalletCards className="h-5 w-5" />
                                </div>
                                <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                                  <p className="text-sm font-semibold text-white">PayPal order ready for approval</p>
                                  <p className="mt-1 text-xs leading-5 text-white/50">Review the order with PayPal. The payment is not captured by this link alone.</p>
                                  <a
                                    href={message.approveUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-400 px-4 py-2.5 text-xs font-semibold text-[#102018] transition hover:bg-emerald-300"
                                  >
                                    Continue to PayPal <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                </div>
                              </div>
                            </div>
                          )}

                          {message.error && (
                            <div className="flex min-w-0 items-start gap-2 rounded-xl border border-red-400/20 bg-red-400/[0.06] p-3 text-sm text-red-200">
                              <X className="mt-0.5 h-4 w-4 shrink-0" />
                              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{message.content}</span>
                            </div>
                          )}

                          {((message.executedTools?.length ?? 0) > 0 || message.duration !== undefined) && (
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/35">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                              {message.executedTools?.join(" · ") || "Completed"}
                              {message.duration !== undefined && <span>· {message.duration}s</span>}
                            </div>
                          )}

                          {!message.error && (
                            <div className="flex items-center gap-1 text-white/35">
                              <button
                                type="button"
                                onClick={() => void copyMessage(message)}
                                className="rounded-lg p-2 transition hover:bg-white/10 hover:text-white/80"
                                aria-label="Copy response"
                                title="Copy response"
                              >
                                {copiedMessageId === message.id ? <Check className="h-3.5 w-3.5" /> : <span className="text-xs">Copy</span>}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {loading && (
                  <div className="flex gap-3 sm:gap-4">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06]">
                      <Sparkles className="h-3.5 w-3.5 text-white/80" />
                    </div>
                    <div className="flex items-center gap-1.5 pt-2">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-white/65 [animation-delay:-0.2s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-white/65 [animation-delay:-0.1s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-white/65" />
                      <span className="ml-2 text-xs text-white/40">PayAgent is working…</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </section>

        {/* Composer */}
        <div className="shrink-0 px-3 pb-4 pt-2 sm:px-6 sm:pb-6">
          <div className="mx-auto max-w-3xl">
            <form onSubmit={handleSubmit} className="rounded-[26px] border border-white/10 bg-[#2f2f2f] px-3 pb-3 pt-2 shadow-[0_10px_40px_rgba(0,0,0,0.22)] transition focus-within:border-white/20">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  event.currentTarget.style.height = "auto";
                  event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 180)}px`;
                }}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Message PayAgent…"
                disabled={loading}
                className="max-h-[180px] min-h-[42px] w-full resize-none bg-transparent px-2 py-2 text-[15px] leading-6 text-white outline-none placeholder:text-white/35 disabled:opacity-60"
                aria-label="Message PayAgent"
              />
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 px-2 text-white/40">
                  <Sparkles className="h-4 w-4" />
                  <span className="hidden text-[11px] sm:inline">Search products · compare offers · draft checkout</span>
                </div>
                <button
                  type="submit"
                  disabled={!input.trim() || loading}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#171717] transition hover:bg-white/85 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/35"
                  aria-label="Send message"
                >
                  <ArrowUp className="h-5 w-5" />
                </button>
              </div>
            </form>
            <p className="mt-2 text-center text-[10px] leading-4 text-white/30">
              PayAgent can make mistakes. Check product details and price before approving a payment.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
