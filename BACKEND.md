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

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,                -- Push-Endpoint des Browsers, pro Geraet eindeutig
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table app_secrets (
  key text primary key,                         -- vapid_public / vapid_private / cron_secret
  value text not null                            -- RLS ohne Policies: nur service_role liest das
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
| `push-daily` | Verschickt den täglichen Depotstand per Web Push | `x-cron-secret`-Header (kein User-JWT, `verify_jwt` deaktiviert) |

## Marktdaten-Anbieter (`market`-Function)

**Yahoo Finance ist jetzt immer erste Wahl** für Kurse, Historie und Suche —
für Aktien/ETFs weltweit, nicht nur Schweizer Titel. Kein Key, kein
Rate-Limit-Problem, deckt SIX nativ unter demselben `.SW`-Suffix ab, den die
App schon verwendet, inkl. bis zu 10 Jahren täglicher Historie in einem Call.
Inoffiziell/undokumentiert (`query1.finance.yahoo.com/v8/finance/chart/...`)
— kann sich ändern, deshalb nie als einzige Quelle, sondern immer mit
Fallback-Kette:

- **Nicht-Schweizer Symbole:** Yahoo → EODHD → Massive → Finnhub → Twelve Data
- **Schweizer Symbole (`.SW`):** Yahoo → EODHD → Twelve Data → Alpha Vantage → Finnhub

1. **Yahoo Finance** — siehe oben. `yfQuote` nutzt bewusst `range=1d`, nicht
   `5d`/`1y`: Yahoos `chartPreviousClose` ist der Schlusskurs vom **Start des
   angefragten Zeitraums**, nicht "gestern" — bei größerem Range kommt sonst
   eine falsche Tagesveränderung raus (z. B. `range=5d` lieferte für AAPL
   fälschlich −10 % statt der echten Tagesbewegung).
2. **EODHD** (`EODHD_API_KEY`, `/real-time`, `/eod`) — legitimer, lizenzierter
   Anbieter mit nativer SIX-Abdeckung (Exchange-Code `SW`, gleiche `.SW`-
   Konvention). Nur als Backup NACH Yahoo bei Schweizer Titeln, weil der
   Free-Plan auf **20 Requests/Tag** limitiert ist (`/api/user` zeigt
   Kontingent/Verbrauch) — bei mehreren Positionen wäre das sonst im Nu
   aufgebraucht. Wird für Nicht-Schweizer Symbole gar nicht erst angefragt
   (uneinheitliche Exchange-Suffixe, zu knappes Kontingent).
3. **Massive** (`MASSIVE_API_KEY`, https://massive.com) — ersetzt Alpha Vantage
   als dritte Stufe für Nicht-Schweizer Symbole. **Nur US-Titel** (19 US-Börsen,
   kein SIX/Swiss-Coverage) — wird deshalb in der Schweizer Kette gar nicht
   erst versucht. Free-Tier ("Stocks Basic") deckt laut Doku nur
   Aggregates/Referenzdaten ab, keine Live-Snapshots — `massiveQuote` holt
   deshalb die letzten ~10 Tages-Bars (`/v2/aggs/ticker/{t}/range/1/day/...`)
   und berechnet die Tagesveränderung selbst aus den letzten zwei Closes
   (Daten laut API-Response mit `status: "DELAYED"`, also nicht echtzeit).
   `massiveHistory` nutzt denselben Endpoint über den vollen Zeitraum und
   ersetzt dort ebenfalls Alpha Vantage (`TIME_SERIES_DAILY`).
4. **Alpha Vantage** (`ALPHAVANTAGE_API_KEY`) — nur noch in der Schweizer
   Quote-Kette sowie für `news()`/`search()` verwendet (`NEWS_SENTIMENT`,
   `SYMBOL_SEARCH`). Free-Tier: 25 Calls/Tag, 5/Min.
5. **Finnhub** (`FINNHUB_API_KEY`) — `/quote`, `/company-news`, `/search`.
6. **Twelve Data** (`TWELVEDATA_API_KEY`) — Free-Plan deckt **keine SIX-Kurse**
   ab (`NESN:SIX` etc. → „available starting with the Grow/Venture plan"),
   hilft also nur bei US-/sonstigen Titeln, falls Yahoo mal ausfällt.

Ergebnis wird 30 Minuten in `quote_cache` gehalten (`fetched_at`, inkl.
`provider`-Spalte zur Diagnose, seit Version 14 auch in der `quotes()`-Antwort
an den Client), bevor erneut ein Anbieter angefragt wird — reduziert
Rate-Limit-Treffer deutlich. Der Client (`index.html`) drosselt seinen
automatischen Auto-Sync (alle 10-60 Min., zufällig) zusätzlich pro Symbol:
Yahoo-Symbole werden bei jedem Tick aktualisiert, alle anderen Anbieter
höchstens alle 90 Min., damit deren Tageskontingent auch bei durchgehend
offener App reicht.

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

## Investment-Plan

Zielbetrag + Zeitraum (Woche/Monat/Quartal) liegen bewusst nur in
`localStorage` (`belegio_invest_plan`), nicht im `profiles`-Profil wie der
Zinseszins-Rechner — spart eine Migration, ist dafür nicht geräteübergreifend
synchron. "Investiert in diesem Zeitraum" zählt echte Käufe (`total_amount`
je Transaktion) seit Beginn des laufenden Zeitraums, unabhängig von der
Kursentwicklung. Bei Bedarf später aufs Profil umziehen (neue Spalten
`invest_plan_amount` / `invest_plan_interval`), analog zu `compound_*`.

## Portfolio-Chart

`Investiert` ist exakt (kumulierte Summe aus echten Transaktionsdaten).
`Aktueller Wert` nutzt echte historische Tagesschlusskurse (`market`-Function,
Action `history`: Yahoo Finance zuerst, bei Schweizer Titeln dann EODHD, dann
Alpha-Vantage `TIME_SERIES_DAILY`, dann Twelve Data) je Symbol; fehlt Historie
für ein Symbol, wird mit dem Einstandspreis approximiert. Zeitraum-Toggle (Tag/Woche/Monat/Jahr/Max) wird
immer auf das erste Kaufdatum geclamped — kein Verlauf vor dem ersten Kauf.

## Rohstoffe im Depot (Gold, Silber, ...)

Positionen sind nicht auf Aktien/ETFs beschränkt — `transactions.symbol` ist
freier Text, und `quotes()`/`history()`/`stockDetail()` reichen ihn 1:1 an
Yahoo durch (bereits vorher an `BTC-USD` als Mover erkennbar), es gibt also
keine serverseitige Whitelist nach Asset-Klasse. Neu im Client:

- **Märkte-Screen**: Filter-Tabs „Aktien / ETFs / Rohstoffe" oben, dahinter
  je Tab eine kuratierte Symbolliste (`MARKET_MOVERS_BY_CAT` in `index.html`).
  Rohstoffe laufen über Yahoos Futures-Symbole (`GC=F` Gold, `SI=F` Silber,
  `PL=F` Platin, `PA=F` Palladium, `CL=F` Rohöl WTI) statt ETF-Tickern —
  liefert echte Spot-nahe Preise ohne TER/Tracking-Differenz eines Gold-ETFs.
- **Zum Depot hinzufügen**: Button in der Aktien-Detailansicht übernimmt
  Symbol, Name und aktuellen Kurs direkt in die manuelle Erfassung
  (`addFromDetail` → `screen: "review"`) — Stückzahl und Kaufdatum trägt man
  dort noch ein, genau wie bei jeder anderen manuellen Position.

## Tägliche Benachrichtigung (Web Push)

Einstellungen → Umschalter „Täglicher Depotstand" registriert `sw.js` als
Service Worker und abonniert `PushManager` mit dem VAPID-Public-Key
(`VAPID_PUBLIC_KEY` in `index.html`); die Subscription landet über
`db.savePushSubscription` in `push_subscriptions`. Ein `pg_cron`-Job
(`daily-push-portfolio`, `0 11 * * *` UTC — ca. 12 Uhr MEZ / 13 Uhr MESZ, je
nach Sommer-/Winterzeit im Bereich Mittag/früher Nachmittag) ruft per
`pg_net` einmal täglich die Edge Function `push-daily` auf. Die Function
liest das Cron-Secret sowie die VAPID-Keys aus `app_secrets` (per
service_role, RLS ohne Policies sperrt anon/authenticated komplett aus),
rechnet pro abonniertem User den aktuellen Depotwert aus (gleiche Formel wie
oben: `investiert` / `wert` mit Fallback auf den Einstandspreis, keine
Währungsumrechnung) und verschickt die Push-Notification über `web-push`.
410/404-Antworten (Subscription vom Browser verworfen) löschen die
zugehörige Zeile aus `push_subscriptions` gleich mit. `sw.js` zeigt die
Notification an und öffnet beim Antippen die App.
