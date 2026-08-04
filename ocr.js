// Beleg-Erkennung: Bild client-seitig auf <200KB komprimieren, dann Text via
// Edge Function (API-Ninjas Image-to-Text) lesen und Felder heraus-parsen.
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./db.js";

const MAX_BYTES = 195 * 1024;

async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  let quality = 0.85;
  let last = null;
  for (let i = 0; i < 9; i++) {
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob) continue;
    last = blob;
    if (blob.size <= MAX_BYTES) return blob;
    if (quality > 0.35) quality -= 0.15;
    else scale *= 0.75;
  }
  return last || file;
}

export async function scanReceipt(file) {
  const blob = await compressImage(file);
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token || SUPABASE_ANON_KEY;
  const form = new FormData();
  form.append("image", blob, "receipt.jpg");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ocr`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    body: form,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "ocr-error");
  const text = body.text || "";
  return { text, fields: parseFields(text) };
}

function parseNumber(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[’'\s]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // German/CH format: 1.234,56 -> 1234.56
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // 1,234.56 -> 1234.56
    s = s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function findAfterKeyword(text, keywords) {
  for (const kw of keywords) {
    // Zwischen Label und Zahl darf ein Währungscode stehen ("Total: CHF 1'608.60").
    const re = new RegExp(kw + "[:\\s]{0,6}(?:CHF|EUR|USD|GBP)?[:\\s]{0,4}([\\d'.,]+)", "i");
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

const MONTHS_DE = { januar: "01", februar: "02", märz: "03", maerz: "03", april: "04", mai: "05", juni: "06", juli: "07", august: "08", september: "09", oktober: "10", november: "11", dezember: "12" };

function findDate(text) {
  // Gelabeltes Datum hat Vorrang vor irgendeiner anderen Zahl im Text (Referenznummern etc.)
  const labeled = text.match(/(?:Handelsdatum|Datum|Valuta|Trade\s*Date|Ausf(?:ü|ue)hrungsdatum)[:\s]{1,6}(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/i);
  const dm = labeled || text.match(/\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})\b/);
  if (dm) {
    let [, d, m, y] = dm;
    if (y.length === 2) y = "20" + y;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const worded = text.match(/\b(\d{1,2})\.?\s*(Januar|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s*(\d{4})\b/i);
  if (worded) {
    const [, d, monthName, y] = worded;
    const mm = MONTHS_DE[monthName.toLowerCase()];
    if (mm) return `${y}-${mm}-${d.padStart(2, "0")}`;
  }
  return "";
}

function parseFields(text) {
  const date = findDate(text);

  const isinMatch = text.match(/\b([A-Z]{2}[A-Z0-9]{9}\d)\b/);
  const isin = isinMatch ? isinMatch[1] : "";

  const symbolMatch = text.match(/\b(?:Symbol|Ticker|Valor)[:\s]{1,4}([A-Z][A-Z0-9.]{1,9})\b/i);
  const symbol = symbolMatch ? symbolMatch[1].toUpperCase() : "";

  const U = "(?:ü|ue|u)";
  const sharesRaw = findAfterKeyword(text, [`St${U}ck(?:zahl)?`, "Stk\\.?", "Anzahl", "Quantity", "Shares", "Menge"]);
  const priceRaw = findAfterKeyword(text, [`Kurs(?:\\s*pro\\s*St${U}ck)?`, "Ausf(?:ü|ue)hrungskurs", "Preis", "Price", "Rate", "Einzelkurs"]);
  const totalRaw = findAfterKeyword(text, ["Gesamtbetrag", "Kurswert", "Nettobetrag", "Bruttobetrag", "Total(?:betrag)?", "Betrag", "Endbetrag", "Zu\\s*belasten", "Net\\s*Amount", "Amount"]);

  const currencyMatch = text.match(/\b(CHF|EUR|USD|GBP)\b/);
  const currency = currencyMatch ? currencyMatch[1] : "CHF";

  const shares = parseNumber(sharesRaw);
  const price = parseNumber(priceRaw);
  const total = parseNumber(totalRaw);

  return {
    date,
    symbol,
    isin,
    shares: shares != null ? String(shares) : "",
    price: price != null ? String(price) : total != null && shares ? String((total / shares).toFixed(2)) : "",
    total: total != null ? String(total) : "",
    currency,
  };
}
