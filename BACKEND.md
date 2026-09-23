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
  side text not null default 'buy'                -- buy | sell; shares bleibt IMMER positiv
    check (side in ('buy','sell')),
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

create table dividends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null default current_date,
  symbol text not null,
  name text,
  shares numeric(18,6),
  gross_amount numeric(18,4) not null check (gross_amount >= 0),
  withholding_tax numeric(18,4) not null default 0,  -- CH-Verrechnungssteuer, 35 %
  currency text not null default 'CHF',
  note text,
  created_at timestamptz not null default now()
);

create table price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  name text,
  direction text not null check (direction in ('above','below')),
  target_price numeric(18,4) not null check (target_price > 0),  -- im DEPOT-Preisraum, s.u.
  active boolean not null default true,
  triggered_at timestamptz,
  triggered_price numeric(18,4),
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
| `register` | Legt Nutzer per Service-Role an (`email_confirm: true`, Login geht sofort) — die eigentliche E-Mail-Bestätigung läuft über `auth-mail` | offen (kein Login vorhanden) |
| `auth-mail` | E-Mail bestätigen + Passwort zurücksetzen (siehe „E-Mail-Bestätigung & Passwort-Reset" unten) | `send-verify` prüft das User-JWT selbst, der Rest ist token-/e-mail-basiert (`verify_jwt` deaktiviert) |
| `market` | Proxy für Kurse/News/Suche/Historie | JWT erforderlich |
| `ocr` | *(ungenutzt, Client scannt seit 2026-09 lokal via Tesseract.js — siehe „Beleg-Erkennung" unten; Function bleibt deployed, wird aber nicht mehr aufgerufen)* | JWT erforderlich |
| `push-daily` | Verschickt den täglichen Depotstand per Web Push (`mode` "intraday"/"close") und prüft die Kursalarme (`mode` "alerts") | `x-cron-secret`-Header (kein User-JWT, `verify_jwt` deaktiviert) |

## E-Mail-Bestätigung & Passwort-Reset (`auth-mail`-Function)

- `profiles.email_verified` (bool) + `email_verified_at`. Der Trigger
  `protect_email_verified` verhindert, dass Nutzer (Rollen `anon`/`authenticated`)
  die Felder selbst setzen — nur die Function (Service-Role) darf das.
  Bestandskonten vor Einführung wurden als bestätigt markiert.
- `public.auth_tokens` (RLS an, kein Client-Zugriff): Einmal-Tokens `verify`
  (24 h) und `reset` (1 h), gespeichert nur als SHA-256-Hash. Max. eine Mail pro
  Minute und Art je Nutzer.
- Aktionen (`POST { action, ... }`):
  - `send-verify` — eingeloggt; schickt die Bestätigungs-Mail (App-Design).
  - `verify` `{ token }` — setzt `email_verified = true`.
  - `send-reset` `{ email }` — antwortet immer `ok` (keine Konto-Enumeration).
  - `reset` `{ token, password }` — setzt das Passwort, entwertet alle offenen
    Reset-Tokens, markiert die E-Mail als bestätigt.
- Links zeigen immer auf `app_url` (fest, nie auf den Request-Origin):
  `…/?verify=TOKEN` bzw. `…/?reset=TOKEN`; der Client wertet sie beim Start aus
  und entfernt sie sofort aus der Adresszeile.
- Versand über **Brevo** (bevorzugt) oder **Resend**. Konfiguration in
  `public.app_secrets`: `brevo_api_key` *oder* `resend_api_key`, `mail_from`
  (bei Brevo verifizierte Absenderadresse, bei Resend Adresse auf verifizierter
  Domain), optional `mail_from_name` (Default „Stox“) und `app_url`
  (Default `https://belegio-depot-tracker.vercel.app`). Fehlt das, antwortet die
  Function mit `mail-not-configured`.

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

Berechnung im Client (`buildPositions` + `renderVals`):

Positionen entstehen aus den Transaktionen, chronologisch abgespielt. `shares`
ist per Check-Constraint immer positiv — die Richtung steht in `side`
(Bestandszeilen ohne Wert gelten als `buy`). Der Einstand ist ein **gleitender
Durchschnitt**, ein Verkauf entnimmt zu genau diesem Schnitt (in der Schweiz
übliche Praxis für Privatanleger; FIFO wäre aus den erfassten Daten nicht
sauber ableitbar):

```
Kauf:     shares += n;  invested += n × preis
Verkauf:  n' = min(n, shares)          // nie mehr als vorhanden — sonst neg. Bestand
          schnitt   = invested / shares
          realisiert += n' × (preis − schnitt) − gebuehren
          invested  -= n' × schnitt
          shares    -= n'
          shares < 1e-9  =>  shares = 0, invested = 0   // Rundungsreste
```

Positionen mit `shares = 0` fallen aus Liste, Chart und Gewichtung heraus
(`closedPositions`), ihr realisierter Gewinn bleibt aber in den Kennzahlen und
im Steuer-Report. Der Portfolio-Chart spielt dieselbe Logik pro Stichtag ab
(`stateAt(d)`); realisierte Gewinne stecken bewusst NICHT im Chart — er zeigt
den Marktwert der jeweils gehaltenen Stücke.

```
investiert = Σ (shares × schnitt × fx)
wert       = Σ (shares × aktueller_kurs × fx)   // Fallback: schnitt, wenn keine Live-Quote
gewinn     = wert − investiert
```

## Währungen

`purchase_price` und der Live-Kurs stehen in der Währung der Position
(`transactions.currency`), gerechnet wird das Depot aber in CHF. Der Client
holt die nötigen Paare über dieselbe `quotes()`-Action wie Aktien — Yahoo
führt sie als `USDCHF=X`, `EURCHF=X` usw., also kein zusätzlicher Anbieter und
kein Request bei einem reinen CHF-Depot.

Ab `renderVals` sind `buy`/`cur` einer Position **immer CHF**; die
unkonvertierten Werte stehen als `buyNative`/`curNative` daneben und werden
überall dort verwendet, wo gegen die (in Landeswährung geführten)
Historien-Reihen gerechnet oder der Kurs selbst angezeigt wird
(Positions-Chart, 52-Wochen-Band, Signale, Kursspalte im Steuer-Report).

Umgerechnet wird mit dem **aktuellen** Kurs, auch der Einstand: sonst
vermischte die ausgewiesene Rendite Kurs- und Währungsentwicklung. Historische
FX-Reihen führt die App bewusst nicht — Kursgewinn und Währungseffekt werden
deshalb nicht getrennt ausgewiesen (Hinweis dazu steht in der
Währungen-Karte auf der Startseite).

## Dividenden

Eigene Tabelle statt einer weiteren `source`-Variante in `transactions`: eine
Ausschüttung verändert keine Stückzahl und hat keinen Einstandspreis, dafür
eine Verrechnungssteuer. Erfasst wird brutto + Verrechnungssteuer (Knopf "35 %
einsetzen" für Schweizer Titel), netto ergibt sich daraus. Die Startseite
zeigt Summe 12 Monate, YTD und die Dividendenrendite auf den aktuellen
Depotwert; der Steuer-Report führt sie als steuerbaren Vermögensertrag mit
rückforderbarer Verrechnungssteuer auf.

## Kursalarme

`price_alerts` + `push-daily` im `mode: "alerts"`, angestoßen von einem
pg_cron-Job (`price-alert-check`, `*/15 7-21 * * 1-5` — werktags alle 15 Min.
im Zeitfenster, das SIX und NYSE/Nasdaq abdeckt; ausserhalb bewegen sich die
Kurse nicht).

Die Function holt die Kurse **selbst bei Yahoo** statt aus `quote_cache`: der
Cache wird nur gefüllt, wenn gerade jemand die App offen hat, ein Alarm muss
aber auch bei geschlossener App feuern. Verglichen wird im **Depot-Preisraum**
— Edelmetalle (`GC=F`/`SI=F`/`PL=F`/`PA=F`) also in Gramm, nicht in Feinunzen,
genau wie der Zielpreis, den die App aus dem Positionskurs vorbelegt.

Ein ausgelöster Alarm wird auf `active = false` gesetzt (mit `triggered_at` /
`triggered_price`), damit er nicht bei jedem Lauf erneut feuert — reaktivieren
geht in der App, das setzt `triggered_at` wieder auf null. Geprüft werden nur
Alarme von Nutzern mit Push-Abo; ohne Abo wäre die Meldung nicht zustellbar.
Jede Auslösung landet zusätzlich mit `mode = 'alert'` in `push_log` und damit
in der In-App-Liste im Benachrichtigungen-Sheet.

## Beleg-Erkennung (OCR)

Kein Vision-LLM, kein externer Dienst — Tesseract.js (WASM) läuft komplett
lokal im Browser (`ocr.js` + `vendor/tesseract/*`, deutsches Sprachmodell
vendored, kein CDN-Nachladen), dahinter Regex-Parsing. Bild und Text
verlassen das Gerät nie. Ablauf: Foto ggf. auf max. 2500 px verkleinert
→ Tesseract erkennt Text lokal → Regex extrahiert Datum/ISIN/Ticker/
Stückzahl/Kurs/Betrag/Währung. Wird nur eine ISIN gefunden (kein Ticker), versucht
`onFile` einmal `market.search(isin)` — funktioniert nur, wenn der Anbieter
ISIN-Suche unterstützt (bei Alpha Vantage in der Praxis selten). Alle Felder
sind im Prüf-Screen editierbar, bevor die `transactions`-Zeile entsteht.

## Positionsfotos (`hqimg`-Function)

Foto je Einzelaktie (keine ETFs) fürs Karten-Hero, ausschliesslich von
Wikimedia Commons und nur mit frei nutzbaren Lizenzen (CC0, Public Domain,
CC BY — kein BY-SA/NC/ND), inkl. Namensnennung. Dreistufige Kette, jede
Stufe fällt auf die nächste zurück, wenn nichts Passendes gefunden wird:
1. Foto vom Firmensitz (Gebäude/Campus/Tower).
2. Foto der Sitz-Stadt (Skyline), ermittelt über die Firma auf Wikidata
   (Property P159).
3. Generisches Branchenfoto (z. B. "pharmaceutical industry", "banking"),
   ermittelt über die Branche der Firma auf Wikidata (Property P452) — kein
   Bezug zur konkreten Firma, nur zur Wirtschaftsbranche.
Ergebnis pro Symbol trägt `kind` ("hq"/"city"/"sector") plus die jeweilige
Zusatzangabe (`city`/`sector`), damit der Client die Bildunterschrift
("Foto: X · Lizenz · Wikimedia Commons (Branche: …)") passend beschriftet.
Ohne Treffer auf allen drei Stufen bleibt die bisherige Farbverlauf-Karte.

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
- **Gramm statt Feinunze**: Physisches Gold/Silber/Platin/Palladium wird
  privat in Gramm gehalten, Yahoo liefert `GC=F`/`SI=F`/`PL=F`/`PA=F` aber in
  USD je Feinunze (troy ounce). Der Märkte-Screen zeigt bewusst weiterhin den
  unkonvertierten Feinunzen-Kurs (so werden Edelmetallpreise überall
  zitiert), aber sobald ein Kurs gegen eine Depotposition verrechnet wird —
  aktueller Wert, Kursverlauf, Intraday-Chart, Vorbefüllung beim Hinzufügen —
  rechnet `toDepotPrice()` (`index.html`) ihn fix durch 31.1034768 g/oz auf
  Gramm um. Das Erfassungsformular beschriftet Stückzahl/Kurs für diese vier
  Symbole entsprechend als „Menge (Gramm)"/„Kurs pro Gramm". Rohöl (`CL=F`)
  bleibt bewusst außen vor (kein Gramm-Pendant, Fass ist die übliche Einheit).

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
