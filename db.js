// Supabase-Anbindung: Auth, Transaktionen, Beleg-Storage.
// Anon-Key ist bewusst öffentlich (Standard bei Supabase) — Zugriff wird über RLS-Policies geschützt.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://rzbmtzxukqfdkcmfmugv.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6Ym10enh1a3FmZGtjbWZtdWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4MzYwNDYsImV4cCI6MjEwMTQxMjA0Nn0.Ju90NYOPpju6tl33Tk_so4LyNEtzyHItfuRCJj1FsWw";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Alles unten läuft komplett über das eingebaute Supabase-Auth-System —
// kein eigener Mail-Versand, keine eigene Edge Function, kein API-Key.
// Voraussetzung im Supabase-Dashboard (einmalig, Authentication-Einstellungen):
// "Confirm email" aktiviert, und die App-URL unter "Redirect URLs" eingetragen.
const AUTH_ERRORS = [
  [/already registered|user already exists/i, "Diese E-Mail-Adresse ist bereits registriert."],
  [/email.*not confirmed/i, "Diese E-Mail-Adresse ist noch nicht bestätigt."],
  [/invalid login credentials/i, "E-Mail oder Passwort stimmt nicht."],
  [/password should be at least/i, "Passwort muss mindestens 6 Zeichen haben."],
  [/rate limit/i, "Bitte warte kurz, bevor du es erneut versuchst."],
  [/unable to validate email/i, "Ungültige E-Mail-Adresse."],
];
function mapAuthError(error) {
  const msg = error?.message || "";
  const hit = AUTH_ERRORS.find(([re]) => re.test(msg));
  const e = new Error(hit ? hit[1] : (msg || "Etwas ist schiefgelaufen. Versuch es nochmal."));
  e.code = error?.code || null;
  return e;
}

// App-URL, auf die Supabase nach Klick auf den Bestätigungs- bzw.
// Reset-Link zurückleitet (muss im Dashboard unter "Redirect URLs" erlaubt sein).
const redirectUrl = () => `${location.origin}${location.pathname}`;

export async function signUp(email, password) {
  // Legt das Konto an und löst die eingebaute Supabase-Bestätigungsmail aus.
  // Es gibt bewusst keine Session zurück, solange die Mail nicht bestätigt ist —
  // Supabase blockiert den Login bis dahin serverseitig.
  const { data, error } = await supabase.auth.signUp({
    email, password, options: { emailRedirectTo: redirectUrl() },
  });
  if (error) throw mapAuthError(error);
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw mapAuthError(error);
  return data;
}

// Bestätigungsmail erneut anfordern (z. B. wenn sie nicht angekommen ist).
export async function resendVerifyMail(email) {
  const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectUrl() } });
  if (error) throw mapAuthError(error);
}

// Antwortet bewusst immer gleich (Supabase selbst verrät nicht, ob die Adresse existiert).
export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
  if (error) throw mapAuthError(error);
  return { ok: true };
}

// Nur gültig direkt nach Klick auf den Reset-Link (Supabase stellt dabei automatisch
// eine kurzlebige "Recovery"-Session her, siehe onPasswordRecovery unten).
export async function updatePassword(password) {
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw mapAuthError(error);
  return data;
}

// Feuert, sobald der Nutzer über einen Reset-Link in der App landet.
export function onPasswordRecovery(cb) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") cb(session);
  });
  return () => data.subscription.unsubscribe();
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function listTransactions() {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .order("date", { ascending: false });
  if (error) throw error;
  return data;
}

export async function insertTransaction(tx) {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const { data, error } = await supabase
    .from("transactions")
    .insert({ ...tx, user_id: userData.user.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTransaction(id, patch) {
  const { data, error } = await supabase
    .from("transactions")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Dividenden ----------
// Eigene Tabelle statt einer weiteren `source`-Variante in `transactions`:
// eine Ausschuettung hat keine Stueckzahl-Veraenderung und keinen Einstandspreis,
// dafuer eine Verrechnungssteuer — das in dieselbe Zeile zu pressen haette
// jede Depot-Berechnung mit Sonderfaellen durchsetzt.
export async function listDividends() {
  const { data, error } = await supabase
    .from("dividends")
    .select("*")
    .order("date", { ascending: false });
  if (error) throw error;
  return data;
}

export async function insertDividend(div) {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const { data, error } = await supabase
    .from("dividends")
    .insert({ ...div, user_id: userData.user.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteDividend(id) {
  const { error } = await supabase.from("dividends").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Kursalarme ----------
// Geprueft wird serverseitig (Edge Function `push-daily`, mode "alerts", alle
// 15 Min. per pg_cron) — der Client legt die Zeilen nur an und zeigt sie an.
export async function listPriceAlerts() {
  const { data, error } = await supabase
    .from("price_alerts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function insertPriceAlert(alert) {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const { data, error } = await supabase
    .from("price_alerts")
    .insert({ ...alert, user_id: userData.user.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Reaktivieren setzt triggered_at zurueck — sonst zeigt die Liste weiter
// "ausgeloest am ...", obwohl der Alarm wieder scharf ist.
export async function setPriceAlertActive(id, active) {
  const patch = active ? { active: true, triggered_at: null, triggered_price: null } : { active: false };
  const { error } = await supabase.from("price_alerts").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deletePriceAlert(id) {
  const { error } = await supabase.from("price_alerts").delete().eq("id", id);
  if (error) throw error;
}

export async function uploadReceipt(file, transactionId) {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const path = `${userData.user.id}/${crypto.randomUUID()}-${(file.name || "beleg.jpg").replace(/[^\w.\-]/g, "_")}`;
  const { error: upErr } = await supabase.storage.from("receipts").upload(path, file);
  if (upErr) throw upErr;
  const { error: insErr } = await supabase.from("receipts").insert({
    user_id: userData.user.id,
    transaction_id: transactionId,
    file_path: path,
    file_name: file.name || "beleg.jpg",
  });
  if (insErr) throw insErr;
  return path;
}

export async function listReceipts(limit = 5) {
  const { data, error } = await supabase
    .from("receipts")
    .select("*, transactions(symbol, shares, date)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// Gratis-Kontingent gilt pro Woche (letzte 7 Tage), nicht insgesamt.
export async function countWeeklyReceipts() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { count, error } = await supabase
    .from("receipts")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if (error) throw error;
  return count || 0;
}

export async function getProfile() {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const { data, error } = await supabase
    .from("profiles")
    .select("plan, insider_alerts_seen_at, compound_start, compound_monthly, compound_rate, compound_years")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (error) throw error;
  return data || { plan: "free", insider_alerts_seen_at: null, compound_start: null, compound_monthly: null, compound_rate: null, compound_years: null };
}

// Speichert die Eingaben des Zinseszins-Rechners dauerhaft im Profil, damit sie
// beim naechsten Besuch (auch auf einem anderen Geraet) wieder geladen werden.
export async function saveCompoundSettings(patch) {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const { error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("user_id", userData.user.id);
  if (error) throw error;
}

// Markiert alle bisherigen Insider-Trade-Meldungen als gesehen — Basis für den
// Benachrichtigungs-Badge, der nur neue Meldungen seit dem letzten Besuch zählt.
export async function markInsiderAlertsSeen() {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const { error } = await supabase
    .from("profiles")
    .update({ insider_alerts_seen_at: new Date().toISOString() })
    .eq("user_id", userData.user.id);
  if (error) throw error;
}

// Ein Geraet kann sich mehrfach fuer den taeglichen Depotstand-Push anmelden
// (Handy + Desktop); "endpoint" ist pro Push-Subscription eindeutig, daher
// upsert statt insert, falls die Subscription bereits existiert.
export async function savePushSubscription(sub) {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const json = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert({
    user_id: userData.user.id,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  }, { onConflict: "endpoint" });
  if (error) throw error;
}

export async function deletePushSubscription(endpoint) {
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw error;
}

export async function hasPushSubscription(endpoint) {
  const { data, error } = await supabase.from("push_subscriptions").select("id").eq("endpoint", endpoint).maybeSingle();
  if (error) throw error;
  return !!data;
}

// Verlauf der zugestellten Web-Push-Nachrichten (push-daily Edge Function
// schreibt hier bei jedem Versand rein) — Basis fuer die In-App-Liste im
// Benachrichtigungen-Sheet, damit verpasste Pushes dort nachtraeglich sichtbar sind.
export async function listPushLog(limit = 10) {
  const { data, error } = await supabase
    .from("push_log")
    .select("mode, title, body, sent_at")
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function callMarket(action, payload) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token || SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/market?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "market-error");
  return body;
}

// Konto loeschen mit Mail-Bestaetigung und 24 h Wartezeit (Edge Function
// "account-delete"). Aktionen: request, confirm {token}, cancel {token},
// cancel-auth, status. Endgueltig geloescht wird serverseitig per Cron.
export async function accountDelete(action, payload = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token || SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/account-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "delete-error");
  return body;
}
