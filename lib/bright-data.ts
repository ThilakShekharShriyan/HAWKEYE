// Live public web results for shopping questions. Bright Data's SERP API
// returns Google as JSON, so "what should I buy" can name a real listing
// instead of inventing a shop.

export type WebOffer = { title: string; url: string; snippet: string };

const ENDPOINT = "https://api.brightdata.com/request";

export function hasBrightData() {
  return Boolean(process.env.BRIGHT_DATA_API_KEY && process.env.BRIGHT_DATA_ZONE);
}

function offersFrom(payload: unknown): WebOffer[] {
  const root = typeof payload === "string" ? (JSON.parse(payload) as unknown) : payload;
  if (!root || typeof root !== "object") return [];
  const record = root as Record<string, unknown>;
  const nested = typeof record.body === "string" ? offersFrom(record.body) : [];
  const list = (record.organic ?? record.organic_results ?? []) as unknown[];
  const parsed = list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const title = String(row.title ?? row.name ?? "").trim();
    const url = String(row.link ?? row.url ?? "").trim();
    const snippet = String(row.description ?? row.snippet ?? "").trim();
    if (!title || !url) return [];
    return [{ title, url, snippet }];
  });
  return parsed.length > 0 ? parsed : nested;
}

/** One Google search for the items that are running out. Empty when unset or the call fails. */
export async function searchShopping(items: string[]): Promise<WebOffer[]> {
  const names = items.map((item) => item.trim()).filter(Boolean).slice(0, 4);
  if (!hasBrightData() || names.length === 0) return [];
  const query = `buy ${names.join(" ")}`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us&num=5&brd_json=1`;
  const response = await fetch(ENDPOINT, {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      Authorization: `Bearer ${process.env.BRIGHT_DATA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      zone: process.env.BRIGHT_DATA_ZONE,
      url,
      format: "raw",
      country: process.env.BRIGHT_DATA_COUNTRY ?? "us",
    }),
  });
  if (!response.ok) {
    throw new Error(`bright data ${response.status}: ${(await response.text()).slice(0, 180)}`);
  }
  const text = await response.text();
  try {
    return offersFrom(JSON.parse(text) as unknown).slice(0, 4);
  } catch {
    return offersFrom(text).slice(0, 4);
  }
}
