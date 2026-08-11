// Supabase-Anbindung: Auth, Transaktionen, Beleg-Storage.
// Anon-Key ist bewusst öffentlich (Standard bei Supabase) — Zugriff wird über RLS-Policies geschützt.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://rzbmtzxukqfdkcmfmugv.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6Ym10enh1a3FmZGtjbWZtdWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4MzYwNDYsImV4cCI6MjEwMTQxMjA0Nn0.Ju90NYOPpju6tl33Tk_so4LyNEtzyHItfuRCJj1FsWw";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function signUp(email, password) {
  // Läuft über die "register"-Edge-Function: legt den User serverseitig
  // (Service-Role-Key) direkt bestätigt an — keine E-Mail-Verifizierung nötig.
  const res = await fetch(`${SUPABASE_URL}/functions/v1/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) {
    const messages = { "email-taken": "Diese E-Mail-Adresse ist bereits registriert.", "invalid-email": "Ungültige E-Mail-Adresse.", "invalid-password": "Passwort muss mindestens 6 Zeichen haben." };
    throw new Error(messages[body.error] || body.error || "Registrierung fehlgeschlagen.");
  }
  return signIn(email, password);
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
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
