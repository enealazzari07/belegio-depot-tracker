import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Dividendenhistorie (Yahoo Finance chart events=div, ohne Key) plus der
// Yahoo-Kalender (quoteSummary calendarEvents): naechste Quartalszahlen,
// bestaetigter Ex-Tag und Zahltag — fuer mehrere Symbole auf einmal.
const YF1 = "https://query1.finance.yahoo.com";
const YF2 = "https://query2.finance.yahoo.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// quoteSummary verlangt Cookie + Crumb. Beides einmal pro Aufruf holen.
async function yahooAuth(): Promise<{ cookie: string; crumb: string } | null> {
  try {
    const r1 = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual" });
    const raw = r1.headers.get("set-cookie") || "";
    const cookie = raw.split(/,(?=\s*[A-Za-z0-9_]+=)/).map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
    if (!cookie) return null;
    const r2 = await fetch(`${YF2}/v1/test/getcrumb`, { headers: { "User-Agent": UA, Cookie: cookie } });
    const crumb = (await r2.text()).trim();
    if (!r2.ok || !crumb || crumb.includes("<")) return null;
    return { cookie, crumb };
  } catch (_e) { return null; }
}

async function divs(symbol: string) {
  const url = `${YF1}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1mo&range=3y&events=div`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const d = await res.json();
  const r = d?.chart?.result?.[0];
  if (!r) return null;
  const evs = r.events?.dividends || {};
  const list = Object.values(evs).map((e: any) => ({ t: e.date * 1000, a: e.amount })).sort((x: any, y: any) => x.t - y.t);
  return { currency: r.meta?.currency || null, price: r.meta?.regularMarketPrice ?? null, divs: list };
}

async function calendar(symbol: string, auth: { cookie: string; crumb: string } | null) {
  if (!auth) return null;
  const url = `${YF2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents&crumb=${encodeURIComponent(auth.crumb)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Cookie: auth.cookie } });
  if (!res.ok) return null;
  const d = await res.json();
  const c = d?.quoteSummary?.result?.[0]?.calendarEvents;
  if (!c) return null;
  const ms = (x: any) => (x && typeof x.raw === "number" ? x.raw * 1000 : null);
  return {
    earnings: (c.earnings?.earningsDate || []).map(ms).filter(Boolean),
    earningsEst: !!c.earnings?.isEarningsDateEstimate?.raw,
    exDiv: ms(c.exDividendDate),
    payDate: ms(c.dividendDate),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    let body: any = {};
    try { body = await req.json(); } catch (_e) { body = {}; }
    const symbols: string[] = (Array.isArray(body.symbols) ? body.symbols : []).map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 30);
    if (!symbols.length) throw new Error("missing-symbols");
    const auth = await yahooAuth();
    const out: Record<string, unknown> = {};
    await Promise.all(symbols.map(async s => {
      const [dv, cal] = await Promise.all([divs(s).catch(() => null), calendar(s, auth).catch(() => null)]);
      if (dv || cal) out[s] = { symbol: s, ...(dv || { currency: null, price: null, divs: [] }), cal };
    }));
    return new Response(JSON.stringify(out), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
