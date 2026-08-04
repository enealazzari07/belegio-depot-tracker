// Supabase-Anbindung: Auth, Transaktionen, Beleg-Storage.
// Anon-Key ist bewusst öffentlich (Standard bei Supabase) — Zugriff wird über RLS-Policies geschützt.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://rzbmtzxukqfdkcmfmugv.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6Ym10enh1a3FmZGtjbWZtdWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4MzYwNDYsImV4cCI6MjEwMTQxMjA0Nn0.Ju90NYOPpju6tl33Tk_so4LyNEtzyHItfuRCJj1FsWw";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
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
