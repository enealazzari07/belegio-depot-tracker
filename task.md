# Task: Verkäufe, Dividenden, Währung, Kursalarme + Home-Widgets

## 1 — Datenbank (Supabase `rzbmtzxukqfdkcmfmugv`)
- [x] Migration `sells_dividends_price_alerts`: `transactions.side` ('buy'|'sell', default 'buy')
- [x] Tabelle `dividends` + RLS (`user_id = auth.uid()`)
- [x] Tabelle `price_alerts` + RLS
- [x] Migration `price_alert_cron`: pg_cron-Job `price-alert-check` (`*/15 7-21 * * 1-5`)

## 2 — Edge Function `push-daily` (v4)
- [x] Neuer `mode: "alerts"` — Yahoo-Kurse selbst holen, Alarme prüfen, Push + `push_log`
- [x] `intraday`/`close` rechnen Verkäufe jetzt negativ (`side`)
- [x] Getestet: leer → `checked:0`, mit Alarm → `checked:1, quoted:1, fired:0`

## 3 — `db.js`
- [x] `listDividends` / `insertDividend` / `deleteDividend`
- [x] `listPriceAlerts` / `insertPriceAlert` / `setPriceAlertActive` / `deletePriceAlert`
- [x] `side` fliesst über den Spread in `insertTransaction` durch

## 4 — `index.html` Logik
- [x] `buildPositions`: side-aware, gleitender Durchschnitt, realisiert/Erlös je Symbol
- [x] Geschlossene Positionen raus aus Liste/Chart, realisiert bleibt in den Kennzahlen
- [x] Chart `stateAt(d)`: Verkäufe abgezogen, FX angewandt
- [x] FX: `<CUR>CHF=X` laden, `buy`/`cur` in CHF, `buyNative`/`curNative` für Kurs-Anzeigen
- [x] Investment-Plan zählt nur noch Käufe
- [x] Dividenden laden + YTD / 12 Mt. / Rendite / Verrechnungssteuer
- [x] Kursalarme laden, anlegen, pausieren, löschen
- [x] Bestandsprüfung beim Verkauf in `confirm()`
- [x] Steuer-Report: realisierte Gewinne + Dividenden (Screen + PDF), Spalte „Art"

## 5 — `index.html` UI
- [x] Review-Screen: Kauf/Verkauf-Umschalter + Bestandshinweis
- [x] Positionsmenü: „Verkaufen" / „Dividende" / „Kursalarm"
- [x] Sheet: Dividende erfassen (inkl. „35 % einsetzen", Währungswahl, Netto-Vorschau)
- [x] Sheet: Kursalarm (über/unter, Zielkurs, Push-Hinweis)
- [x] Home-Widget: Realisiert & Dividenden (+ geschlossene Positionen, letzte Ausschüttungen)
- [x] Home-Widget: Kursalarme
- [x] Home-Widget: Währungen (Anteile + verwendeter Kurs)
- [x] „Depot auf einen Blick": 4 → 7 Kacheln
- [x] Depot-Transaktionsliste: Verkauf-Badge, Betrag mit Minus in Rot
- [x] Benachrichtigungs-Sheet: Kursalarme mit eigenem Symbol

## 6 — Doku
- [x] `BACKEND.md`: Schema, Kauf/Verkauf-Formel, Währungen, Dividenden, Kursalarme

## Prüfungen
- [x] `node --check` auf extrahiertem App-Script und `db.js`
- [x] Markup-Verschachtelung identisch fehlerfrei wie vor der Änderung
- [x] `buildPositions`-Smoke-Test (13 Fälle: Teilverkauf, Schnitt, Gebühren,
      Reihenfolge, vollständiger Verkauf, Altzeilen ohne `side`, Überverkauf)

## Offen
- Der eigentliche Push-Versand eines ausgelösten Alarms ist nicht live getestet
  (hätte eine echte Benachrichtigung aufs Gerät geschickt). Der Code-Pfad ist
  derselbe wie beim funktionierenden Tagesreport.
