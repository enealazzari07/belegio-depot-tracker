// Marktdaten-Fassade: ruft die Supabase Edge Function "market" auf.
// Provider-Keys liegen serverseitig — der Client sieht sie nie.
import { callMarket } from "./db.js";

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
