import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import Groq from "groq-sdk";

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY in .env.local");
  return new Groq({ apiKey });
}

type Channel3Offer = {
  url: string | null;
  domain: string | null;
  price: {
    price: number | null;
    compare_at_price: number | null;
    currency: string;
  };
  availability: string | null;
  condition: string | null;
  max_commission_rate: number | null;
};

type Channel3Product = {
  id: string;
  title: string;
  description: string | null;
  brands: Array<{ id: string | null; name: string }>;
  images: Array<{
    url: string | null;
    cleaned_url: string | null;
    is_main_image: boolean;
    shot_type: string | null;
    alt_text: string | null;
  }>;
  image_url: string | null;
  category: { title?: string; slug?: string } | null;
  key_features: string[];
  offers: Channel3Offer[];
  price: number | null;
  currency: string;
  merchant: string | null;
  availability: string | null;
  variants: unknown;
  structured_attributes: unknown;
  ratings: unknown;
};

type SearchOptions = {
  maxPrice?: number | null;
  currency?: string;
  merchantFilters?: string[];
  requiredFeatures?: string[];
  sortBy?: "price_asc" | "price_desc";
  limit?: number;
};

type SelectedProduct = {
  product_id?: string;
  title?: string;
  offer_domain?: string;
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

function asNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function productSearchText(product: Channel3Product): string {
  return [
    product.title,
    product.description ?? "",
    product.brands.map((brand) => brand.name).join(" "),
    product.category?.title ?? "",
    product.key_features.join(" "),
    JSON.stringify(product.structured_attributes ?? {}),
  ]
    .join(" ")
    .toLowerCase();
}

function isUnavailable(availability: string | null): boolean {
  if (!availability) return false;
  return /out.?of.?stock|unavailable|sold.?out|discontinued/i.test(availability);
}

// Server-side Channel3 search. The original product, image, brand and offer data is retained.
async function searchProductsChannel3(
  query: string,
  options: SearchOptions = {},
): Promise<{
  success: boolean;
  products: Channel3Product[];
  count: number;
  next_page_token: string | null;
  error?: string;
}> {
  const apiKey = process.env.CHANNEL3_API_KEY;
  if (!apiKey) throw new Error("Missing CHANNEL3_API_KEY in .env.local");

  const response = await fetch("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, limit: options.limit ?? 10 }),
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text();
    return {
      success: false,
      products: [],
      count: 0,
      next_page_token: null,
      error: `Channel3 search failed (${response.status}): ${details}`,
    };
  }

  const data = (await response.json()) as {
    products?: any[];
    next_page_token?: string | null;
  };
  const rawProducts = Array.isArray(data.products) ? data.products : [];

  const normalizedProducts: Channel3Product[] = rawProducts.map((rawProduct: any) => {
    const images = (Array.isArray(rawProduct.images) ? rawProduct.images : []).map(
      (image: any) => ({
        url: typeof image?.url === "string" ? image.url : null,
        cleaned_url: typeof image?.cleaned_url === "string" ? image.cleaned_url : null,
        is_main_image: Boolean(image?.is_main_image),
        shot_type: typeof image?.shot_type === "string" ? image.shot_type : null,
        alt_text: typeof image?.alt_text === "string" ? image.alt_text : null,
      }),
    );

    const offers: Channel3Offer[] = (Array.isArray(rawProduct.offers) ? rawProduct.offers : []).map(
      (offer: any) => ({
        url: typeof offer?.url === "string" ? offer.url : null,
        domain: typeof offer?.domain === "string" ? offer.domain : null,
        price: {
          price: asNullableNumber(offer?.price?.price),
          compare_at_price: asNullableNumber(offer?.price?.compare_at_price),
          currency: typeof offer?.price?.currency === "string" ? offer.price.currency : "USD",
        },
        availability: typeof offer?.availability === "string" ? offer.availability : null,
        condition: typeof offer?.condition === "string" ? offer.condition : null,
        max_commission_rate: asNullableNumber(offer?.max_commission_rate),
      }),
    );

    offers.sort((a, b) => (a.price.price ?? Infinity) - (b.price.price ?? Infinity));
    const mainOffer = offers.find((offer) => offer.price.price !== null) ?? offers[0] ?? null;
    const mainImage = images.find((image: any) => image.is_main_image) ?? images[0] ?? null;

    return {
      id: String(rawProduct.id ?? ""),
      title: String(rawProduct.title ?? "Untitled product"),
      description: typeof rawProduct.description === "string" ? rawProduct.description : null,
      brands: (Array.isArray(rawProduct.brands) ? rawProduct.brands : []).map((brand: any) => ({
        id: typeof brand?.id === "string" ? brand.id : null,
        name: String(brand?.name ?? "Unknown brand"),
      })),
      images,
      image_url: mainImage?.cleaned_url || mainImage?.url || null,
      category:
        rawProduct.category && typeof rawProduct.category === "object"
          ? {
              title: typeof rawProduct.category.title === "string" ? rawProduct.category.title : undefined,
              slug: typeof rawProduct.category.slug === "string" ? rawProduct.category.slug : undefined,
            }
          : null,
      key_features: Array.isArray(rawProduct.key_features)
        ? rawProduct.key_features.filter((item: unknown): item is string => typeof item === "string")
        : [],
      offers,
      price: mainOffer?.price.price ?? null,
      currency: mainOffer?.price.currency ?? "USD",
      merchant: mainOffer?.domain ?? null,
      availability: mainOffer?.availability ?? null,
      variants: rawProduct.variants ?? null,
      structured_attributes: rawProduct.structured_attributes ?? null,
      ratings: rawProduct.ratings ?? null,
    };
  });

  const targetCurrency = (options.currency || "USD").toUpperCase();
  const merchantFilters = (options.merchantFilters ?? []).map(normalizeText).filter(Boolean);
  const requiredFeatures = (options.requiredFeatures ?? []).map((item) => item.toLowerCase().trim()).filter(Boolean);

  const filteredProducts = normalizedProducts
    .map((product) => {
      let eligibleOffers = product.offers;

      if (options.maxPrice !== null && options.maxPrice !== undefined) {
        eligibleOffers = eligibleOffers.filter(
          (offer) =>
            offer.price.price !== null &&
            offer.price.currency.toUpperCase() === targetCurrency &&
            offer.price.price <= options.maxPrice!,
        );
      }

      if (merchantFilters.length > 0) {
        eligibleOffers = eligibleOffers.filter((offer) => {
          const domain = normalizeText(offer.domain ?? "");
          if (!domain) return false;
          return merchantFilters.some((merchant) => domain.includes(merchant) || merchant.includes(domain));
        });
      }

      return { ...product, offers: eligibleOffers };
    })
    .filter((product) => {
      if ((options.maxPrice !== null && options.maxPrice !== undefined) || merchantFilters.length > 0) {
        if (product.offers.length === 0) return false;
      }
      const searchable = productSearchText(product);
      // Each extracted feature is required. For short phrases, match a meaningful word
      // when the catalogue uses a slightly different label (for example, "RGB lighting" -> "RGB").
      return requiredFeatures.every((feature) => {
        if (searchable.includes(feature)) return true;
        const tokens = feature.split(/[^a-z0-9]+/i).filter((token) => token.length >= 3);
        return tokens.length > 0 && tokens.some((token) => searchable.includes(token));
      });
    });

  filteredProducts.sort((a, b) => {
    const aPrice = a.offers.find((offer) => offer.price.price !== null)?.price.price ?? a.price ?? Infinity;
    const bPrice = b.offers.find((offer) => offer.price.price !== null)?.price.price ?? b.price ?? Infinity;
    return options.sortBy === "price_desc" ? bPrice - aPrice : aPrice - bPrice;
  });

  const products = filteredProducts.map((product) => {
    const mainOffer = product.offers.find((offer) => offer.price.price !== null) ?? product.offers[0] ?? null;
    return {
      ...product,
      price: mainOffer?.price.price ?? product.price,
      currency: mainOffer?.price.currency ?? product.currency,
      merchant: mainOffer?.domain ?? product.merchant,
      availability: mainOffer?.availability ?? product.availability,
    };
  });

  return {
    success: true,
    products,
    count: products.length,
    next_page_token: data.next_page_token ?? null,
  };
}

function offerMatchesMerchant(domain: string | null, merchantFilter: string): boolean {
  if (!domain) return false;
  const normalizedDomain = normalizeText(domain);
  const normalizedFilter = normalizeText(merchantFilter);
  if (!normalizedDomain || !normalizedFilter) return false;
  return normalizedDomain.includes(normalizedFilter) || normalizedFilter.includes(normalizedDomain);
}

function toComparisonOffer(
  product: Channel3Product,
  offer: Channel3Offer,
  merchantLabel: string,
): ComparisonOffer | null {
  if (!offer.domain || offer.price.price === null || !Number.isFinite(offer.price.price)) return null;
  return {
    product_id: product.id,
    product_title: product.title,
    merchant: merchantLabel,
    domain: offer.domain,
    price: offer.price.price,
    currency: (offer.price.currency || "USD").toUpperCase(),
    availability: offer.availability,
    url: offer.url,
  };
}

function buildMerchantComparison(
  products: Channel3Product[],
  requestedMerchants: string[],
): MerchantComparison {
  const merchantEntries = requestedMerchants.map((merchant) => {
    const entries = products.flatMap((product) =>
      product.offers
        .filter((offer) => offerMatchesMerchant(offer.domain, merchant))
        .map((offer) => toComparisonOffer(product, offer, merchant))
        .filter((offer): offer is ComparisonOffer => offer !== null),
    );

    const currencyCodes = [...new Set(entries.map((entry) => entry.currency))].sort();
    const currencyBreakdown = currencyCodes.map((currency) => {
      const currencyEntries = entries
        .filter((entry) => entry.currency === currency)
        .sort((a, b) => a.price - b.price);
      const availableEntries = currencyEntries.filter((entry) => !isUnavailable(entry.availability));
      return {
        currency,
        offer_count: currencyEntries.length,
        lowest_offer: currencyEntries[0] ?? null,
        lowest_available_offer: availableEntries[0] ?? null,
      };
    });

    return {
      merchant,
      entries,
      summary: {
        merchant,
        product_count: new Set(entries.map((entry) => entry.product_id)).size,
        offer_count: entries.length,
        currency_breakdown: currencyBreakdown,
      },
    };
  });

  // A same-product comparison is only reported when Channel3 returned the same canonical
  // product with offers from at least two of the requested merchants.
  const sameProductComparisons = products.flatMap((product) => {
    const matchedOffers = merchantEntries.flatMap(({ merchant, entries }) => {
      const forProduct = entries
        .filter((entry) => entry.product_id === product.id)
        .sort((a, b) => a.price - b.price);
      return forProduct.length > 0 ? [forProduct[0]] : [];
    });
    return matchedOffers.length >= 2
      ? [{ product_id: product.id, product_title: product.title, offers: matchedOffers }]
      : [];
  });

  // Only select a single best offer when the requested merchants have a common currency.
  const nonEmptyCurrencySets = merchantEntries
    .filter((entry) => entry.entries.length > 0)
    .map((entry) => new Set(entry.entries.map((offer) => offer.currency)));
  const commonCurrencies = nonEmptyCurrencySets.length > 0
    ? [...nonEmptyCurrencySets[0]].filter((currency) => nonEmptyCurrencySets.every((set) => set.has(currency)))
    : [];
  const comparableCurrency = commonCurrencies.length === 1 ? commonCurrencies[0] : null;
  const comparableOffers = comparableCurrency
    ? merchantEntries.flatMap((entry) => entry.entries)
        .filter((offer) => offer.currency === comparableCurrency && !isUnavailable(offer.availability))
        .sort((a, b) => a.price - b.price)
    : [];

  const merchantsWithNoOffers = merchantEntries.filter((entry) => entry.entries.length === 0).map((entry) => entry.merchant);
  let note = "Prices are the listed Channel3 offer prices returned for this search; shipping, taxes, and delivery fees may differ.";
  if (sameProductComparisons.length === 0) {
    note += " Channel3 did not return a matching canonical product listed by more than one requested merchant, so the merchant summary compares each merchant's returned catalogue and lowest offers rather than claiming a same-model price match.";
  }
  if (merchantsWithNoOffers.length > 0) {
    note += ` No matching offers were returned for: ${merchantsWithNoOffers.join(", ")}.`;
  }
  if (commonCurrencies.length > 1 || (nonEmptyCurrencySets.length > 0 && commonCurrencies.length === 0)) {
    note += " The merchants' offers use different currencies, so a single overall cheapest offer is not calculated.";
  }

  return {
    requested_merchants: requestedMerchants,
    merchant_summaries: merchantEntries.map((entry) => entry.summary),
    same_product_comparisons: sameProductComparisons,
    best_overall_offer: comparableOffers[0] ?? null,
    best_overall_currency: comparableCurrency,
    note,
  };
}

function formatComparisonMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function buildComparisonMessage(comparison: MerchantComparison): string {
  const lines = [`Here's the comparison for ${comparison.requested_merchants.join(" vs ")}:`];

  for (const summary of comparison.merchant_summaries) {
    if (summary.offer_count === 0) {
      lines.push(`• ${summary.merchant}: no matching offers were returned.`);
      continue;
    }

    const productLabel = `${summary.product_count} product${summary.product_count === 1 ? "" : "s"}`;
    const offerLabel = `${summary.offer_count} offer${summary.offer_count === 1 ? "" : "s"}`;
    lines.push(`• ${summary.merchant}: ${productLabel}, ${offerLabel}.`);

    for (const group of summary.currency_breakdown) {
      if (group.lowest_available_offer) {
        const lowest = group.lowest_available_offer;
        lines.push(`  Lowest in-stock listing: ${lowest.product_title} — ${formatComparisonMoney(lowest.price, lowest.currency)} at ${lowest.domain}${lowest.availability ? ` (${lowest.availability})` : ""}.`);
      } else if (group.lowest_offer) {
        const lowest = group.lowest_offer;
        lines.push(`  Lowest listed price: ${lowest.product_title} — ${formatComparisonMoney(lowest.price, lowest.currency)} at ${lowest.domain}, but availability is not confirmed.`);
      }
    }
  }

  if (comparison.same_product_comparisons.length > 0) {
    lines.push("Same-product price comparisons:");
    for (const product of comparison.same_product_comparisons) {
      const offerText = product.offers.map((offer) => `${offer.merchant}: ${formatComparisonMoney(offer.price, offer.currency)} (${offer.domain})`).join(" vs ");
      lines.push(`• ${product.product_title}: ${offerText}.`);
    }
  }

  if (comparison.best_overall_offer) {
    const best = comparison.best_overall_offer;
    lines.push(`Lowest available offer across the compared merchants: ${best.product_title} at ${formatComparisonMoney(best.price, best.currency)} from ${best.merchant} (${best.domain}).`);
  }

  lines.push(comparison.note);
  lines.push("The merchant comparison is shown below. You can open a specific offer or draft a PayPal order from that exact offer.");
  return lines.join("\n\n");
}

async function getPayPalAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing PayPal credentials in .env.local");

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Accept-Language": "en_US",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`PayPal authentication failed (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("PayPal did not return an access token");
  return data.access_token;
}

async function createPayPalOrder(productName: string, amount: number, productId: string, merchant: string) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false as const, error: "The selected offer does not have a valid price." };
  }

  // This release intentionally supports USD checkout only. Never silently convert currencies.
  const currency = "USD";
  const formattedAmount = amount.toFixed(2);
  const accessToken = await getPayPalAccessToken();
  const appUrl = process.env.APP_URL || "https://payagent-concierge.vercel.app";

  const response = await fetch("https://api-m.sandbox.paypal.com/v2/checkout/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: productId.slice(0, 256),
          description: `${productName} (${merchant})`.substring(0, 127),
          custom_id: productId.slice(0, 127),
          amount: { currency_code: currency, value: formattedAmount },
        },
      ],
      application_context: {
        brand_name: "PayAgent Concierge",
        user_action: "PAY_NOW",
        return_url: `${appUrl}/checkout/success`,
        cancel_url: `${appUrl}/checkout/cancel`,
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      success: false as const,
      error: `PayPal order creation failed (${response.status}): ${await response.text()}`,
    };
  }

  const order = (await response.json()) as {
    id?: string;
    status?: string;
    links?: Array<{ rel?: string; href?: string }>;
  };
  const approveUrl = order.links?.find((link) => link.rel === "approve")?.href;
  if (!order.id || !approveUrl) {
    return { success: false as const, error: "PayPal did not return an order ID and approval URL." };
  }

  return {
    success: true as const,
    order_id: order.id,
    status: order.status ?? "CREATED",
    amount: formattedAmount,
    currency,
    product_id: productId,
    merchant,
    approve_url: approveUrl,
  };
}

// Re-query Channel3 immediately before checkout. The browser never supplies the amount to charge.
async function verifySelectedOffer(selection: SelectedProduct) {
  const productId = typeof selection.product_id === "string" ? selection.product_id.trim() : "";
  const title = typeof selection.title === "string" ? selection.title.trim() : "";
  const domain = typeof selection.offer_domain === "string" ? selection.offer_domain.trim() : "";

  if (!productId || !title || !domain) {
    return { success: false as const, error: "Select a product and a specific merchant offer before checkout." };
  }

  const search = await searchProductsChannel3(title, { limit: 10 });
  if (!search.success) {
    return { success: false as const, error: search.error || "Unable to verify the selected Channel3 product." };
  }

  const product = search.products.find((item) => item.id === productId);
  if (!product) {
    return { success: false as const, error: "This product could not be verified in the latest Channel3 results. Search again and select it again." };
  }

  const selectedDomain = normalizeText(domain);
  const matchingOffers = product.offers.filter(
    (offer) => normalizeText(offer.domain ?? "") === selectedDomain,
  );
  const offer = matchingOffers.find((item) => item.price.price !== null) ?? matchingOffers[0];

  if (!offer || offer.price.price === null || !Number.isFinite(offer.price.price) || offer.price.price <= 0) {
    return { success: false as const, error: "The selected merchant offer no longer has a valid price. Please search again." };
  }
  if (isUnavailable(offer.availability)) {
    return { success: false as const, error: `The selected offer is currently ${offer.availability}. Choose another offer.` };
  }
  if (offer.price.currency.toUpperCase() !== "USD") {
    return {
      success: false as const,
      error: `This offer is priced in ${offer.price.currency}. PayAgent Sandbox checkout currently supports USD offers only.`,
    };
  }

  return { success: true as const, product, offer };
}

function splitFilterItems(item: string): string[] {
  // Some intent-model responses put multiple merchants in one array item,
  // e.g. ["BestBuy, Keychron"] or ["BestBuy and Keychron"]. Split those
  // into separate filters so the comparison path can run deterministically.
  return item
    .split(/\s*(?:,|;|\||&)\s*|\s+\b(?:and|vs\.?|versus)\b\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function getStringArray(value: unknown, maxItems = 8): string[] {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];

  return candidates
    .filter((item): item is string => typeof item === "string")
    .flatMap(splitFilterItems)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, all) => all.findIndex((other) => normalizeText(other) === normalizeText(item)) === index)
    .slice(0, maxItems);
}

function extractMerchantFilters(value: unknown, prompt: string): string[] {
  const parsed = getStringArray(value, 5);

  // Ground common merchant aliases directly in the user's wording. This is a
  // fallback for intent-model outputs that accidentally merge merchant names.
  const knownMerchants: Array<{ name: string; pattern: RegExp }> = [
    { name: "BestBuy", pattern: /\bbest\s*buy(?:\.com)?\b/i },
    { name: "Keychron", pattern: /\bkeychron(?:\.com)?\b/i },
    { name: "Amazon", pattern: /\bamazon(?:\.com)?\b/i },
    { name: "Walmart", pattern: /\bwalmart(?:\.com)?\b/i },
    { name: "Target", pattern: /\btarget(?:\.com)?\b/i },
    { name: "Newegg", pattern: /\bnewegg(?:\.com)?\b/i },
    { name: "eBay", pattern: /\bebay(?:\.com)?\b/i },
  ];
  const mentioned = knownMerchants
    .filter((merchant) => merchant.pattern.test(prompt))
    .map((merchant) => merchant.name);

  if (mentioned.length >= 2) return mentioned;
  return parsed;
}


type AppliedSearchFilters = {
  max_price: number | null;
  currency: string;
  merchant_filters: string[];
  required_features: string[];
  sort_by: "price_asc" | "price_desc";
};

type PriorAssistantContext = {
  products: Channel3Product[];
  comparison: MerchantComparison | null;
  applied_filters: AppliedSearchFilters;
  search_query: string | null;
};

function sanitizePriorContext(value: unknown): PriorAssistantContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const context = value as Record<string, any>;
  if (!Array.isArray(context.products)) return null;

  const products: Channel3Product[] = context.products.slice(0, 10).flatMap((raw: any) => {
    if (!raw || typeof raw !== "object" || typeof raw.title !== "string") return [];
    const offers: Channel3Offer[] = (Array.isArray(raw.offers) ? raw.offers : [])
      .slice(0, 12)
      .flatMap((offer: any) => {
        if (!offer || typeof offer !== "object") return [];
        const rawPrice = offer.price && typeof offer.price === "object" ? offer.price : {};
        return [{
          url: typeof offer.url === "string" ? offer.url : null,
          domain: typeof offer.domain === "string" ? offer.domain : null,
          price: {
            price: asNullableNumber(rawPrice.price),
            compare_at_price: asNullableNumber(rawPrice.compare_at_price),
            currency: typeof rawPrice.currency === "string" ? rawPrice.currency.toUpperCase() : "USD",
          },
          availability: typeof offer.availability === "string" ? offer.availability : null,
          condition: typeof offer.condition === "string" ? offer.condition : null,
          max_commission_rate: asNullableNumber(offer.max_commission_rate),
        }];
      });

    const images = (Array.isArray(raw.images) ? raw.images : []).slice(0, 6).flatMap((image: any) => {
      if (!image || typeof image !== "object") return [];
      return [{
        url: typeof image.url === "string" ? image.url : null,
        cleaned_url: typeof image.cleaned_url === "string" ? image.cleaned_url : null,
        is_main_image: Boolean(image.is_main_image),
        shot_type: typeof image.shot_type === "string" ? image.shot_type : null,
        alt_text: typeof image.alt_text === "string" ? image.alt_text : null,
      }];
    });

    const brands = (Array.isArray(raw.brands) ? raw.brands : []).slice(0, 6).flatMap((brand: any) => {
      if (!brand || typeof brand !== "object") return [];
      return [{ id: typeof brand.id === "string" ? brand.id : null, name: String(brand.name ?? "Unknown brand") }];
    });

    return [{
      id: typeof raw.id === "string" ? raw.id : "",
      title: raw.title.slice(0, 500),
      description: typeof raw.description === "string" ? raw.description.slice(0, 3000) : null,
      brands,
      images,
      image_url: typeof raw.image_url === "string" ? raw.image_url : null,
      category: raw.category && typeof raw.category === "object"
        ? {
            title: typeof raw.category.title === "string" ? raw.category.title : undefined,
            slug: typeof raw.category.slug === "string" ? raw.category.slug : undefined,
          }
        : null,
      key_features: Array.isArray(raw.key_features)
        ? raw.key_features.filter((item: unknown): item is string => typeof item === "string").slice(0, 20)
        : [],
      offers,
      price: asNullableNumber(raw.price),
      currency: typeof raw.currency === "string" ? raw.currency.toUpperCase() : "USD",
      merchant: typeof raw.merchant === "string" ? raw.merchant : null,
      availability: typeof raw.availability === "string" ? raw.availability : null,
      variants: null,
      structured_attributes: null,
      ratings: null,
    }];
  });

  if (products.length === 0) return null;
  const rawFilters = context.applied_filters && typeof context.applied_filters === "object"
    ? context.applied_filters
    : {};
  const currency = typeof rawFilters.currency === "string" && /^[A-Za-z]{3}$/.test(rawFilters.currency)
    ? rawFilters.currency.toUpperCase()
    : "USD";

  const rawComparison = context.comparison;
  const comparison = rawComparison
    && typeof rawComparison === "object"
    && Array.isArray(rawComparison.merchant_summaries)
    && Array.isArray(rawComparison.same_product_comparisons)
    && Array.isArray(rawComparison.requested_merchants)
    ? rawComparison as MerchantComparison
    : null;

  return {
    products,
    comparison,
    applied_filters: {
      max_price: asNullableNumber(rawFilters.max_price),
      currency,
      merchant_filters: getStringArray(rawFilters.merchant_filters, 8),
      required_features: getStringArray(rawFilters.required_features, 8),
      sort_by: rawFilters.sort_by === "price_desc" ? "price_desc" : "price_asc",
    },
    search_query: typeof context.search_query === "string" ? context.search_query.slice(0, 500) : null,
  };
}

function detectMerchantOnlyFollowUp(prompt: string): string[] {
  // Recognize short merchant-only follow-ups such as "What about Amazon?"
  // and resolve them against the previous product search instead of treating
  // the merchant name as a new product-search query.
  const match = prompt.trim().match(/^(?:(?:what|how)\s+about|and|try|check|search|look\s+at)\s+(.+?)\s*[?.!]*$/i);
  if (!match) return [];

  const candidate = match[1].trim().replace(/[?.!]+$/g, "").trim();
  const knownMerchants: Array<{ name: string; pattern: RegExp }> = [
    { name: "BestBuy", pattern: /^(?:best\s*buy|bestbuy(?:\.com)?)$/i },
    { name: "Keychron", pattern: /^(?:keychron(?:\.com)?)$/i },
    { name: "Amazon", pattern: /^(?:amazon(?:\.com)?)$/i },
    { name: "Walmart", pattern: /^(?:walmart(?:\.com)?)$/i },
    { name: "Target", pattern: /^(?:target(?:\.com)?)$/i },
    { name: "Newegg", pattern: /^(?:newegg(?:\.com)?)$/i },
    { name: "eBay", pattern: /^(?:e\s*bay|ebay(?:\.com)?)$/i },
  ];
  const known = knownMerchants.find((merchant) => merchant.pattern.test(candidate));
  if (known) return [known.name];

  // Accept an explicit merchant domain in the same short follow-up pattern.
  if (/^[a-z0-9-]+\.[a-z]{2,}$/i.test(candidate)) return [candidate];
  return [];
}

function isPriceRankingFollowUp(prompt: string): boolean {
  return /\b(which|what)\b.{0,55}\b(cheaper|cheapest|less expensive|lowest price|most expensive|priciest|highest price)\b/i.test(prompt)
    || /\b(cheapest|most expensive|priciest|lowest priced|highest priced|budget[- ]friendly|most affordable|affordable|best value|value for money|reasonably priced)\b/i.test(prompt)
    || /\b(sort|rank)\b.{0,45}\b(these|them|those|results|products|by price|price)\b/i.test(prompt)
    || /\b(which one costs less|which costs less|which is less expensive|which one is more affordable)\b/i.test(prompt);
}

function isProductEvaluationFollowUp(prompt: string): boolean {
  // A newly supplied numeric budget changes the search constraints; let the
  // normal search path apply that budget before evaluating the new result set.
  const hasNewBudget = /(?:budget|under|below|less than|maximum|max)\D{0,24}(?:\$\s?\d|\d[\d,]*(?:\.\d{1,2})?\s?(?:usd|dollars?))/i.test(prompt)
    || /\$\s?\d[\d,]*/i.test(prompt);
  if (hasNewBudget) return false;

  return /\b(compare|comparison|evaluate|assess)\b.{0,100}\b(specifications?|specs|features|price|prices)\b/i.test(prompt)
    || /\b(compare|weigh)\b.{0,70}\b(options|products|models|macbooks|laptops)\b/i.test(prompt)
    || /\b(select|choose|recommend|suggest|pick)\b.{0,55}\b(best|one|option|product|macbook|laptop)\b/i.test(prompt)
    || /\b(best for me|make a recommendation|which (?:one|product|macbook|laptop) should i (?:buy|choose|get))\b/i.test(prompt);
}

function getComparableProductPrice(product: Channel3Product, currency: string): number | null {
  const prices = product.offers
    .filter((offer) => offer.price.currency.toUpperCase() === currency.toUpperCase())
    .map((offer) => offer.price.price)
    .filter((price): price is number => price !== null && Number.isFinite(price));
  if (prices.length > 0) return Math.min(...prices);
  if (product.currency.toUpperCase() === currency.toUpperCase() && product.price !== null && Number.isFinite(product.price)) {
    return product.price;
  }
  return null;
}

function buildContextualPriceMessage(products: Channel3Product[], currency: string, sortBy: "price_asc" | "price_desc"): string {
  const ranked = products
    .map((product) => ({ product, price: getComparableProductPrice(product, currency) }))
    .filter((item): item is { product: Channel3Product; price: number } => item.price !== null)
    .sort((a, b) => sortBy === "price_desc" ? b.price - a.price : a.price - b.price);

  if (ranked.length === 0) {
    return `I can use the products from our previous results, but I don't have comparable ${currency} offer prices for them.`;
  }

  const first = ranked[0];
  const direction = sortBy === "price_desc" ? "most expensive" : "cheapest";
  const lines = [
    `Looking at the products from the previous results, the ${direction} is **${first.product.title}** at ${formatComparisonMoney(first.price, currency)}.`,
    `Here are the ${ranked.length} products ranked by their lowest listed ${currency} offer:`,
    ...ranked.map((item, index) => `${index + 1}. ${item.product.title} — ${formatComparisonMoney(item.price, currency)}`),
    "These are the prices returned in the previous search; I haven't run a new live price check. I'll verify the selected merchant offer again before creating any PayPal order.",
  ];
  return lines.join("\n\n");
}

async function buildContextualProductEvaluation(
  products: Channel3Product[],
  currency: string,
  budget: number | null,
  userPrompt: string,
): Promise<string> {
  const candidates = products.slice(0, 10).map((product) => {
    const price = getComparableProductPrice(product, currency);
    return {
      id: product.id,
      title: product.title,
      lowest_listed_price: price,
      currency,
      merchant_offers: product.offers.slice(0, 5).map((offer) => ({
        merchant: offer.domain,
        price: offer.price.price,
        currency: offer.price.currency,
        availability: offer.availability,
        condition: offer.condition,
      })),
      key_features: product.key_features.slice(0, 12),
      description: (product.description || "").slice(0, 1800),
      category: product.category?.title || null,
    };
  });

  const pricedCandidates = candidates.filter((candidate) => candidate.lowest_listed_price !== null);
  if (pricedCandidates.length === 0) {
    return `I can compare the specifications from the previous results, but I don't have comparable ${currency} prices for these products. Please share a budget or ask me to search again.`;
  }

  const systemPrompt = `You are PayAgent Concierge's product comparison and recommendation evaluator. Return ONLY a valid JSON object with this shape:
{
  "recommended_product_id": "one exact candidate id or empty string",
  "recommendation_reason": "brief explanation based only on supplied data"
}
Use only the candidate data supplied. Do not invent RAM, storage, chip generation, screen size, battery life, ports, condition, warranty, or other specifications. Compare only listed prices and actual listed features. Prefer a product within the stated budget; if all candidates exceed it, return an empty recommended_product_id. Do not treat a higher price as proof of better quality. Recommend a balanced option for a general-purpose buyer only when the supplied details support that choice. Never invent a missing specification.`;

  const completion = await getGroqClient().chat.completions.create({
    model: "openai/gpt-oss-120b",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          user_request: userPrompt,
          budget: budget === null ? null : { amount: budget, currency },
          candidates: pricedCandidates,
        }),
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });

  let evaluation: any = {};
  try {
    evaluation = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    evaluation = {};
  }

  const recommendedId = typeof evaluation.recommended_product_id === "string"
    ? evaluation.recommended_product_id
    : "";
  const recommended = pricedCandidates.find((candidate) => candidate.id === recommendedId) || null;
  const reason = typeof evaluation.recommendation_reason === "string"
    ? evaluation.recommendation_reason.trim().slice(0, 900)
    : "The available specifications are not detailed enough to make a confident recommendation.";

  const lines = [
    `I compared ${pricedCandidates.length} products from the previous results using their listed ${currency} prices and the specifications Channel3 supplied.`,
    "",
    "**Specification and price comparison**",
  ];

  for (const candidate of pricedCandidates) {
    const features = candidate.key_features.length > 0
      ? candidate.key_features.join("; ")
      : candidate.description || "Detailed specifications were not supplied.";
    lines.push(`• **${candidate.title}** — ${formatComparisonMoney(candidate.lowest_listed_price!, currency)}. Listed specifications: ${features.slice(0, 520)}`);
  }

  lines.push("");
  if (recommended && (budget === null || recommended.lowest_listed_price! <= budget)) {
    lines.push(`**My recommendation: ${recommended.title}** at ${formatComparisonMoney(recommended.lowest_listed_price!, currency)}.`);
    lines.push(reason || "This is the strongest balance of listed specifications and price among the supplied options. The recommendation is limited to the information in the returned product listings.");
  } else if (budget !== null && pricedCandidates.every((candidate) => candidate.lowest_listed_price! > budget)) {
    lines.push(`**Budget check:** None of the previous results is within your ${formatComparisonMoney(budget, currency)} budget. I won't recommend an over-budget option as if it fits.`);
  } else {
    lines.push("**Recommendation:** I can't confidently select a winner from the supplied specifications. Some important details are missing, so please compare the full manufacturer specifications before purchasing.");
    lines.push(reason);
  }

  lines.push("Prices and specifications are based on the previous Channel3 results, not a fresh live verification. I'll re-verify the selected merchant offer before creating any PayPal order.");
  return lines.join("\n\n");
}

type AuditEventInput = {
  request_id: string;
  session_id?: string | null;
  user_id?: string | null;
  event_type: string;
  action?: string | null;
  status?: "success" | "failed" | "pending";
  search_query?: string | null;
  merchant_domain?: string | null;
  product_id?: string | null;
  product_name?: string | null;
  amount?: number | null;
  currency?: string | null;
  paypal_order_id?: string | null;
  tool_name?: string | null;
  duration_ms?: number | null;
  filters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  error_message?: string | null;
};

type SupabaseWriteResult = { configured: boolean; saved: boolean; error?: string };

function getSupabaseServerConfig() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  // Prefer the current Supabase secret API key. Keep legacy service_role support
  // for existing projects during the migration period.
  const apiKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !apiKey) return null;
  return { url, apiKey, useLegacyBearer: !apiKey.startsWith("sb_secret_") };
}

function getSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 120 ? trimmed : null;
}

async function insertSupabaseRow(table: string, row: Record<string, unknown>): Promise<SupabaseWriteResult> {
  const config = getSupabaseServerConfig();
  if (!config) return { configured: false, saved: false };

  try {
    const response = await fetch(`${config.url}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: config.apiKey,
        ...(config.useLegacyBearer ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error(`PayAgent Supabase insert failed for ${table} (${response.status}):`, detail);
      return { configured: true, saved: false, error: `Supabase insert failed (${response.status}).` };
    }
    return { configured: true, saved: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown Supabase connection error";
    console.error(`PayAgent Supabase insert failed for ${table}:`, detail);
    return { configured: true, saved: false, error: detail };
  }
}

async function writeAuditEvent(event: AuditEventInput): Promise<SupabaseWriteResult> {
  return insertSupabaseRow("agent_activity_logs", {
    request_id: event.request_id,
    session_id: event.session_id ?? null,
    user_id: event.user_id ?? null,
    event_type: event.event_type,
    action: event.action ?? null,
    status: event.status ?? "success",
    search_query: event.search_query ? event.search_query.slice(0, 1000) : null,
    merchant_domain: event.merchant_domain ? event.merchant_domain.slice(0, 255) : null,
    product_id: event.product_id ? event.product_id.slice(0, 255) : null,
    product_name: event.product_name ? event.product_name.slice(0, 500) : null,
    amount: event.amount ?? null,
    currency: event.currency ?? null,
    paypal_order_id: event.paypal_order_id ?? null,
    tool_name: event.tool_name ?? null,
    duration_ms: event.duration_ms ?? null,
    filters: event.filters ?? {},
    metadata: event.metadata ?? {},
    error_message: event.error_message ? event.error_message.slice(0, 2000) : null,
  });
}

async function persistPayAgentOrder(input: {
  request_id: string;
  session_id: string | null;
  product: Channel3Product;
  merchant_domain: string;
  amount: number;
  currency: string;
  paypal_order_id: string;
  paypal_status: string;
}): Promise<SupabaseWriteResult> {
  return insertSupabaseRow("payagent_orders", {
    request_id: input.request_id,
    session_id: input.session_id,
    user_id: null,
    channel3_product_id: input.product.id,
    product_name: input.product.title,
    merchant_domain: input.merchant_domain,
    amount: input.amount,
    currency: input.currency,
    paypal_order_id: input.paypal_order_id,
    paypal_status: input.paypal_status,
    payment_status: "NOT_CAPTURED",
    metadata: {
      category: input.product.category?.title ?? null,
      brand_names: input.product.brands.map((brand) => brand.name),
    },
  });
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  let sessionId: string | null = null;

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    sessionId = getSessionId(body?.session_id);

    // Structured product-card selection: re-verify product and offer on the server before ordering.
    if (body?.selected_product) {
      const verification = await verifySelectedOffer(body.selected_product as SelectedProduct);
      if (!verification.success) {
        const selected = body.selected_product as SelectedProduct;
        const durationMs = Date.now() - startedAt;
        const audit = await writeAuditEvent({
          request_id: requestId,
          session_id: sessionId,
          event_type: "offer_verification",
          action: "paypal_order_draft",
          status: "failed",
          product_id: typeof selected?.product_id === "string" ? selected.product_id : null,
          product_name: typeof selected?.title === "string" ? selected.title : null,
          tool_name: "channel3_verify_selected_offer",
          duration_ms: durationMs,
          error_message: verification.error,
        });
        return NextResponse.json(
          {
            request_id: requestId,
            session_id: sessionId,
            message: verification.error,
            products: [],
            executed_tools: ["channel3_verify_selected_offer"],
            execution_time_seconds: (durationMs / 1000).toFixed(2),
            order: null,
            audit_persisted: audit.saved,
          },
          { status: 409 },
        );
      }

      const { product, offer } = verification;
      const merchant = offer.domain || "unknown merchant";
      const amount = offer.price.price!;
      await writeAuditEvent({
        request_id: requestId,
        session_id: sessionId,
        event_type: "offer_verification",
        action: "paypal_order_draft",
        status: "success",
        product_id: product.id,
        product_name: product.title,
        merchant_domain: merchant,
        amount,
        currency: offer.price.currency,
        tool_name: "channel3_verify_selected_offer",
        duration_ms: Date.now() - startedAt,
        metadata: { availability: offer.availability, condition: offer.condition },
      });
      const orderResult = await createPayPalOrder(product.title, amount, product.id, merchant);
      const duration = ((Date.now() - startedAt) / 1000).toFixed(2);

      if (!orderResult.success) {
        const audit = await writeAuditEvent({
          request_id: requestId,
          session_id: sessionId,
          event_type: "paypal_order_failed",
          action: "paypal_order_draft",
          status: "failed",
          product_id: product.id,
          product_name: product.title,
          merchant_domain: merchant,
          amount,
          currency: offer.price.currency,
          tool_name: "create_paypal_order",
          duration_ms: Date.now() - startedAt,
          error_message: orderResult.error,
        });
        return NextResponse.json(
          {
            request_id: requestId,
            session_id: sessionId,
            message: `I verified the current offer, but couldn't create the PayPal order: ${orderResult.error}`,
            products: [product],
            order: orderResult,
            executed_tools: ["channel3_verify_selected_offer", "create_paypal_order"],
            execution_time_seconds: duration,
            audit_persisted: audit.saved,
          },
          { status: 502 },
        );
      }

      const orderLedger = await persistPayAgentOrder({
        request_id: requestId,
        session_id: sessionId,
        product,
        merchant_domain: merchant,
        amount,
        currency: orderResult.currency,
        paypal_order_id: orderResult.order_id,
        paypal_status: orderResult.status,
      });
      const orderAudit = await writeAuditEvent({
        request_id: requestId,
        session_id: sessionId,
        event_type: "paypal_order_created",
        action: "paypal_order_draft",
        status: "success",
        product_id: product.id,
        product_name: product.title,
        merchant_domain: merchant,
        amount,
        currency: orderResult.currency,
        paypal_order_id: orderResult.order_id,
        tool_name: "create_paypal_order",
        duration_ms: Date.now() - startedAt,
        metadata: {
          paypal_status: orderResult.status,
          payment_status: "NOT_CAPTURED",
          order_ledger_saved: orderLedger.saved,
        },
      });

      const auditPersisted = orderLedger.saved && orderAudit.saved;
      const auditNotice = orderLedger.configured && !auditPersisted
        ? " The PayPal order exists, but the Supabase audit record could not be saved; check the server logs before treating the ledger as complete."
        : "";

      return NextResponse.json({
        request_id: requestId,
        session_id: sessionId,
        message: `Your PayPal Sandbox order has been created for ${product.title} at $${orderResult.amount} USD from ${merchant}. Review the order with PayPal and approve it there. Payment has not been captured.${auditNotice}`,
        products: [product],
        order: orderResult,
        approveUrl: orderResult.approve_url,
        approval_url: orderResult.approve_url,
        approve_url: orderResult.approve_url,
        executed_tools: ["channel3_verify_selected_offer", "create_paypal_order"],
        execution_time_seconds: duration,
        order_id: orderResult.order_id,
        audit_persisted: auditPersisted,
        audit_enabled: orderLedger.configured || orderAudit.configured,
        payment_status: "NOT_CAPTURED",
      });
    }

    const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
    const messages = rawMessages
      .filter((message: any) => message && (message.role === "user" || message.role === "assistant"))
      .slice(-12);
    const lastUserMessage = [...messages].reverse().find((message: any) => message.role === "user");
    const lastUserPrompt = String(lastUserMessage?.content ?? lastUserMessage?.text ?? "").trim();

    if (!lastUserPrompt) {
      return NextResponse.json({ error: "Please provide a user message." }, { status: 400 });
    }

    // Product snapshots are used only to answer follow-up questions. They are never
    // accepted as checkout authority; checkout still re-verifies against Channel3.
    const priorContext = [...messages]
      .reverse()
      .filter((message: any) => message.role === "assistant" && message.context)
      .map((message: any) => sanitizePriorContext(message.context))
      .find((context: PriorAssistantContext | null) => context !== null) ?? null;
    const contextualPriceFollowUp = Boolean(priorContext && isPriceRankingFollowUp(lastUserPrompt));
    const contextualMerchantFilters = priorContext ? detectMerchantOnlyFollowUp(lastUserPrompt) : [];
    const contextualMerchantFollowUp = Boolean(priorContext && contextualMerchantFilters.length > 0);
    const contextualEvaluationFollowUp = Boolean(
      priorContext
      && !contextualPriceFollowUp
      && !contextualMerchantFollowUp
      && isProductEvaluationFollowUp(lastUserPrompt),
    );
    const contextualSortBy: "price_asc" | "price_desc" =
      /\b(most expensive|priciest|highest price|highest priced)\b/i.test(lastUserPrompt)
        ? "price_desc"
        : "price_asc";

    const systemPrompt = `You are the intent parser for PayAgent Concierge. Return ONLY a valid JSON object with this shape:
{
  "action": "search" | "chat" | "order",
  "query": string | null,
  "max_price": number | null,
  "currency": string | null,
  "merchant_filters": string[],
  "required_features": string[],
  "sort_by": "price_asc" | "price_desc" | null
}
You receive the recent conversation, including summaries of previous product results. Resolve short follow-up questions using that context.
Rules:
1. Choose "search" for finding, searching, browsing, filtering or comparing products.
2. For a follow-up that changes one constraint (such as budget, merchant, feature or sort order), preserve the previous product query and all still-relevant filters; change only what the user changed.
3. For references such as "those", "the second one", "that keyboard", or "which one is cheaper", use the previous product results rather than treating the words as a new catalogue search.
4. Extract a numeric maximum budget from phrases such as 'under $60'. Treat a budget as a filter only, never as the amount to charge.
5. Extract currency codes when clearly supplied; otherwise preserve the previous currency or use USD.
6. Extract named merchants/domains into merchant_filters. For a comparison between named merchants, include every named merchant.
7. Extract concrete product specifications as short searchable feature keywords. Do not include generic words such as product, good, best or quality.
8. Set sort_by to price_asc for cheapest/lowest-price requests, or price_desc for most-expensive/highest-price requests.
9. If the user asks to draft or create an order without submitting a structured selected_product from a product card, choose "order" only to ask them to select a product card. Never invent an amount or create an order from natural-language text alone.
10. If the user asks to compare specifications, compare products, choose the best option, or make a recommendation and there are previous product results, evaluate those results instead of starting a new product search unless the user supplies a new product category or a changed numeric budget.
11. For ordinary conversation choose "chat".
`;

    const transcript = messages.map((message: any) => {
      const role = message.role;
      const content = String(message.content ?? message.text ?? "").slice(0, 2000);
      const context = role === "assistant" ? sanitizePriorContext(message.context) : null;
      const contextSummary = context
        ? `\nPrevious product results: ${context.products.slice(0, 8).map((product) => {
            const offers = product.offers.slice(0, 4).map((offer) =>
              `${offer.domain ?? "unknown merchant"} ${offer.price.price === null ? "price unavailable" : `${offer.price.currency} ${offer.price.price}`}`,
            ).join("; ");
            return `${product.title}: ${offers}`;
          }).join(" | ")}. Search query: ${context.search_query ?? "not supplied"}. Filters: ${JSON.stringify(context.applied_filters)}`
        : "";
      return `${role.toUpperCase()}: ${content}${contextSummary}`;
    }).join("\n");

    let intent: any;
    if (contextualPriceFollowUp && priorContext) {
      intent = {
        action: "search",
        query: priorContext.search_query || lastUserPrompt,
        max_price: priorContext.applied_filters.max_price,
        currency: priorContext.applied_filters.currency,
        merchant_filters: priorContext.applied_filters.merchant_filters,
        required_features: priorContext.applied_filters.required_features,
        sort_by: contextualSortBy,
      };
    } else if (contextualEvaluationFollowUp && priorContext) {
      intent = {
        action: "search",
        query: priorContext.search_query || lastUserPrompt,
        max_price: priorContext.applied_filters.max_price,
        currency: priorContext.applied_filters.currency,
        merchant_filters: priorContext.applied_filters.merchant_filters,
        required_features: priorContext.applied_filters.required_features,
        sort_by: priorContext.applied_filters.sort_by,
      };
    } else if (contextualMerchantFollowUp && priorContext) {
      intent = {
        action: "search",
        query: priorContext.search_query || lastUserPrompt,
        max_price: priorContext.applied_filters.max_price,
        currency: priorContext.applied_filters.currency,
        merchant_filters: contextualMerchantFilters,
        required_features: priorContext.applied_filters.required_features,
        sort_by: priorContext.applied_filters.sort_by,
      };
    } else {
      const completion = await getGroqClient().chat.completions.create({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Recent conversation:\n${transcript}\n\nClassify the latest user message: ${lastUserPrompt}` },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      });

      const rawContent = completion.choices[0]?.message?.content || "{}";
      try {
        intent = JSON.parse(rawContent);
      } catch {
        intent = { action: "chat" };
      }
    }

    const intentAction = intent.action === "search" || intent.action === "order" ? intent.action : "chat";
    const intentAudit = await writeAuditEvent({
      request_id: requestId,
      session_id: sessionId,
      event_type: "intent_classified",
      action: intentAction,
      status: "success",
      search_query: intentAction === "search" ? String(intent.query || lastUserPrompt).trim() : null,
      tool_name: contextualPriceFollowUp || contextualMerchantFollowUp || contextualEvaluationFollowUp ? "conversation_context" : "groq_intent_parser",
      duration_ms: Date.now() - startedAt,
      filters: {
        max_price: asNullableNumber(intent.max_price),
        currency: typeof intent.currency === "string" ? intent.currency.toUpperCase() : "USD",
        merchant_filters: getStringArray(intent.merchant_filters, 8),
        required_features: getStringArray(intent.required_features, 8),
      },
      metadata: {
        sort_by: intent.sort_by === "price_desc" ? "price_desc" : "price_asc",
        contextual_follow_up: contextualPriceFollowUp || contextualMerchantFollowUp || contextualEvaluationFollowUp,
        contextual_follow_up_type: contextualPriceFollowUp ? "price_ranking" : contextualMerchantFollowUp ? "merchant_filter" : contextualEvaluationFollowUp ? "product_evaluation" : null,
      },
    });
    let actionAuditEnabled = intentAudit.configured;
    let actionAuditPersisted = intentAudit.saved;

    const executedTools: string[] = [];
    let finalMessage: string;
    let products: Channel3Product[] = [];
    let productCount = 0;
    let nextPageToken: string | null = null;
    let comparison: MerchantComparison | null = null;
    let responseMerchantFilters: string[] = [];

    if (contextualEvaluationFollowUp && priorContext) {
      products = [...priorContext.products];
      productCount = products.length;
      comparison = priorContext.comparison;
      responseMerchantFilters = priorContext.applied_filters.merchant_filters;
      finalMessage = await buildContextualProductEvaluation(
        products,
        priorContext.applied_filters.currency,
        priorContext.applied_filters.max_price,
        lastUserPrompt,
      );
      executedTools.push("conversation_context_product_evaluation");

      const evaluationAudit = await writeAuditEvent({
        request_id: requestId,
        session_id: sessionId,
        event_type: "product_search",
        action: "contextual_product_evaluation",
        status: "success",
        search_query: priorContext.search_query || lastUserPrompt,
        tool_name: "conversation_context_evaluator",
        duration_ms: Date.now() - startedAt,
        filters: {
          max_price: priorContext.applied_filters.max_price,
          currency: priorContext.applied_filters.currency,
          merchant_filters: priorContext.applied_filters.merchant_filters,
          required_features: priorContext.applied_filters.required_features,
          sort_by: priorContext.applied_filters.sort_by,
        },
        metadata: {
          contextual_follow_up: true,
          source: "previous_assistant_product_results",
          product_count: productCount,
        },
      });
      actionAuditEnabled = actionAuditEnabled || evaluationAudit.configured;
      actionAuditPersisted = actionAuditPersisted && evaluationAudit.saved;
    } else if (contextualPriceFollowUp && priorContext) {
      products = [...priorContext.products].sort((a, b) => {
        const aPrice = getComparableProductPrice(a, priorContext.applied_filters.currency);
        const bPrice = getComparableProductPrice(b, priorContext.applied_filters.currency);
        if (aPrice === null && bPrice === null) return 0;
        if (aPrice === null) return 1;
        if (bPrice === null) return -1;
        return contextualSortBy === "price_desc" ? bPrice - aPrice : aPrice - bPrice;
      });
      productCount = products.length;
      comparison = priorContext.comparison;
      responseMerchantFilters = priorContext.applied_filters.merchant_filters;
      finalMessage = buildContextualPriceMessage(
        products,
        priorContext.applied_filters.currency,
        contextualSortBy,
      );
      executedTools.push("conversation_context_price_comparison");

      const contextAudit = await writeAuditEvent({
        request_id: requestId,
        session_id: sessionId,
        event_type: "product_search",
        action: "contextual_price_comparison",
        status: "success",
        search_query: priorContext.search_query || lastUserPrompt,
        tool_name: "conversation_context",
        duration_ms: Date.now() - startedAt,
        filters: {
          max_price: priorContext.applied_filters.max_price,
          currency: priorContext.applied_filters.currency,
          merchant_filters: priorContext.applied_filters.merchant_filters,
          required_features: priorContext.applied_filters.required_features,
          sort_by: contextualSortBy,
        },
        metadata: {
          contextual_follow_up: true,
          source: "previous_assistant_product_results",
          product_count: productCount,
        },
      });
      actionAuditEnabled = actionAuditEnabled || contextAudit.configured;
      actionAuditPersisted = actionAuditPersisted && contextAudit.saved;
    } else if (intent.action === "search" || intent.query) {
      const query = String(intent.query || lastUserPrompt).trim();
      const maxPrice = asNullableNumber(intent.max_price);
      const currency = typeof intent.currency === "string" && /^[A-Za-z]{3}$/.test(intent.currency)
        ? intent.currency.toUpperCase()
        : "USD";
      const merchantFilters = extractMerchantFilters(intent.merchant_filters, lastUserPrompt);
      responseMerchantFilters = merchantFilters;
      const requiredFeatures = getStringArray(intent.required_features, 8);
      const sortBy = intent.sort_by === "price_desc" ? "price_desc" : "price_asc";

      executedTools.push("channel3_product_search");
      const search = await searchProductsChannel3(query, {
        maxPrice,
        currency,
        merchantFilters,
        requiredFeatures,
        sortBy,
        // A merchant-only follow-up searches a wider candidate set so a
        // matching merchant offer is less likely to be missed in the first page.
        limit: contextualMerchantFollowUp ? 30 : 10,
      });

      if (!search.success) {
        const audit = await writeAuditEvent({
          request_id: requestId,
          session_id: sessionId,
          event_type: "product_search",
          action: "search",
          status: "failed",
          search_query: query,
          tool_name: "channel3_product_search",
          duration_ms: Date.now() - startedAt,
          filters: {
            max_price: maxPrice,
            currency,
            merchant_filters: merchantFilters,
            required_features: requiredFeatures,
            sort_by: sortBy,
          },
          error_message: search.error,
        });
        actionAuditEnabled = actionAuditEnabled || audit.configured;
        actionAuditPersisted = actionAuditPersisted && audit.saved;
        return NextResponse.json(
          {
            request_id: requestId,
            session_id: sessionId,
            message: "I couldn't complete the product search. Please try again.",
            products: [],
            executed_tools: executedTools,
            execution_time_seconds: ((Date.now() - startedAt) / 1000).toFixed(2),
            error: search.error,
            audit_persisted: audit.saved,
          },
          { status: 502 },
        );
      }

      products = search.products;
      productCount = search.count;
      nextPageToken = search.next_page_token;

      if (merchantFilters.length >= 2 && productCount > 0) {
        comparison = buildMerchantComparison(products, merchantFilters);
        finalMessage = buildComparisonMessage(comparison);
      } else {
        finalMessage = productCount > 0
          ? `I found ${productCount} matching product${productCount === 1 ? "" : "s"}. ${maxPrice !== null ? `I applied your ${currency} ${maxPrice} budget. ` : ""}${merchantFilters.length ? `Merchant filter: ${merchantFilters.join(", ")}. ` : ""}${requiredFeatures.length ? `Required features: ${requiredFeatures.join(", ")}. ` : ""}Offers are sorted by ${sortBy === "price_desc" ? "highest" : "lowest"} listed price. The merchant offers and prices are shown below.`
          : contextualMerchantFollowUp
            ? `I couldn't find matching ${merchantFilters.join(" / ")} offers for ${query} in the latest Channel3 results. Your previous product query and other filters were retained. You can try a broader product search or another merchant.`
            : `I couldn't find products matching those filters. Try removing a merchant or feature filter, or use a broader search.`;
      }

      const searchAudit = await writeAuditEvent({
        request_id: requestId,
        session_id: sessionId,
        event_type: comparison ? "merchant_comparison" : "product_search",
        action: comparison ? "compare" : "search",
        status: "success",
        search_query: query,
        tool_name: "channel3_product_search",
        duration_ms: Date.now() - startedAt,
        filters: {
          max_price: maxPrice,
          currency,
          merchant_filters: merchantFilters,
          required_features: requiredFeatures,
          sort_by: sortBy,
        },
        metadata: {
          product_count: productCount,
          offer_count: products.reduce((total, product) => total + product.offers.length, 0),
          product_ids: products.map((product) => product.id).slice(0, 50),
          next_page_available: Boolean(nextPageToken),
          comparison_best_offer: comparison?.best_overall_offer ?? null,
        },
      });
      // Supabase logging is deliberately best-effort: an audit outage must not break product search.
      actionAuditEnabled = actionAuditEnabled || searchAudit.configured;
      actionAuditPersisted = actionAuditPersisted && searchAudit.saved;
      if (searchAudit.configured && !searchAudit.saved) {
        console.warn("PayAgent search completed but its Supabase audit event was not persisted.");
      }
    } else if (intent.action === "order") {
      finalMessage = "Choose a product card and select Draft PayPal order beside the merchant offer you want. I will re-check its current Channel3 price before creating the PayPal order.";
    } else {
      finalMessage = "I'm PayAgent Concierge. Ask me to find products, filter by budget or merchant, compare offers, or prepare a PayPal order from a selected product offer.";
    }

    if (intentAction === "chat" || intentAction === "order") {
      const chatAudit = await writeAuditEvent({
        request_id: requestId,
        session_id: sessionId,
        event_type: "chat_request",
        action: intentAction,
        status: "success",
        tool_name: "groq_intent_parser",
        duration_ms: Date.now() - startedAt,
      });
      actionAuditEnabled = actionAuditEnabled || chatAudit.configured;
      actionAuditPersisted = actionAuditPersisted && chatAudit.saved;
    }

    return NextResponse.json({
      request_id: requestId,
      session_id: sessionId,
      message: finalMessage,
      audit_enabled: actionAuditEnabled,
      audit_persisted: actionAuditPersisted,
      products,
      product_count: productCount,
      comparison,
      comparison_requested: /\b(compare|comparison|versus|vs\.?)\b/i.test(lastUserPrompt) && responseMerchantFilters.length >= 2,
      comparison_merchants: responseMerchantFilters,
      next_page_token: nextPageToken,
      executed_tools: executedTools,
      execution_time_seconds: ((Date.now() - startedAt) / 1000).toFixed(2),
      search_query: (contextualPriceFollowUp || contextualMerchantFollowUp || contextualEvaluationFollowUp) && priorContext
        ? priorContext.search_query
        : String(intent.query || lastUserPrompt).trim(),
      applied_filters: contextualPriceFollowUp && priorContext
        ? { ...priorContext.applied_filters, sort_by: contextualSortBy }
        : (contextualMerchantFollowUp || contextualEvaluationFollowUp) && priorContext
          ? priorContext.applied_filters
          : {
            max_price: asNullableNumber(intent.max_price),
            currency: typeof intent.currency === "string" ? intent.currency.toUpperCase() : "USD",
            merchant_filters: responseMerchantFilters,
            required_features: getStringArray(intent.required_features, 8),
            sort_by: intent.sort_by === "price_desc" ? "price_desc" : "price_asc",
          },
      debug_intent: intent,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    console.error("PayAgent chat route error:", error);
    await writeAuditEvent({
      request_id: requestId,
      session_id: sessionId,
      event_type: "server_error",
      action: "chat_request",
      status: "failed",
      tool_name: "chat_api",
      duration_ms: Date.now() - startedAt,
      error_message: message,
    });
    return NextResponse.json({ request_id: requestId, error: message }, { status: 500 });
  }
}
