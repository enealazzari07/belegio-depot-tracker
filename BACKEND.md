# Belegio — Backend

Läuft auf Supabase (Projekt `rzbmtzxukqfdkcmfmugv`, eu-central-1). Kein eigener
Server — Client (`index.html` + `db.js`/`market.js`/`ocr.js`) redet direkt mit
Supabase Auth/Postgres/Storage und mit drei Edge Functions. Alle API-Keys
liegen nur in den Edge Functions, nie im Client-Bundle oder im Repo.

## Datenmodell (Postgres, RLS `user_id = auth.uid()`)

```sql
create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null default current_date,
  symbol text not null,                        -- Ticker, z.B. AAPL / NESN.SW — NICHT die ISIN
  isin text,
  name text,
  shares numeric(18,6) not null check (shares > 0),
  purchase_price numeric(18,4) not null check (purchase_price >= 0),
  currency text not null default 'CHF',
  fees numeric(18,4) not null default 0,
  total_amount numeric(18,4) not null,
  receipt_path text,
  source text not null default 'ocr',          -- ocr | manual
  created_at timestamptz not null default now()
);

create table receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid references transactions(id) on delete set null,
  file_path text not null,                      -- Pfad in Storage-Bucket "receipts", pro-User-Ordner
  file_name text not null,
  ocr_text text,
  status text not null default 'confirmed',
  created_at timestamptz not null default now()
);

create table quote_cache (
  symbol text primary key,
  price numeric(18,4) not null,
  change_pct numeric(8,4),
  provider text,                                -- welcher Anbieter den Kurs geliefert hat
  fetched_at timestamptz not null default now()
);
```

Storage-Bucket `receipts` (privat): Policies erlauben nur Zugriff auf den
eigenen Ordner (`{user_id}/...`).

## Edge Functions

| Function | Zweck | Auth |
| --- | --- | --- |
| `register` | Legt Nutzer per Service-Role direkt bestätigt an (`email_confirm: true`) — keine E-Mail-Verifizierung nötig | offen (kein Login vorhanden) |
| `market` | Proxy für Kurse/News/Suche/Historie | JWT erforderlich |
| `ocr` | Proxy für API-Ninjas Image-to-Text | JWT erforderlich |

## Marktdaten-Anbieter (`market`-Function)

Reihenfolge je Symbol — bei Schweizer Titeln (`.SW`) zuerst Yahoo Finance,
sonst zuletzt als Fallback, wenn kein Kurs gefunden wurde:

1. **Yahoo Finance** (kein Key, inoffizielle Chart-/Search-API) — kennt
   SIX-Titel nativ unter demselben `.SW`-Suffix, den die App schon verwendet
   (`NESN.SW`, `VWRL.SW`, …), inkl. bis zu 10 Jahren täglicher Historie in
   einem Call. Löst das eigentliche Schweizer-ETF-Problem, das weder Alpha
   Vantage noch der kostenlose Twelve-Data-Plan können (SIX-Daten dort nur ab
   bezahltem Plan). Inoffiziell/undokumentiert — kann sich ändern, deshalb
   nie als einzige Quelle, sondern immer mit Fallback-Kette.
2. **Alpha Vantage** (`ALPHAVANTAGE_API_KEY`) — `GLOBAL_QUOTE`, `NEWS_SENTIMENT`,
   `SYMBOL_SEARCH`, `TIME_SERIES_DAILY`. Free-Tier: 25 Calls/Tag, 5/Min.
3. **Finnhub** (`FINNHUB_API_KEY`) — `/quote`, `/company-news`, `/search`.
4. **Twelve Data** (`TWELVEDATA_API_KEY`) — nur als letzter Fallback. Der
   hinterlegte Key ist der kostenlose Plan, der **keine SIX-Kurse abdeckt**
   (`NESN:SIX` etc. → „available starting with the Grow/Venture plan"), hilft
   also nur bei US-/sonstigen Titeln.

Für Nicht-Schweizer Symbole: Alpha Vantage → Finnhub → Yahoo → Twelve Data.

Ergebnis wird 30 Minuten in `quote_cache` gehalten (`fetched_at`, inkl.
`provider`-Spalte zur Diagnose), bevor erneut ein Anbieter angefragt wird —
reduziert Rate-Limit-Treffer bei Alpha Vantage deutlich.

Symbole, die wie eine ISIN aussehen (`isinLike`, Regex `[A-Z]{2}[A-Z0-9]{9}\d`),
werden clientseitig gar nicht erst angefragt — keiner der Anbieter kann damit
etwas anfangen. Die UI zeigt für solche Positionen „kein Live-Kurs" statt
einer irreführenden 0.0 %.

Berechnung im Client (`renderVals`):

```
investiert = Σ (shares × purchase_price)
wert       = Σ (shares × aktueller_kurs)   // Fallback: purchase_price, wenn keine Live-Quote
gewinn     = wert − investiert
```

## Beleg-Erkennung (OCR)

Kein Vision-LLM — reine Texterkennung (API Ninjas Image-to-Text) plus
Regex-Parsing (`ocr.js`). Ablauf: Bild client-seitig auf <200 KB komprimieren
→ `ocr`-Function → Text zurück → Regex extrahiert Datum/ISIN/Ticker/Stückzahl/
Kurs/Betrag/Währung. Wird nur eine ISIN gefunden (kein Ticker), versucht
`onFile` einmal `market.search(isin)` — funktioniert nur, wenn der Anbieter
ISIN-Suche unterstützt (bei Alpha Vantage in der Praxis selten). Alle Felder
sind im Prüf-Screen editierbar, bevor die `transactions`-Zeile entsteht.

## Portfolio-Chart

`Investiert` ist exakt (kumulierte Summe aus echten Transaktionsdaten).
`Aktueller Wert` nutzt echte historische Tagesschlusskurse (`market`-Function,
Action `history`: Yahoo Finance zuerst, dann Alpha-Vantage `TIME_SERIES_DAILY`,
dann Twelve Data) je Symbol; fehlt Historie für ein Symbol, wird mit dem
Einstandspreis approximiert. Zeitraum-Toggle (Tag/Woche/Monat/Jahr/Max) wird
immer auf das erste Kaufdatum geclamped — kein Verlauf vor dem ersten Kauf.
