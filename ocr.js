// Beleg-Erkennung: Bild client-seitig auf <200KB komprimieren, dann Text via
// Edge Function (API-Ninjas Image-to-Text) lesen und Felder heraus-parsen.
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./db.js";

const MAX_BYTES = 195 * 1024;

// Graustufen + Kontrastspreizung: Dezimalpunkte und Kommas gehen bei starker
// Verkleinerung/JPEG-Kompression sonst verloren (aus "2.565" wird "2565").
// Graustufen-JPEGs sind deutlich kleiner, dadurch bleibt mehr Aufloesung
// innerhalb der 200-KB-Grenze des OCR-Dienstes.
function renderPrepared(bitmap, scale) {
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = g;
    hist[g]++;
  }
  const total = w * h;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.2) { hi = v; break; } }
  if (hi - lo < 40) { lo = 0; hi = 255; }
  const k = 255 / (hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, (d[i] - lo) * k)) | 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
  let quality = 0.88;
  let last = null;
  for (let i = 0; i < 14; i++) {
    const canvas = renderPrepared(bitmap, scale);
    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob) continue;
    last = blob;
    if (blob.size <= MAX_BYTES) return blob;
    if (quality > 0.6) quality -= 0.1;
    else { scale *= 0.88; quality = 0.8; }
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
    const end = m.index + m[0].length;
    const after = clean.slice(end, end + 6);
    const prev = clean[m.index - 1], prev2 = clean[m.index - 2];
    if (/^\s*%/.test(after)) continue;
    if (/^[.\/]\d{2,4}(?!\d)/.test(after)) continue; // Tag/Monat eines Datums
    if ((prev === "." || prev === "/") && /\d/.test(prev2 || "")) continue; // Jahr eines Datums
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
const NOT_A_TOTAL = /(?:Total|Gesamt|Summe)\s*(?:der\s*)?(?:Geb(?:ü|ue)hr|Spesen|Kosten|Fees|Abgaben)|Konto|IBAN|Kunde|Referenz|Valuta|belastet\s*auf|Telefon|Tel\.|Customer|Fax|MwSt|CHE-/i;
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

// Typische OCR-Verwechslungen je Zeichen (in beide Richtungen).
const CONFUSE = { O: "0", "0": "O", I: "1", "1": "I", L: "1", l: "1", C: "0", D: "0", S: "5", "5": "S", B: "8", "8": "B", Z: "2", "2": "Z", G: "6", "6": "G", Q: "0" };

// Im Landescode stehen nur Buchstaben: Ziffern/kleines l dort zurueckwandeln.
const LETTER_FIX = { l: "I", "1": "I", "0": "O", "5": "S", "8": "B", "6": "G", "2": "Z" };

// Alle Varianten eines 12-stelligen Kandidaten, deren Pruefsumme stimmt.
// Landescode (2 Buchstaben) und Pruefziffer (Ziffer) haben feste Typen.
function isinVariantsValid(raw) {
  const up = raw.toUpperCase();
  const opts = [...up].map((c, i) => {
    const alts = new Set([c]);
    if (CONFUSE[raw[i]]) alts.add(CONFUSE[raw[i]]);
    if (CONFUSE[c]) alts.add(CONFUSE[c]);
    if (i < 2 && LETTER_FIX[raw[i]]) alts.add(LETTER_FIX[raw[i]]);
    return [...alts].filter(a => {
      if (i < 2) return /[A-Z]/.test(a);
      if (i === 11) return /[0-9]/.test(a);
      return /[A-Z0-9]/.test(a);
    });
  });
  if (opts.some(o => !o.length)) return [];
  const out = [];
  const walk = (i, cur) => {
    if (out.length > 200) return;
    if (i === 12) { if (isinValid(cur)) out.push(cur); return; }
    for (const a of opts[i]) walk(i + 1, cur + a);
  };
  walk(0, "");
  // Wenige Buchstaben-O bevorzugen (in NSINs sind Nullen viel haeufiger),
  // dann moeglichst wenig Abweichung vom gelesenen Text.
  const score = v => (v.match(/O/g) || []).length * 10 + [...v].filter((c, i) => c !== up[i]).length;
  return out.sort((a, b) => score(a) - score(b));
}

function findIsin(text) {
  // 1) Token direkt hinter dem Label "ISIN", 2) beliebige 12-Zeichen-Tokens.
  const cands = [];
  for (const m of text.matchAll(/ISIN[:\s.]*([A-Za-z0-9]{12})(?![A-Za-z0-9])/gi)) cands.push(m[1]);
  for (const m of text.matchAll(/(?<![A-Za-z0-9])([A-Z]{2}[A-Z0-9]{10})(?![A-Za-z0-9])/g)) if (!cands.includes(m[1])) cands.push(m[1]);
  for (const raw of cands) {
    const v = isinVariantsValid(raw);
    if (v.length) return { isin: v[0], raw, valid: true };
  }
  // Keine gueltige Pruefsumme: trotzdem den Text hinter "ISIN" uebernehmen
  // (Nullen statt O ab Stelle 3), damit das Feld gefuellt ist und der Nutzer
  // korrigieren kann; die App prueft danach, ob es die ISIN gibt.
  if (cands.length) {
    const raw = cands[0];
    const fixed = [...raw.slice(0, 2)].map(c => LETTER_FIX[c] || c.toUpperCase()).join("") + raw.slice(2).toUpperCase().replace(/O/g, "0");
    return { isin: fixed, raw, valid: false };
  }
  return { isin: "", raw: "", valid: false };
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


// Fehlt der Dezimalpunkt (OCR-Fehler: "2.565" -> 2565), stimmt Stueck x Kurs
// nicht mehr mit dem Kurswert ueberein. Dann die Skalierung suchen, bei der
// die Rechnung aufgeht (Stueck/Kurs meist 3 Nachkommastellen, Geldbetraege 2).
function reconcileNumbers(n) {
  const { shares, price, gross } = n;
  if (!shares || !price || !gross) return n;
  const ok = (a, b, c) => Math.abs(a * b - c) <= Math.max(0.02, c * 0.006);
  if (ok(shares, price, gross)) return n;
  // Sind alle drei Werte ganze Zahlen, sind ueberall die Punkte verloren:
  // Betrag hat dann 2 Nachkommastellen, Stueck/Kurs meist 3.
  const allInt = Number.isInteger(shares) && Number.isInteger(price) && Number.isInteger(gross);
  const F = allInt ? [0.001, 0.01, 0.1, 1, 0.0001] : [1, 0.1, 0.01, 0.001, 0.0001];
  const G = allInt ? [0.01] : [1, 0.1, 0.01];
  let best = null;
  for (const gf of G) for (const sf of F) for (const pf of F) {
    const a = shares * sf, b = price * pf, c = gross * gf;
    if (!ok(a, b, c)) continue;
    const cost = allInt ? F.indexOf(sf) + F.indexOf(pf) : (gf !== 1) + (sf !== 1) + (pf !== 1);
    if (!best || cost < best.cost) best = { sf, pf, gf, cost };
  }
  if (!best) return n;
  const r = { ...n, shares: shares * best.sf, price: price * best.pf, gross: gross * best.gf };
  if (best.gf !== 1) {
    if (n.total != null && Number.isInteger(n.total)) r.total = n.total * best.gf;
    if (n.fees != null && Number.isInteger(n.fees)) r.fees = n.fees * best.gf;
  }
  return r;
}

// Handelszeile unabhaengig vom Layout finden: drei Zahlen a, b, c mit a x b = c
// (Stueck x Kurs = Kurswert), in der Naehe der Kopfwoerter Anzahl/Preis/Betrag.
// Loest den Fall, dass Stueckzahl und Kurs beide die erste Zahl erwischen.
function findTradeRow(lines) {
  const near = [];
  lines.forEach((l, i) => { if (/Anzahl|Menge|St(?:ü|ue)ck|Preis|Kurs|Quantity|Price/i.test(l)) near.push(i); });
  const starts = new Set();
  near.forEach(i => { for (let d = -1; d <= 2; d++) if (i + d >= 0 && i + d < lines.length) starts.add(i + d); });
  let best = null;
  for (const i of starts) {
    const nums = amountsIn(lines.slice(i, i + 9).join(" ")).filter(n => n > 0 && n < 1e9).slice(0, 14);
    for (let x = 0; x < nums.length; x++) for (let y = x + 1; y < nums.length; y++) for (let z = y + 1; z < nums.length; z++) {
      const a = nums[x], b = nums[y], c = nums[z];
      const err = Math.abs(a * b - c) / c;
      const err2 = Math.abs(a * b - c);
      if (err > 0.006 && err2 > 0.02) continue;
      if (!best || err < best.err) best = { a, b, c, err };
    }
  }
  return best;
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
  {
    const okRow = (a, b, c) => a && b && c && Math.abs(a * b - c) <= Math.max(0.02, c * 0.006);
    if (!okRow(shares, price, gross)) {
      const t = findTradeRow(lines);
      if (t) { shares = t.a; price = t.b; gross = t.c; }
    }
    // Stueckzahl und Kurs identisch = beide haben dieselbe Zahl erwischt.
    if (shares && price && shares === price) price = gross && shares ? gross / shares : null;
  }
  if (gross == null) gross = valueForLabel(lines, /(?:Kurswert|Bruttobetrag|Gross\s*Amount|Brutto|Market\s*Value)[:\s]*/i, { last: true });
  let total = valueForLabel(lines, /(?:Total\s*)?Zu\s*(?:[Il]hren\s*|[Il]hrem\s*)?(?:Lasten|Gunsten|belasten)[:\s]*/i, { last: true })
    ?? valueForLabel(lines, /(?:Total\s*zu\s*(?:Lasten|Gunsten)|Zu\s*(?:belasten|Lasten|Gunsten)|Belastung|Gutschrift|Gesamtbetrag|Endbetrag|Nettobetrag|Net\s*Amount|Settlement\s*Amount|Total\s*Amount|Kaufbetrag|Verkaufsbetrag|Kaufpreis|Total(?:betrag)?|Betrag|Amount)[:\s]*/i, { last: true, skipRe: NOT_A_TOTAL });
  let fees = findFees(lines);
  if (total != null && total > 1e7) total = null;
  if (gross != null && gross > 1e7) gross = null;

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

  {
    const r = reconcileNumbers({ shares, price, gross, total, fees });
    shares = r.shares; price = r.price; gross = r.gross; total = r.total;
    if (r.fees !== fees) fees = r.fees;
    // Total muss zu Kurswert +/- Gebuehren passen; sonst aus diesen berechnen.
    if (gross != null && total != null) {
      const expect = side === "sell" ? gross - (fees || 0) : gross + (fees || 0);
      if (Math.abs(total - expect) > Math.max(0.05, expect * 0.02)) total = Math.round(expect * 100) / 100;
    }
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
