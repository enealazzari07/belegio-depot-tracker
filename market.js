// Marktdaten-Fassade: ruft die Supabase Edge Function "market" auf.
// Provider-Keys liegen serverseitig — der Client sieht sie nie.
import { callMarket, supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./db.js";

export async function quotes(symbols) {
  return callMarket("quotes", { symbols });
}

export async function news(symbols, limit = 12) {
  return callMarket("news", { symbols, limit });
}

export async function search(term) {
  return callMarket("search", { term });
}

export async function history(symbols) {
  return callMarket("history", { symbols });
}

export async function etfHoldings(symbol) {
  return callMarket("etf", { symbol });
}

// Nur fuer die Maerkte-Suche/Aktien-Detailansicht: laeuft ausschliesslich ueber
// Yahoo (unlimitiert), nie ueber die auf 20 Requests/Tag limitierte
// Schweiz-Quelle (EODHD).
export async function marketSearch(term) {
  return callMarket("marketSearch", { term });
}

export async function stockDetail(symbol) {
  return callMarket("stockDetail", { symbol });
}

// SEC-Insider-Trades (Form 4, echte Kauf/Verkauf-Meldungen von Firmeninsidern).
// Kostenlos ueber SEC EDGAR — liefert fuer nicht bei der SEC meldepflichtige
// Symbole (z. B. .SW) einfach ein leeres Array statt eines Fehlers.
export async function insiderTrades(symbols) {
  return callMarket("insiderTrades", { symbols });
}

// Feine Kursverlaeufe (Yahoo): "1d" = 5-Min-Kerzen, "5d" = 30 Min, "1mo" = 1 Std.
export async function intradaySeries(symbol, range) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token || SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/intraday`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ symbol, range }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "intraday-error");
  return body;
}

// Artikelbilder zu News-Links: { <artikel-url>: <bild-url> } (Yahoo-Vorschaubilder).
export async function newsImages(symbols) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token || SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/newsimg`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ symbols }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "newsimg-error");
  return body.images || {};
}

// Firmensitz-Fotos (Wikimedia Commons, nur CC0/Public Domain/CC BY) inkl. Namensnennung.
export async function hqImages(items) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token || SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/hqimg`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ items }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "hqimg-error");
  return body.images || {};
}
