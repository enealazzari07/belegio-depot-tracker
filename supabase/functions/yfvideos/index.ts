import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Yahoo-Finance-Videos zu den Titeln des Nutzers plus allgemeine Markt-Videos.
// Quelle: Yahoo-Suche (v1/finance/search) — die News-Treffer enthalten neben
// Artikeln auch Videos (type "VIDEO"). Kein Key noetig.
const YF = "https://query1.finance.yahoo.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function search(q: string) {
  const url = `${YF}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=0&newsCount=25&enableFuzzyQuery=false`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return [];
  const d = await res.json();
  return (d?.news || []) as any[];
}

// Aktuelle Livestream-ID des offiziellen Yahoo-Finance-YouTube-Kanals (fuer das
// eingebettete Video). Faellt still auf null zurueck — der Client nutzt dann den
// Kanal-Livestream-Embed.
const YT_CHANNEL = "UCEAZeUIeJs0IjQiqTCdVSIg";
async function liveId(): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/channel/${YT_CHANNEL}/live`, {
      headers: { "User-Agent": UA, "Accept-Language": "en", Cookie: "CONSENT=YES+1; SOCS=CAI" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const i = html.indexOf("currentVideoEndpoint");
    if (i < 0 || !html.includes('"isLive":true')) return null;
    const m = html.slice(i, i + 1500).match(/"videoId":"([A-Za-z0-9_-]{11})"/);
    return m ? m[1] : null;
  } catch (_e) { return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    let body: any = {};
    try { body = await req.json(); } catch (_e) { body = {}; }
    const symbols: string[] = (Array.isArray(body.symbols) ? body.symbols : []).map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 12);
    const queries = [...symbols, "stock market", "Yahoo Finance video"];
    const seen = new Set<string>();
    const out: any[] = [];
    const liveP = liveId();
    const all = await Promise.all(queries.map(q => search(q).then(items => items.map(n => ({ n, q }))).catch(() => [])));
    for (const list of all) for (const { n, q } of list) {
      if (!n || !n.uuid || seen.has(n.uuid)) continue;
      seen.add(n.uuid);
      const res = n.thumbnail?.resolutions || [];
      const img = (res.find((r: any) => r.tag === "original") || res[0] || {}).url || null;
      out.push({
        id: n.uuid, title: n.title, publisher: n.publisher, url: n.link, time: (n.providerPublishTime || 0) * 1000,
        type: n.type, video: n.type === "VIDEO", img, symbol: symbols.includes(q) ? q : null,
        related: n.relatedTickers || [],
      });
    }
    out.sort((a, b) => b.time - a.time);
    return new Response(JSON.stringify({ items: out.slice(0, 60), liveId: await liveP }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
