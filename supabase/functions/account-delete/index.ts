import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// Konto-Loeschung mit Mail-Bestaetigung und 24 h Wartezeit.
// Aktionen:
//   request      (eingeloggt)  -> Mail mit 6-stelligem Code (15 min gueltig, max. 5 Versuche)
//   confirm-code (eingeloggt, {code}) -> Loeschung in 24 h einplanen, Info-Mail
//   confirm / cancel (Token)   -> alte Link-Variante, bleibt fuer bereits verschickte Mails
//   cancel-auth  (eingeloggt)  -> geplante Loeschung in der App abbrechen
//   status       (eingeloggt)  -> geplante Loeschung abfragen
//   run          (x-cron-secret) -> faellige Konten endgueltig loeschen (stuendlich per pg_cron)
// Versand per SMTP, Zugangsdaten in public.app_secrets (wie auth-mail).
// Mail-Design wie die Supabase-Vorlagen: Login-Hintergrund, grosses Logo, weisse Box.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
class Fail extends Error { constructor(code: string, public status = 400) { super(code); } }

const WAIT_MS = 24 * 3600_000;

async function secrets(): Promise<Record<string, string>> {
  const { data } = await admin.from("app_secrets").select("key, value")
    .in("key", ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "mail_from", "mail_from_name", "app_url", "cron_secret"]);
  const out: Record<string, string> = {};
  for (const r of data || []) out[r.key] = r.value;
  return out;
}
const mailReady = (s: Record<string, string>) => !!(s.smtp_host && s.smtp_user && s.smtp_pass && s.mail_from);
const appUrlOf = (s: Record<string, string>) => (s.app_url || "https://belegio-depot-tracker.vercel.app").replace(/\/$/, "");

function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function newToken(userId: string, kind: "delete" | "delete_cancel", ttlMs: number) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const { error } = await admin.from("auth_tokens").insert({
    user_id: userId, kind, token_hash: await sha256(token), expires_at: new Date(Date.now() + ttlMs).toISOString(),
  });
  if (error) throw new Fail("token-error", 500);
  return token;
}
async function rateLimited(userId: string, kind: string) {
  const { data } = await admin.from("auth_tokens").select("created_at")
    .eq("user_id", userId).eq("kind", kind).order("created_at", { ascending: false }).limit(1);
  const last = data?.[0]?.created_at;
  return !!last && Date.now() - new Date(last).getTime() < 60_000;
}
async function takeToken(token: string, kind: string) {
  if (!token || typeof token !== "string" || token.length > 100) throw new Fail("invalid-token");
  const { data } = await admin.from("auth_tokens").select("id, user_id, expires_at, used_at")
    .eq("token_hash", await sha256(token)).eq("kind", kind).maybeSingle();
  if (!data || data.used_at) throw new Fail("invalid-token");
  if (new Date(data.expires_at).getTime() < Date.now()) throw new Fail("expired-token");
  await admin.from("auth_tokens").update({ used_at: new Date().toISOString() }).eq("id", data.id);
  return data;
}
// 6-stelliger Code, gehasht zusammen mit der User-ID (Codes sind kurz).
async function newCode(userId: string, ttlMs: number) {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const code = String(n).padStart(6, "0");
  const { error } = await admin.from("auth_tokens").insert({
    user_id: userId, kind: "delete", token_hash: await sha256(userId + ":" + code), expires_at: new Date(Date.now() + ttlMs).toISOString(),
  });
  if (error) throw new Fail("token-error", 500);
  return code;
}
async function takeCode(userId: string, code: string) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) throw new Fail("invalid-code");
  const { data } = await admin.from("auth_tokens").select("id, token_hash, expires_at, attempts")
    .eq("user_id", userId).eq("kind", "delete").is("used_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) throw new Fail("invalid-code");
  if (new Date(data.expires_at).getTime() < Date.now()) throw new Fail("expired-code");
  if (data.attempts >= 5) throw new Fail("too-many-attempts", 429);
  if (data.token_hash !== await sha256(userId + ":" + c)) {
    await admin.from("auth_tokens").update({ attempts: data.attempts + 1 }).eq("id", data.id);
    throw new Fail("invalid-code");
  }
  await admin.from("auth_tokens").update({ used_at: new Date().toISOString() }).eq("id", data.id);
}

async function authUser(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data } = await admin.auth.getUser(jwt);
  if (!data?.user?.email) throw new Fail("unauthorized", 401);
  return data.user;
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fmtDate = (iso: string) => new Date(iso).toLocaleString("de-CH", { timeZone: "Europe/Zurich", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " Uhr";

// Mail-Design wie die Supabase-Vorlagen (scripts/build-mail-templates.py):
// Login-Hintergrundbild, grosses Logo, weisse abgerundete Box.
function mailHtml(appUrl: string, o: { pre: string; title: string; text: string; cta?: string; link?: string; code?: string; note: string; danger?: boolean; icon?: string }) {
  const font = "'Nunito',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const bg = `${appUrl}/img/mail-bg.jpg`;
  const btn = o.cta && o.link ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="${o.danger ? "#C0453A" : "#16171D"}" style="border-radius:999px;background:${o.danger ? "#C0453A" : "#16171D"}">
<a href="${o.link}" style="display:block;padding:17px 24px;font-family:${font};font-size:15.5px;font-weight:800;color:#FFFFFF;text-decoration:none;border-radius:999px">${esc(o.cta)}</a></td></tr></table>` : "";
  const codeBox = o.code ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="#EEF0FB" style="border-radius:22px;background:#EEF0FB;padding:22px 10px">
<span style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:36px;font-weight:800;letter-spacing:12px;color:#16171D">${esc(o.code)}</span></td></tr></table>` : "";
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>${esc(o.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#EEF0F5;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#EEF0F5" style="background:#EEF0F5"><tr><td align="center" style="padding:28px 12px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
<tr><td background="${bg}" bgcolor="#A3ACF6" style="background:#A3ACF6 url('${bg}') center top / cover no-repeat;border-radius:36px;padding:46px 12px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:0 20px"><img src="${appUrl}/img/stox-logo.png" width="190" alt="Stox" style="display:block;width:190px;max-width:70%;height:auto;border:0;margin:0 auto">
<p style="margin:14px 0 0;font-family:${font};font-size:15px;font-weight:600;color:#2A2C3A;opacity:.8">Dein Depot, ohne Tabellen.</p></td></tr>
<tr><td style="height:40px;line-height:40px;font-size:0">&nbsp;</td></tr>
<tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:28px;padding:36px 28px 30px;box-shadow:0 18px 40px -22px rgba(20,24,60,.35)">
<h1 style="margin:0 0 12px;font-family:${font};font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-.5px;color:#16171D">${esc(o.title)}</h1>
<p style="margin:0 0 26px;font-family:${font};font-size:15px;line-height:1.6;color:#5F6576">${esc(o.text)}</p>
${codeBox}${btn}
<p style="margin:24px 0 0;font-family:${font};font-size:12.5px;line-height:1.55;color:#9096A5">${esc(o.note)}</p>
</td></tr></table>
</td></tr>
<tr><td align="center" style="padding:22px 20px 0;font-family:${font};font-size:12px;line-height:1.6;color:#9298A8">Stox · Dein Depot, ohne Tabellen.</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendMail(s: Record<string, string>, to: string, subject: string, html: string, text: string) {
  const port = Number(s.smtp_port) || 587;
  const client = new SMTPClient({ connection: { hostname: s.smtp_host, port, tls: port === 465, auth: { username: s.smtp_user, password: s.smtp_pass } } });
  try {
    await client.send({ from: `${s.mail_from_name || "Stox"} <${s.mail_from}>`, to, subject, content: text, html });
  } catch (e) {
    console.error("mail-send-failed", e);
    throw new Fail("mail-send-failed", 502);
  } finally {
    try { await client.close(); } catch (_e) { /* schon zu */ }
  }
}

async function pending(userId: string) {
  const { data } = await admin.from("account_deletions").select("scheduled_for, cancelled_at, done_at").eq("user_id", userId).maybeSingle();
  return data && !data.cancelled_at && !data.done_at ? data : null;
}

async function request(req: Request) {
  const user = await authUser(req);
  const p = await pending(user.id);
  if (p) return { ok: true, scheduled_for: p.scheduled_for };
  const s = await secrets();
  if (!mailReady(s)) throw new Fail("mail-not-configured", 503);
  if (await rateLimited(user.id, "delete")) throw new Fail("rate-limited", 429);
  const appUrl = appUrlOf(s);
  const code = await newCode(user.id, 15 * 60_000);
  const o = {
    pre: `Dein Code zum Löschen des Stox-Kontos: ${code}`,
    icon: "trash" as const,
    title: "Konto löschen bestätigen",
    text: "Du hast in der App angefragt, dein Stox-Konto zu löschen. Gib diesen Code in der App ein, um das zu bestätigen. Danach hast du noch 24 Stunden Zeit, die Löschung abzubrechen – erst dann werden Konto, Depotdaten und Belege endgültig entfernt.",
    code, danger: true,
    note: "Der Code ist 15 Minuten gültig. Du hast das nicht angefragt? Dann ignorier diese Mail – es passiert nichts.",
  };
  await sendMail(s, user.email!, `${code} · Konto löschen bestätigen · Stox`, mailHtml(appUrl, o), `${o.title}\n\nCode: ${code}\n\n${o.text}\n\n${o.note}`);
  return { ok: true, sent: true };
}

async function confirm(body: any) {
  const t = await takeToken(body.token, "delete");
  return await schedule(t.user_id);
}

async function schedule(userId: string) {
  const t = { user_id: userId };
  const existing = await pending(t.user_id);
  if (existing) return { ok: true, scheduled_for: existing.scheduled_for };
  const scheduled_for = new Date(Date.now() + WAIT_MS).toISOString();
  const { error } = await admin.from("account_deletions").upsert(
    { user_id: t.user_id, requested_at: new Date().toISOString(), scheduled_for, cancelled_at: null, done_at: null },
    { onConflict: "user_id" },
  );
  if (error) throw new Fail("update-failed", 500);
  const s = await secrets();
  const { data: u } = await admin.auth.admin.getUserById(t.user_id);
  const email = u?.user?.email;
  if (email && mailReady(s)) {
    const appUrl = appUrlOf(s);
    const o = {
      pre: "Dein Stox-Konto wird in 24 Stunden gelöscht.",
      icon: "clock" as const,
      title: "Dein Konto wird gelöscht",
      text: `Die Löschung deines Stox-Kontos ist eingeplant für ${fmtDate(scheduled_for)}. Bis dahin kannst du sie jederzeit abbrechen: Öffne Stox und tippe in den Einstellungen auf „Löschung abbrechen“. Danach werden Konto, Depotdaten und Belege endgültig entfernt.`,
      note: "Du hast das nicht veranlasst? Melde dich an, brich die Löschung ab und ändere dein Passwort.",
    };
    try { await sendMail(s, email, "Dein Konto wird in 24 Stunden gelöscht · Stox", mailHtml(appUrl, o), `${o.title}\n\n${o.text}\n\n${o.note}`); } catch (_e) { /* Planung bleibt bestehen */ }
  }
  return { ok: true, scheduled_for };
}

async function cancelFor(userId: string) {
  const { error } = await admin.from("account_deletions").update({ cancelled_at: new Date().toISOString() })
    .eq("user_id", userId).is("cancelled_at", null).is("done_at", null);
  if (error) throw new Fail("update-failed", 500);
  await admin.from("auth_tokens").update({ used_at: new Date().toISOString() })
    .eq("user_id", userId).in("kind", ["delete", "delete_cancel"]).is("used_at", null);
  return { ok: true, cancelled: true };
}

async function run(req: Request) {
  const s = await secrets();
  if (!s.cron_secret || req.headers.get("x-cron-secret") !== s.cron_secret) throw new Fail("unauthorized", 401);
  const { data: due } = await admin.from("account_deletions").select("user_id")
    .lte("scheduled_for", new Date().toISOString()).is("cancelled_at", null).is("done_at", null).limit(50);
  let deleted = 0;
  for (const row of due || []) {
    const uid = row.user_id;
    try {
      const { data: u } = await admin.auth.admin.getUserById(uid);
      const email = u?.user?.email;
      for (let i = 0; i < 50; i++) {
        const { data: files } = await admin.storage.from("receipts").list(uid, { limit: 100 });
        if (!files || !files.length) break;
        await admin.storage.from("receipts").remove(files.map((f) => `${uid}/${f.name}`));
        if (files.length < 100) break;
      }
      const { error } = await admin.rpc("delete_user_data", { uid });
      if (error) throw error;
      deleted++;
      if (email && mailReady(s)) {
        const o = {
          pre: "Dein Stox-Konto wurde gelöscht.", icon: "wave" as const,
          title: "Dein Konto wurde gelöscht",
          text: "Wie angefragt haben wir dein Stox-Konto samt Depotdaten und Belegen endgültig gelöscht. Schade, dass du gehst – du kannst jederzeit ein neues Konto erstellen.",
          note: "Diese Mail ist die letzte, die du von uns zu diesem Konto erhältst.",
        };
        try { await sendMail(s, email, "Dein Konto wurde gelöscht · Stox", mailHtml(appUrlOf(s), o), `${o.title}\n\n${o.text}`); } catch (_e) { /* egal */ }
      }
    } catch (e) {
      console.error("delete-failed", uid, e);
    }
  }
  return { ok: true, deleted };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    let body: any = {};
    try { body = await req.json(); } catch (_e) { body = {}; }
    switch (body.action) {
      case "request": return json(await request(req));
      case "confirm": return json(await confirm(body));
      case "confirm-code": { const u = await authUser(req); await takeCode(u.id, body.code); return json(await schedule(u.id)); }
      case "cancel": { const t = await takeToken(body.token, "delete_cancel"); return json(await cancelFor(t.user_id)); }
      case "cancel-auth": { const u = await authUser(req); return json(await cancelFor(u.id)); }
      case "status": { const u = await authUser(req); const p = await pending(u.id); return json({ ok: true, scheduled_for: p?.scheduled_for || null }); }
      case "run": return json(await run(req));
      default: throw new Fail("unknown-action");
    }
  } catch (e) {
    const status = e instanceof Fail ? e.status : 500;
    const msg = e instanceof Fail ? e.message : "server-error";
    if (!(e instanceof Fail)) console.error(e);
    return json({ error: msg }, status);
  }
});
