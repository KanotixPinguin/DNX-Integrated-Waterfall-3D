# DNX Integrated Waterfall 3D (`v3.10`)

<!-- DNX-DISCLAIMER-START -->
> **Wichtiger Hinweis / Vollständige Distanzierung (Hobby-Mod-Mode)**
>
> - **Vollständige Distanzierung:** Ich distanziere mich in jeder Hinsicht vollständig vom Projekt **OpenWebRX / OpenWebRX+** sowie dessen Entwicklern und Betreibern. Es besteht keinerlei Verbindung, Zusammenarbeit, Prüfung, Befürwortung oder Partnerschaft.
> - **Keine öffentlichen/offiziellen OpenWebRX-Plugins (nur Mod-Mode):** Bei diesem Projekt handelt es sich ausdrücklich **nicht** um ein öffentliches oder offizielles Plugin von OpenWebRX, sondern ausschließlich um einen privaten, inoffiziellen **Mod-Mode** (Eigenmodifikation).
> - **Warum bewusst kein reines Browser-JavaScript (Mod-Mode-Architektur):** Viele Funktionen (z. B. serverseitige Speicherung, Konten-/Rollenverwaltung, Profil-Synchronisation, VNC-/websockify-Brücken, geschützte Schnittstellen, Docker-/Systemintegration und stabile UI-Anpassungen) lassen sich sauber und sicher nicht allein über simples Client-JavaScript umsetzen, ohne den OpenWebRX-Kern umzubauen oder Browsergrenzen zu umgehen. Deshalb setzt dieses Projekt bewusst auf getrennte Begleitmodule, Shell-Installer und Dienste im **Mod-Mode** statt alles künstlich in reines JavaScript zu pressen.
> - **Kein öffentlicher Support & keine Haftung:** Es gibt **keinen öffentlichen Support**, keine Garantie und keine Haftung. Nutzung, Installation und Anpassung erfolgen vollständig auf eigene Gefahr (immer vorher Backups anlegen und zunächst im eigenen Testsystem prüfen).
> - **Reines Hobbyprojekt – frei nutzbar, änderbar & verbreitbar:** Dieses Projekt entsteht ausschließlich aus reinem Hobby und Interesse am gemeinsamen Funk-/SDR-Hobby. Es steht ausdrücklich frei zur Verfügung und darf frei genutzt, weiterverbreitet, verändert und verbessert werden.
<!-- DNX-DISCLAIMER-END -->

> **Important Notice / Full Disassociation (Hobby Mod-Mode Only)**
>
> - **Full Disassociation:** I completely disassociate myself from **OpenWebRX / OpenWebRX+** and its developers/maintainers. There is no affiliation, endorsement, review, or partnership of any kind.
> - **No Official/Public OpenWebRX Plugins (Mod-Mode Only):** These files are **not** official or public OpenWebRX plugins, but purely unofficial hobby modifications (*mod-mode*).
> - **Why Not Everything in Pure Browser JavaScript:** Many features (server-side persistence, account/role management, profile syncing, VNC/websockify bridges, protected endpoints, and Docker/host integration) cannot be implemented cleanly or reliably in client-side JavaScript alone without modifying the OpenWebRX core or hitting browser/security limits. That is why this project intentionally uses separate companion scripts, services, and *mod-mode* hooks rather than forcing everything into pure JS.
> - **No Public Support & No Warranty:** There is **no public support**, no warranty, and no liability. Use entirely at your own risk (always create backups and verify on a test system first).
> - **Pure Hobby Project — Free to Use, Modify & Redistribute:** Created solely out of personal hobby interest in the radio/SDR hobby; freely available to use, share, modify, and improve.

<!-- DNX-PREVIEW-START -->
## Live-Vorschau & Galerie / Live Preview (`DNX Integrated Waterfall 3D`)

![Live-Vorschau — DNX Integrated Waterfall 3D: BEIDE-Modus (Split STD + 3D)](docs/preview.png)

| Ansicht / View | Beschreibung / Description | Screenshot |
|---|---|---|
| **BEIDE-Modus (Split STD + 3D)** | Geteilte Live-Ansicht aus klassischem 2D-Wasserfall oben und integriertem WebGL-3D-Wasserfall unten samt `Ansicht: STD | 3D | BEIDE | ⇅` | ![BEIDE-Modus (Split STD + 3D)](docs/preview.png) |
| **Vollbild 3D-Ansicht** | Reiner `3D`-Wasserfall-Modus mit freier Perspektive, Frequenzskala und Klick-Abstimmung direkt in der 3D-Fläche | ![Vollbild 3D-Ansicht](docs/iw-02-3d-only.png) |
| **3D-Toolbar & Auswahlmenüs** | Alle Dropdowns (`Outline/Ribbon`, `Waterfall`, `Hintergrund`, `Palette`, `FPS`, `FFT size`, `Hell/Kontrast`) inkl. `Smooth`, Pause und PNG-Export | ![3D-Toolbar & Auswahlmenüs](docs/iw-03-dropdowns.png) |
<!-- DNX-PREVIEW-END -->

Integrierte WebGL-3D-Wasserfallansicht (`dnx_3dtool.js v3.10`) direkt in der OpenWebRX-Oberfläche (`STD`, `3D`, `BEIDE`, `⇅`).

Integrated real-time WebGL 3D waterfall view (`dnx_3dtool.js v3.10`) embedded inside OpenWebRX with `STD`, `3D`, `BEIDE` (split), and `⇅` (swap order) controls.

> Hinweis: Dies ist die integrierte Wasserfall-Leiste (`STD / 3D / BEIDE / ⇅`) – nicht das eigenständige große Popup-Fenster `DNX 3D Tool`.

## Funktionen & Upgrade v3.10 / Features & What's New

- **4 Ansichtsmodi:** `STD` (Standard-2D), `3D` (reines 3D-Spektrogramm), `BEIDE` (Synchron-Split 2D + 3D) und `⇅` (Anordnung tauschen).
- **Live-WebGL-Einstellungen:** Modus (`Outline`, `Ribbon`, `Surface`), Farbkarte (`sdrangel_plasma`, `Classic`, `Turbo`, `Inferno`, …), 3D-Hintergrund, Mittelung (`AVG`), FPS-Limit, `Lin/Log`, `2D/3D`-Kippwinkel, Tiefe (`History`), `FFT size`, `Smooth`, Helligkeit, Kontrast, Pause, Reset & PNG-Schnappschuss.
- **Direkte Abstimmung:** Klick in die 3D-Fläche stimmt den Empfänger direkt auf die gewünschte Frequenz ab.
- **Universal-Installer (`install.sh`):** Unterstützt automatisch Docker (`CONTAINER=...`) sowie native Installationen (`TYP=normal PLUGINS=/pfad/zu/plugins`) inklusive Backup in `/opt/dnx-integrated-waterfall-backups`, `status`, `update` und `uninstall`.

## Dateien im Paket / Package Contents

| Datei | Ziel / Target | Zweck / Purpose |
|---|---|---|
| `install.sh` | Host (root) | Universal-Installer (`install`, `update`, `status`, `uninstall`) |
| `files/dnx_3dtool.js` | `…/receiver/dnx_3dtool/dnx_3dtool.js` | Integriertes 3D-Wasserfall-Modul (`v3.10`) |
| `files/dnx_3dtool.css` | `…/receiver/dnx_3dtool/dnx_3dtool.css` | Layout- & Toolbar-Styles |
| `loader-example.js` | Referenz | Beispiel-Snippet für manuelles Laden in `init.js` |
| `docs/` | — | 3 Funktionsscreenshots (`1600×980`) |

## Installation / Upgrade

```bash
chmod +x install.sh
sudo ./install.sh install
# Ohne Docker / Native installation:
sudo TYP=normal PLUGINS=/usr/lib/python3/dist-packages/htdocs/plugins ./install.sh install
# Status / Update / Entfernen:
./install.sh status
sudo ./install.sh update
sudo ./install.sh uninstall
```

---

## 3D-Hintergrund, Styler-Integration & Verbindungen (`v3.10`)

![Styler & 3D-Hintergrund im BEIDE-Modus](docs/styler-3d-hintergrund-beide.png)

### Alle Steuerelemente der `#dnx3d-toolbar` (`20` Kontrollen)

| Gruppe | Elemente | Beschreibung |
|---|---|---|
| **Ansicht (`#dnx3d-modebar`)** | `STD`, `3D`, `BEIDE`, `⇅` | Umschalten zwischen klassischem 2D, reinem WebGL-3D, synchronem Split (`BEIDE`) und Reihenfolge-Tausch (`splitFlip`). |
| **Darstellung** | `Style` (`6` Modi: `Points`, `Lines`, `Traces`, `Solid`, `Outline`, `Shaded`), `Colormap` (**`100` Optionen**: `Waterfall (wie 2D)`, `28` SDRangel-Paletten, `71` DNX/MultiSDR/OWRX), **`Hintergr`** (**`80` Optionen**: `Standard`, `7` dunkle Vollfarben, `72` Rohpaletten) | Steuert Fläche und Hintergrund unabhängig voneinander (`⌂ 2D` zeigt den 2D-Farbverlauf). |
| **Signal & Raster** | `AVG` (`No`, `Mov`, `Fix`, `Max`), `AvgN` (`1–200`), `FPS` (`5–60`), `Lin`/`Log`, `Rows` (`128–1024`), `Cols` (`64–1024`), `Smooth`, `Height`, `Bright`, `Kontr` | Volle WebGL2-Echtzeitkontrolle inkl. Frequenzskala und Klick-Abstimmung direkt in der 3D-Fläche. |
| **Aktionen** | `⇅` (Flip), `□` (Rahmen), `❚❚` (Pause), `PNG` (Schnappschuss), `↺` (Reset), `✕` | Kamera, Rahmen, Pause und Bild-Export. |

### Wie der 3D-Hintergrund technisch funktioniert & mit `DNX Styler` zusammenspielt

1. **Eigenständig (`dnx_3dtool.js`):** Bei `bg === "Standard"` rendert das WebGL-Canvas seinen eigenen dunklen Hintergrund (`rgba(0,0,0,backdrop)`). Sobald eine Festfarbe oder eine `palraw:*`-Palette gewählt wird, setzt `dnx_3dtool.js` diesen Hintergrund per `!important` auf **`#dnx3d-wrap`**, schaltet `#dnx3d-canvas` **transparent (`__dnx3dFremdHg = 1`)** und feuert `CustomEvent("dnx3d:hintergrund")`. Alle Werte werden lokal in `localStorage["dnx_3dtool"]` gesichert.
2. **Zusätzlich im `DNX Styler` (`#dnx-blk-wasserfall`):** Im Styler (`DNX-Styler`) lassen sich `3D-Farbverlauf` und `3D-Hintergrund` (`107` Optionen) zentral neben 2D-Wasserfall und Spektrum einstellen. Über `farb3dHgCss()` legt der Styler bei `palraw:*`-Verläufen einen dezenten dunklen Schleier (`0.18–0.42`) über `window.dnxPalDaten().wf` für optimalen Kontrast, synchronisiert über `Plugins.dnx_3dtool.configure()` und `window.dnx3dApi` (inkl. `300/900/2000/4000 ms`-Nachlauf) und schützt vor Canvas-Überschreibungen über `window.__dnx3dHgWache` (`700 ms`).
3. **Serverweite Verteilung (`styler_share.py :8098`) & Rechte (`:8095/:8096`):** Über `/dnx/styler/std` werden `m3d`, `m3d_flip`, `cmap3d` und `bg3d` im Admin-Standard an alle Besucher verteilt; `DNX-Receiver-Account-Control` prüft über `waterfall3d` die Freigabe pro Rolle.

![DNX Gesamtarchitektur & Verbindungen](docs/dnx-architektur-verbindungen.png)
![Datenflüsse: Spektrum, 3D-Hintergrund & Speicherung](docs/dnx-datenfluss-speicherung.png)
