# Implementation Plan – Depot › Analyse überarbeiten

## Ziel
Analyse-Tab übersichtlicher: Titelbild-Hero wie bei „Holdings" (mit eingebautem, kleinem KI Score + Kurzanalyse statt Depotwert), neue Sektoren-Karte als Balkendiagramm, restliche Karten kompakter.

## Dateien

### [MODIFY] `index.html` – Markup (Analyse-Bereich, ~Z. 1095–1160)
1. **Neuer Hero oben im Analyse-Tab** (gleiches Format wie Holdings-Hero Z. 897–926: `img/depot.webp`, Blur-Gradient, weisser Block schiebt sich mit `margin-top:-32px` darüber).
   - Links: Label `ANALYSE` + Chip `{{ posCount }}`.
   - **KI Score direkt im Bild**: kleiner Bogen (~96 px statt volle Kartenbreite), Zahl 26 px statt 44 px, Label (z. B. „Gut") darunter. Zustände idle / berechnet… / fertig / Pro-Lock bleiben erhalten (gleiche Handler `startAiScoreCheck`, `aiScoreOpen`, `goPro`).
   - Rechts daneben / darunter: **Kurzanalyse** – 2–3 Zeilen aus vorhandenen Daten (z. B. „Grösster Sektor: Tech 42 %", „Top-Position: 28 % – hohe Konzentration", „12 Titel in 4 Ländern").
   - Die alte grosse KI-Score-Karte (Z. 1100–1160) entfällt.
2. **Neue Karte „Sektoren"** (vor „Gewichtung"): horizontale Balken je Sektor, sortiert absteigend, Name links, % rechts, Balken in Sektorfarbe; max. 8 Zeilen + „Sonstige". Pro-Lock wie bei den anderen Karten (`geoWrapStyle`/`geoLocked`).
3. Padding-Wrapper des Analyse-Tabs so anpassen, dass der Hero randlos oben sitzt (wie Holdings); Allgemein/Dividenden unverändert.
4. Abstände der übrigen Karten vereinheitlichen (margin-bottom 26 → 20 px), sonst keine Inhaltsänderung.

### [MODIFY] `index.html` – Logik (Script)
1. **Sektor-Zuordnung** (neu, neben `countryOf` ~Z. 3098):
   - `SECTOR_MAP` für gängige Einzelaktien (AAPL/MSFT/NVDA → Technologie, NOVN/ROG/LLY/NVO → Pharma & Gesundheit, JPM/UBSG → Banken & Finanzen, NESN → Konsumgüter, ABBN → Industrie, …) inkl. `.SW`-Titel.
   - `sectorOf(sym, name)`: Map → Namens-Heuristik (Regex auf „Pharma|Bank|Energy|Tech…") → „Sonstige".
   - ETFs: echte Yahoo-`sectors` aus `etfHoldings[sym].sectors` anteilig nach Positionswert verteilen (Keys wie `technology`, `healthcare`, `financial_services` auf deutsche Labels mappen).
2. **Render-Daten** (im Render-Block bei `aiScoreData`, ~Z. 6075): `sectorRows` = [{name, pct, barWidth, color}], `sectorHas`, `sectorTop`.
3. **Kurzanalyse** `analysisLines` (2–3 Strings) aus Sektor-Top, grösster Position, Länderanzahl, Gewinner-Anteil.
4. Kleine Bogen-Werte für den Hero (`aiScoreArcLen`/`Offset` bleiben, nur neues kleineres SVG-viewBox).
5. Neue Keys an das Template übergeben (Bereich ~Z. 6918).

### Nicht angefasst
Backend/Edge Functions, KI-Score-Detail-Sheet, Holdings- und Dividenden-Tab.

## Offene Punkte
- Sektoren für Einzelaktien kommen aus einer festen Liste + Namens-Heuristik (kein Sektor-Feld im Backend) → unbekannte Titel landen in „Sonstige". Später optional über die `market`-Edge-Function (Yahoo `assetProfile.sector`) ersetzbar.
