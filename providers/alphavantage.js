// Alpha-Vantage-Anbieter. Free-Tier: 25 Calls/Tag, 5/Min — deshalb aggressiv cachen.

const BASE = "https://www.alphavantage.co/query";

export const id = "alphavantage";
export const label = "Alpha Vantage";
export const defaultKey = "OTCPQEMS3OTU4TVV";

async function call(params, key) {
  if (!key) throw new Error("no-key");
  const q = new URLSearchParams({ ...params, apikey: key });
  const res = await fetch(BASE + "?" + q, { cache: "no-store" });
  if (!res.ok) throw new Error("http-" + res.status);
  const d = await res.json();
  if (d["Error Message"]) throw new Error("bad-key");
  if (d.Note || d.Information) throw new Error("rate-limit");
  return d;
}

// Alpha Vantage kennt Schweizer Titel als "NESN.SWI" statt "NESN.SW".
const mapSymbol = s => (s.endsWith(".SW") ? s.slice(0, -3) + ".SWI" : s);

export async function quote(symbol, key) {
  const d = await call({ function: "GLOBAL_QUOTE", symbol: mapSymbol(symbol) }, key);
  const g = d["Global Quote"] || {};
  const c = parseFloat(g["05. price"]);
  if (!c) throw new Error("no-data");
  return { c, dp: parseFloat(String(g["10. change percent"] || "0").replace("%", "")) || 0, t: Date.parse(g["07. latest trading day"] || "") || 0 };
}

export async function news(symbols, key, limit = 12) {
  const d = await call({ function: "NEWS_SENTIMENT", tickers: symbols.map(mapSymbol).join(","), limit: String(limit) }, key);
  return (d.feed || []).slice(0, limit).map(r => ({
    symbol: (r.ticker_sentiment && r.ticker_sentiment[0] && r.ticker_sentiment[0].ticker) || symbols[0],
    headline: r.title,
    summary: r.summary,
    source: r.source,
    url: r.url,
    // Format: 20260804T091500
    datetime: Date.parse(String(r.time_published || "").replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/, "$1-$2-$3T$4:$5:$6Z")) || Date.now()
  }));
}

export async function search(term, key) {
  const d = await call({ function: "SYMBOL_SEARCH", keywords: term }, key);
  return (d.bestMatches || []).slice(0, 8).map(r => ({
    symbol: r["1. symbol"], name: r["2. name"], type: r["3. type"], currency: r["8. currency"]
  }));
}
