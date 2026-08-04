# Belegio — Backend

Der Prototyp (`index.html`, ursprünglich `Depot Tracker.dc.html`) ruft Finnhub/Alpha Vantage direkt im Browser auf und
speichert Depot + API-Key in `localStorage`. Für den Produktivbetrieb wandert
beides hinter eine API — Key darf nie im Client liegen.

## Datenmodell (Supabase / PostgreSQL)

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  plan text not null default 'free',          -- free | pro | lifetime
  created_at timestamptz default now()
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  date date not null,
  symbol text not null,                        -- Finnhub-Symbol, z.B. AAPL / NESN.SW
  isin text,
  shares numeric(18,6) not null,
  purchase_price numeric(18,4) not null,       -- pro Stück
  currency text not null default 'CHF',
  fees numeric(18,4) default 0,
  total_amount numeric(18,4) not null,
  receipt_url text,                            -- Supabase Storage
  source text default 'ocr',                   -- ocr | manual | broker
  created_at timestamptz default now()
);

create table receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  file_url text not null,
  status text not null default 'pending',       -- pending | parsed | confirmed | failed
  parsed jsonb,                                 -- Rohausgabe des Vision-Calls
  created_at timestamptz default now()
);

create table quote_cache (
  symbol text primary key,
  price numeric(18,4) not null,
  change_pct numeric(8,4),
  fetched_at timestamptz not null default now()
);
```

RLS: auf `transactions`, `receipts` je Policy `user_id = auth.uid()`.

## Endpoints

| Route | Zweck |
| --- | --- |
| `POST /api/receipts` | Datei in Storage, Zeile in `receipts`, Parse-Job auslösen |
| `GET /api/receipts/:id` | Parse-Status + extrahierte Felder für den Prüf-Screen |
| `POST /api/transactions` | bestätigte Felder buchen (`receipt_id` verknüpfen) |
| `GET /api/portfolio` | Positionen aggregiert + Live-Kurse + Performance |
| `GET /api/news` | Finnhub `company-news` für die eigenen Symbole |
| `GET /api/symbols?q=` | Finnhub `search` für manuelle Eingabe |

## Marktdaten-Anbieter

Austauschbar hinter einem Interface (`quote`, `news`, `search`). Keys als Env,
nie im Client: `ALPHAVANTAGE_API_KEY`, `FINNHUB_API_KEY`, …

**Alpha Vantage** (aktuell aktiv)
- `GLOBAL_QUOTE&symbol=` → Kurs, Tagesveränderung
- `NEWS_SENTIMENT&tickers=` → News-Feed
- `SYMBOL_SEARCH&keywords=` → Symbol-Auflösung
- Schweizer Titel als `NESN.SWI` (nicht `.SW`)
- Free-Tier: 25 Calls/Tag, 5/Min → Kurse mit 15 Min TTL cachen, Nutzer-Symbole gebündelt

**Finnhub**
- `/quote`, `/company-news`, `/search`; 60 Calls/Min

Kurse in `quote_cache` puffern und pro Request nur die Symbole des Nutzers abfragen.

Berechnung im `/api/portfolio`:

```
invested = Σ (shares × purchase_price + fees)
value    = Σ (shares × quote.price)
gain     = value − invested
```

## OCR

`POST /api/receipts` legt einen Job an, der die Datei an ein Vision-Modell
schickt und strukturiert `{date, symbol, isin, shares, purchase_price, total_amount, currency}`
zurückgibt. Ergebnis in `receipts.parsed`, Nutzer bestätigt im Prüf-Screen,
erst dann entsteht die `transactions`-Zeile.

## Prototyp-Verhalten

`market.js` ist die Fassade über `providers/alphavantage.js` und
`providers/finnhub.js`: aktiver Anbieter + Keys in `localStorage`
(Einstellungen → Datenquelle), 15-Minuten-Quote-Cache, pro Symbol Fallback auf
die Demo-Kurse. Neue Quelle = Datei in `providers/` mit
`id/label/defaultKey/quote/news/search`, Eintrag in `PROVIDERS` — die UI listet
sie automatisch. Depot und Belege liegen im Prototyp unter
`belegio.portfolio`.
