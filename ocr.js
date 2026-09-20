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

const NUM_RE = /(\d{1,3}(?:['’ ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?!\d)/g;
const CUR_RE = /(?:CHF|EUR|USD|GBP|Fr\.?|€|\$)/gi;

// Alle Betraege einer Zeile (Prozentwerte und Datumsteile fallen heraus).
function amountsIn(line) {
  const clean = line.replace(CUR_RE, " ");
  const out = [];
  for (const m of clean.matchAll(NUM_RE)) {
    const after = clean.slice(m.index + m[0].length, m.index + m[0].length + 2);
    const before = clean.slice(Math.max(0, m.index - 1), m.index);
    if (/^\s*%/.test(after) || /[.\/]/.test(before) && /^[.\/]\d/.test(after)) continue;
    const n = parseNumber(m[1]);
    if (n != null) out.push(n);
  }
  return out;
}

// Zeilenweise Suche: Betrag hinter dem Label (gleiche Zeile, sonst naechste
// Zeile). Mit last=true zaehlt der letzte Betrag der Zeile (Spalte "Betrag").
function valueForLabel(lines, labelRe, { last = false, skipRe = null } = {}) {
  for (let i = 0; i < lines.length; i++) {
    if (!labelRe.test(lines[i]) || (skipRe && skipRe.test(lines[i]))) continue;
    const m = lines[i].match(labelRe);
    const rest = lines[i].slice(m.index + m[0].length);
    let nums = amountsIn(rest);
    if (!nums.length && lines[i + 1]) nums = amountsIn(lines[i + 1]);
    if (nums.length) return last ? nums[nums.length - 1] : nums[0];
  }
  return null;
}

const FEE_LABEL = /(Kommission|Courtage|Brokerage|Geb(?:ü|ue)hr(?:en)?|B(?:ö|oe)rsengeb(?:ü|ue)hr(?:en)?|Fremdspesen|Spesen|Stempel(?:abgabe|steuer)?|Umsatzabgabe|Abgabe|Transaktionssteuer|Handelsplatzgeb(?:ü|ue)hr|Fees?|Commission|Charges)/i;
const FEE_TOTAL = /(?:Total|Gesamt|Summe)\s*(?:der\s*)?(?:Geb(?:ü|ue)hr|Spesen|Kosten|Fees|Abgaben)/i;
const FEE_SKIP = /(Verrechnungssteuer|Quellensteuer|Kurswert|Gesamtbetrag|Nettobetrag|Endbetrag|Kurs\b)/i;

function findFees(lines) {
  for (const line of lines) {
    if (FEE_TOTAL.test(line)) {
      const n = amountsIn(line.replace(FEE_TOTAL, ""));
      if (n.length) return n[n.length - 1];
    }
  }
  let sum = 0, found = false;
  for (const line of lines) {
    if (!FEE_LABEL.test(line) || FEE_SKIP.test(line)) continue;
    const n = amountsIn(line.replace(FEE_LABEL, ""));
    if (n.length) { sum += n[n.length - 1]; found = true; }
  }
  return found ? Math.round(sum * 100) / 100 : null;
}


// ISIN-Pruefsumme (Luhn ueber die in Ziffern gewandelten Buchstaben).
function isinValid(s) {
  const digits = [...s].map(c => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join("");
  let sum = 0, dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = +digits[i];
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
}

// OCR verwechselt 0 und O (z. B. "IEOOOSHROUX9" statt "IE000SHR0UX9"). Kandidaten
// mit O an ISIN-Stellen durchprobieren und per Pruefsumme den echten finden.
function findIsin(text) {
  const cands = text.match(/\b[A-Z]{2}[A-Z0-9]{9}[0-9O]\b/g) || [];
  for (const raw of cands) {
    const pos = [];
    for (let i = 2; i < raw.length; i++) if (raw[i] === "O") pos.push(i);
    if (pos.length > 9) continue;
    for (let mask = (1 << pos.length) - 1; mask >= 0; mask--) {
      const chars = [...raw];
      pos.forEach((p, k) => { if (mask & (1 << k)) chars[p] = "0"; });
      const cand = chars.join("");
      if (isinValid(cand)) return { isin: cand, raw };
    }
  }
  return { isin: "", raw: "" };
}

const MONTHS_DE = { januar: "01", februar: "02", märz: "03", maerz: "03", april: "04", mai: "05", juni: "06", juli: "07", august: "08", september: "09", oktober: "10", november: "11", dezember: "12" };

function findDate(text) {
  // Gelabeltes Datum hat Vorrang vor irgendeiner anderen Zahl im Text (Referenznummern etc.)
  // Handelsdatum vor Valuta: "Kaufauftrag vom 21.08.2026" ist der Trade, das
  // Valutadatum (Belastung) liegt meist Tage danach.
  const labeled = text.match(/(?:auftrag\s*vom|order\s*vom|Handelsdatum|Trade\s*Date|Ausf(?:ü|ue)hrungsdatum|Abschlussdatum)[:\s]{1,6}(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/i)
    || text.match(/(?<!Valuta)(?:\bDatum)[:\s]{1,6}(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/i)
    || text.match(/Valuta(?:datum)?[:\s]{1,6}(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/i);
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

function parseFields(rawText) {
  const text = String(rawText || "").replace(/\r/g, "");
  let lines = text.split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  // Notfall: liefert der Server jedes Wort in einer eigenen Zeile, Zeilen an
  // typischen Beleg-Labels neu bilden.
  if (lines.length > 12 && lines.filter(l => !l.includes(" ")).length / lines.length > 0.7) {
    lines = lines.join(" ")
      .split(/(?=\b(?:Total|Abgabe|Zu Ihren|Anzahl|Kommission|Courtage|Geb(?:ü|ue)hr|Kurswert|Betrag belastet|Titel|Kauf|Verkauf|Valuta)\b)/i)
      .map(l => l.trim()).filter(Boolean);
  }
  const date = findDate(text);

  const { isin, raw: isinRaw } = findIsin(text);
  let name = "";
  if (isin) {
    const nl = lines.find(l => l.includes(isinRaw));
    const before = nl ? nl.slice(0, nl.indexOf(isinRaw)).replace(/ISIN[:\s]*$/i, "").trim() : "";
    if (before.length > 2) name = before;
  }

  const symbolMatch = text.match(/\b(?:Symbol|Ticker|Valor)[:\s]{1,4}([A-Z][A-Z0-9.]{1,9})\b/i);
  const symbol = symbolMatch ? symbolMatch[1].toUpperCase() : "";

  const U = "(?:ü|ue|u)";
  let shares = valueForLabel(lines, new RegExp(`(?:St${U}ck(?:zahl)?|Stk\\.?|Anzahl|Quantity|Qty\\.?|Units?|Shares|Menge|Nominal)[:\\s]*`, "i"));
  let price = valueForLabel(lines, new RegExp(`(?:Ausf(?:ü|ue)hrungskurs|Ausf(?:ü|ue)hrungspreis|Trade\\s*Price|Execution\\s*Price|Unit\\s*Price|Einzelkurs|Kurs(?:\\s*pro\\s*St${U}ck)?|Preis|Price|Rate)[:\\s]*`, "i"), { skipRe: /Kurswert/i });
  let gross = null;
  // Tabellenbelege (z. B. Yuh): Kopfzeile "Anzahl | Preis | Betrag", darunter
  // die Werte in derselben Reihenfolge — Label-Suche wuerde beim "Preis" die
  // Stueckzahl der Nachbarspalte erwischen.
  const tHead = lines.findIndex(l => /Anzahl|Menge|St(?:ü|ue)ck/i.test(l) && /Preis|Kurs/i.test(l) && /Betrag|Wert/i.test(l));
  if (tHead >= 0) {
    const vals = [];
    for (let i = tHead + 1; i < Math.min(lines.length, tHead + 5) && vals.length < 3; i++) vals.push(...amountsIn(lines[i]));
    if (vals.length >= 3) { shares = vals[0]; price = vals[1]; gross = vals[2]; }
  }
  if (gross == null) gross = valueForLabel(lines, /(?:Kurswert|Bruttobetrag|Gross\s*Amount|Brutto|Market\s*Value)[:\s]*/i, { last: true });
  let total = valueForLabel(lines, /(?:Total\s*)?Zu\s*(?:[Il]hren\s*|[Il]hrem\s*)?(?:Lasten|Gunsten|belasten)[:\s]*/i, { last: true })
    ?? valueForLabel(lines, /(?:Total\s*zu\s*(?:Lasten|Gunsten)|Zu\s*(?:belasten|Lasten|Gunsten)|Belastung|Gutschrift|Gesamtbetrag|Endbetrag|Nettobetrag|Net\s*Amount|Settlement\s*Amount|Total\s*Amount|Kaufbetrag|Verkaufsbetrag|Kaufpreis|Total(?:betrag)?|Betrag|Amount)[:\s]*/i, { last: true, skipRe: FEE_TOTAL });
  const fees = findFees(lines);

  // Fallback: "8 × 118.40" (Stueckzahl × Kurs) ohne Schluesselwort.
  if (shares == null || price == null) {
    const xMatch = text.match(/(\d[\d'.,]*)\s*[×xX]\s*(\d[\d'.,]*)/);
    if (xMatch) {
      if (shares == null) shares = parseNumber(xMatch[1]);
      if (price == null) price = parseNumber(xMatch[2]);
    }
  }

  const isSell = /\b(?:Verkauf|Verkauft|Sell|Sold|Verk\.)\b/i.test(text) || /Verkaufs(?:abrechnung|auftrag|betrag)/i.test(text);
  const side = isSell ? "sell" : "buy";
  const f = fees || 0;

  // Gegenseitig ergaenzen: Kurswert = Stueck × Kurs, Total = Kurswert ± Gebuehren.
  if (gross == null && shares && price) gross = Math.round(shares * price * 100) / 100;
  if (price == null && shares && gross != null) price = gross / shares;
  if (shares == null && price && gross != null) shares = gross / price;
  if (total == null && gross != null) total = Math.round((side === "sell" ? gross - f : gross + f) * 100) / 100;
  // Kein Kurswert gedruckt, aber Total und Gebuehren bekannt.
  if (gross == null && total != null && shares && price == null) {
    price = (side === "sell" ? total + f : total - f) / shares;
  }

  const currencyMatch = text.match(/\b(CHF|EUR|USD|GBP)\b/);
  const currency = currencyMatch ? currencyMatch[1] : "CHF";
  const str = (n, d = 4) => n != null && Number.isFinite(n) ? String(+n.toFixed(d)) : "";

  return {
    date, symbol, isin, name,
    shares: str(shares), price: str(price),
    fees: fees != null ? str(fees, 2) : "",
    total: str(total, 2),
    side, currency,
  };
}
