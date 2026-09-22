# Stox — Modernisierung: Design-Fixes & neue Funktionen

Status: **Wartet auf Freigabe.** Erledigt ist bisher nur der Hintergrund-Wunsch
(siehe „Bereits umgesetzt"). Alles darunter ist geplant, nicht gebaut.

---

## Bereits umgesetzt (Home-Hintergrund)

| Datei | Änderung |
|---|---|
| `index.html` `:root` / `[data-theme="dark"]` | Neue Tokens `--home-bg`, `--home-fade`, `--home-fade-0` |
| Home-Scrollcontainer + beide Home-Boxen | `--bg` → `--home-bg` (reines Weiss) |
| Tab-Leisten-Verlauf | jetzt `--home-fade-0` → `--home-fade` (grau-weiss statt `rgba(0,0,0,0)`, das grau interpolierte) |
| `.card` + Positions-Zeilen | Haarlinie `1px solid var(--line)` — sonst verschwinden weisse Karten auf weissem Grund |

Lokal nicht im Browser prüfbar: `index.html` ist eine `<x-dc>`-Template-Datei,
die Platzhalter (`{{ … }}`) werden erst vom Design-Host aufgelöst. Die
CSS-Variablen wurden im Browser gegengeprüft und lösen korrekt auf.

---

## Gefundene Design-Fehler

### A. Blocker (kaputt oder unbenutzbar)

1. **Keine Fokus-Sichtbarkeit.** 62× `all:unset` auf `<button>` — der Fokusring
   ist überall entfernt, kein einziges `:focus-visible` im ganzen Stylesheet.
   Tastatur- und Switch-Control-Bedienung ist blind.
2. **Keine ARIA-Beschriftungen.** 0× `aria-label`/`role`. Die Tab-Leiste besteht
   aus vier icon-only Buttons ohne Text — für VoiceOver sind das vier leere
   Schaltflächen.
3. **`maximum-scale=1`** im Viewport-Meta deaktiviert Pinch-Zoom. Auf iOS ein
   harter Accessibility-Verstoss.
4. **Aktiver Tab nicht erkennbar.** Alle fünf Leisten-Buttons haben identischen
   `--surf`-Hintergrund; nur die Icon-Strichfarbe wechselt. Auf hellem Grund ist
   der Unterschied kaum sichtbar — man weiss nicht, wo man ist.

### B. Substanziell

5. **Kontrast.** `--tx3:#8B92A1` auf Weiss ≈ 3.0:1 — unter WCAG AA (4.5:1). Wird
   für 10–11 px Labels benutzt (`.lbl`, alle Sekundärzeilen). Betrifft die halbe App.
6. **Touch-Targets unter 44 px.** `.segb` ≈ 30 px hoch, Glocke 34×34, Zeitraum-
   Pillen im Hero. Apple-HIG-Minimum ist 44 px.
7. **`prefers-reduced-motion` fehlt.** 13 Keyframe-Animationen, u. a.
   `zoomIn` mit `scale(80)` — für vestibulär empfindliche Nutzer problematisch.
8. **Hero-Kopfzeile überläuft.** „Gesamtwert" + 5 Zeitraum-Pillen + Glocke in
   einer Flex-Zeile auf 375 px. Bei langen Labels bricht das oder quetscht.
9. **`<svg title="…">`** (Markt-geschlossen-Mond) ist wirkungslos — muss ein
   `<title>`-Kindelement sein.

### C. Konsistenz / Wartbarkeit

10. **Radius-Wildwuchs:** 21 verschiedene `border-radius`-Werte (2–28 px, dazu
    999). Keine Skala, keine Tokens.
11. **Fünf identische Sheet-Container** als kopierte Inline-Styles (je ~300
    Zeichen). Gehört in eine `.sheet`-Klasse — jede Änderung muss sonst 5× gemacht werden.
12. **Kein Spacing-Token.** Paddings 20/18/14/13/12/11 px frei gemischt.

---

## Vorgeschlagene neue Funktionen

Reihenfolge = Empfehlung. Alles baut auf dem bestehenden Supabase-Schema aus
`BACKEND.md` auf; ✚ = neue Tabelle/Spalte nötig.

### Tier 1 — grösster Nutzen, überschaubarer Aufwand

| # | Funktion | Warum sie fehlt | Umfang |
|---|---|---|---|
| F1 | **Verkäufe / Teilverkäufe** | `transactions` kennt nur Käufe (`shares > 0`). Man kann eine Position nie schliessen — realisierte Gewinne existieren im Modell nicht. Das ist die grösste inhaltliche Lücke, besonders für den Steuer-Report. | ✚ `side`-Spalte, FIFO-Rechnung, UI in Position + Steuer-Report |
| F2 | **Dividenden** | Für ein CH-Depot steuerlich zentral (Verrechnungssteuer). Aktuell nirgends erfassbar. | ✚ Tabelle `dividends`, Karte auf Home, Zeile im Steuer-Report |
| F3 | **Kursalarme** | Push-Infrastruktur (VAPID, `push_subscriptions`, Edge Function) steht bereits — es fehlt nur „benachrichtige mich bei X". Sehr hohe Wirkung pro Aufwand. | ✚ Tabelle `price_alerts`, Cron-Check in bestehender Push-Function |
| F4 | **Watchlist** | Märkte-Suche und Detailseite existieren, aber man kann nichts merken, ohne es ins Depot zu buchen. | ✚ Tabelle `watchlist`, Tab auf der Märkte-Seite |
| F5 | **Suche + Sortierung im Depot** | Die Liste ist unsortiert/ungefiltert. Ab ~15 Positionen unbrauchbar. | reine Client-Arbeit |

### Tier 2 — spürbare Modernisierung

| # | Funktion | Nutzen |
|---|---|---|
| F6 | **Währungs-Umrechnung sichtbar machen** | `currency` steht pro Transaktion in der DB, die App rechnet aber alles als CHF. Bei USD-Positionen sind Gesamtwert und Rendite schlicht falsch. **Eher ein Bug als ein Feature.** |
| F7 | **Performance-Kennzahlen** | TWR/IRR, Volatilität, Max-Drawdown, Benchmark-Vergleich (SMI/MSCI World) auf der Home-Karte „Depot auf einen Blick". |
| F8 | **CSV-Import/Export** | Onboarding ohne 40 Belege zu scannen; Export für Steuerberater. Der PDF-Export existiert schon, CSV ist ein kleiner Zusatz. |
| F9 | **Beleg-Galerie mit Volltextsuche** | `receipts.ocr_text` liegt bereits in der DB und wird nirgends durchsucht. |
| F10 | **Pull-to-refresh + „zuletzt aktualisiert"** | `lastSyncAt` ist im State, wird aber nicht angezeigt. Man weiss nie, wie alt die Kurse sind. |

### Tier 3 — Politur

| # | Funktion |
|---|---|
| F11 | Haptik (`navigator.vibrate`) bei Scrub, Tab-Wechsel, erfolgreichem Scan |
| F12 | Skeleton-Loader statt Spinner (Layout springt heute beim Laden) |
| F13 | Widget-/Share-Karte: Depot-Snapshot als Bild teilen |
| F14 | Mehrere Depots / Konten trennen |
| F15 | Jahres-Rückblick („dein 2026 in Zahlen") |

---

## Umsetzungs-Reihenfolge (Vorschlag)

**Phase 1 — Design-Fundament** (kein neues Backend, ~1 Session)
Blocker 1–4, dann B5–B9, dann C10–C12 als Token-/Klassen-Refactor.

**Phase 2 — Korrektheit** F6 (Währung), F1 (Verkäufe), F2 (Dividenden).

**Phase 3 — Engagement** F3 (Alarme), F4 (Watchlist), F5 (Depot-Suche), F10.

**Phase 4 — Tiefe** F7, F8, F9, dann Tier 3 nach Geschmack.

---

## Was ich von dir brauche

1. **Freigabe der Reihenfolge** — oder sag, womit ich starten soll.
2. **Phase 1** kann ich ohne weitere Absprache durchziehen (nur `index.html`).
3. **Phase 2/3** brauchen Schema-Änderungen in Supabase (neue Tabellen + RLS) —
   soll ich die Migrationen mitschreiben oder machst du die selbst?
