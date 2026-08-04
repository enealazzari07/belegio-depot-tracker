// Finnhub-Anbieter (gleiche Signatur wie alphavantage.js).

const BASE = "https://finnhub.io/api/v1";

export const id = "finnhub";
export const label = "Finnhub";
export const defaultKey = "";

async function call(path, params, key) {
  if (!key) throw new Error("no-key");
  const q = new URLSearchParams({ ...params, token: key });
  const res = await fetch(BASE + path + "?" + q, { cache: "no-store" });
  if (res.status === 401 || res.status === 403) throw new Error("bad-key");
  if (res.status === 429) throw new Error("rate-limit");
  if (!res.ok) throw new Error("http-" + res.status);
  return res.json();
}

export async function quote(symbol, key) {
  const d = await call("/quote", { symbol }, key);
  if (!d || typeof d.c !== "number" || d.c === 0) throw new Error("no-data");
  return { c: d.c, dp: d.dp ?? 0, t: (d.t || 0) * 1000 };
}

export async function news(symbols, key, limit = 12) {
  const to = new Date(), from = new Date(to.getTime() - 7 * 864e5);
  const iso = d => d.toISOString().slice(0, 10);
  const all = [];
  for (const s of symbols) {
    try {
      const rows = await call("/company-news", { symbol: s, from: iso(from), to: iso(to) }, key);
      for (const r of (rows || []).slice(0, 4)) {
        all.push({ symbol: s, headline: r.headline, summary: r.summary, source: r.source, url: r.url, datetime: r.datetime * 1000 });
      }
    } catch (e) { if (e.message === "bad-key") throw e; }
  }
  return all.sort((a, b) => b.datetime - a.datetime).slice(0, limit);
}

export async function search(term, key) {
  const d = await call("/search", { q: term }, key);
  return (d.result || []).slice(0, 8).map(r => ({ symbol: r.symbol, name: r.description, type: r.type }));
}
