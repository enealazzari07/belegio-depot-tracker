// Marktdaten-Fassade: mehrere Anbieter, ein Interface.
// Neue Quelle = Datei in providers/ mit quote/news/search + id/label/defaultKey,
// dann hier in PROVIDERS eintragen.

import * as alphavantage from "./providers/alphavantage.js";
import * as finnhub from "./providers/finnhub.js";

export const PROVIDERS = { alphavantage, finnhub };
export const PROVIDER_LIST = Object.values(PROVIDERS).map(p => ({ id: p.id, label: p.label }));

const KEYS = "belegio.keys";
const ACTIVE = "belegio.provider";
const CACHE = "belegio.quoteCache";
const TTL = 15 * 60 * 1000; // Alpha Vantage free: 25 Calls/Tag

const read = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch (e) { return fb; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

export function activeId() {
  const a = read(ACTIVE, null);
  return PROVIDERS[a] ? a : "alphavantage";
}
export const setActive = id => write(ACTIVE, id);
export const provider = () => PROVIDERS[activeId()];

export function keys() {
  const stored = read(KEYS, {});
  const out = {};
  for (const p of Object.values(PROVIDERS)) out[p.id] = stored[p.id] ?? p.defaultKey ?? "";
  return out;
}
export const getKey = id => keys()[id || activeId()] || "";
export function setKey(id, key) {
  const all = read(KEYS, {});
  all[id] = (key || "").trim();
  write(KEYS, all);
}

// Kurse: pro Symbol gecacht, Fehler einzelner Symbole werden übersprungen.
export async function quotes(symbols) {
  const p = provider(), key = getKey(), cache = read(CACHE, {});
  const out = {};
  let dirty = false, fatal = null;
  for (const s of symbols) {
    const hit = cache[p.id + ":" + s];
    if (hit && Date.now() - hit.at < TTL) { out[s] = hit.data; continue; }
    try {
      const data = await p.quote(s, key);
      out[s] = data;
      cache[p.id + ":" + s] = { at: Date.now(), data };
      dirty = true;
    } catch (e) {
      if (e.message === "bad-key" || e.message === "rate-limit" || e.message === "no-key") fatal = e.message;
    }
  }
  if (dirty) write(CACHE, cache);
  if (!Object.keys(out).length && fatal) throw new Error(fatal);
  return out;
}

export async function news(symbols, limit = 12) {
  return provider().news(symbols, getKey(), limit);
}

export async function search(term) {
  return provider().search(term, getKey());
}
