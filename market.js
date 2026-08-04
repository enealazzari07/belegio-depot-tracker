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
