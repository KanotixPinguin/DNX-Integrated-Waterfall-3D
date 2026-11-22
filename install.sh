#!/usr/bin/env bash
set -Eeuo pipefail
CMD=${1:-install};TYP=${TYP:-auto};CONTAINER=${CONTAINER:-owrx-8013};PLUGINS=${PLUGINS:-};NORESTART=${NORESTART:-0}
HERE=$(cd "$(dirname "$0")" && pwd);BACK="/opt/dnx-integrated-waterfall-backups"
resolve_paths() {
  if [[ "$TYP" == "normal" ]]; then
    SRC="$PLUGINS"
    if [[ -z "$SRC" ]]; then
      for cand in /usr/lib/python3/dist-packages/htdocs/plugins /opt/openwebrx/htdocs/plugins /srv/openwebrx/htdocs/plugins; do
        if [[ -d "$cand/receiver" ]]; then SRC="$cand"; break; fi
      done
    fi
  else
    if [[ "$TYP" == "auto" && -n "$PLUGINS" && -d "$PLUGINS/receiver" ]]; then SRC="$PLUGINS"
    else
      command -v docker >/dev/null 2>&1 || { echo "Docker fehlt. Nutze TYP=normal PLUGINS=/pfad/zu/plugins."; exit 1; }
      SRC=$(docker inspect "$CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/usr/lib/python3/dist-packages/htdocs/plugins"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)
    fi
  fi
  [[ -n "${SRC:-}" && -d "$SRC/receiver" ]] || { echo "Plugin-Pfad nicht gefunden ($SRC)."; exit 1; }
  INIT="$SRC/receiver/init.js"; DEST="$SRC/receiver/dnx_3dtool"
  [[ -f "$INIT" ]] || { echo "init.js nicht gefunden: $INIT"; exit 1; }
}
remove_loader() {
  python3 - "$INIT" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1]); t = p.read_text(encoding='utf-8')
a = '/* DNX_INTEGRATED_WATERFALL_LOADER_START */'; b = '/* DNX_INTEGRATED_WATERFALL_LOADER_END */'
if a in t and b in t: x, y = t.split(a, 1); _, z = y.split(b, 1); p.write_text(x.rstrip() + '\n' + z.lstrip(), encoding='utf-8')
PY
}
restart_owrx() {
  [[ "$NORESTART" == "1" ]] && return 0
  if [[ "$TYP" != "normal" ]] && command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then docker restart "$CONTAINER"
  elif command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q '^openwebrx'; then systemctl restart openwebrx; fi
}
install_cmd() {
  [[ $EUID -eq 0 ]] || { echo "Bitte als root/sudo ausfuehren."; exit 1; }
  resolve_paths; S=$(date +%F-%H%M%S); mkdir -p "$BACK/$S" "$DEST"; cp -a "$INIT" "$BACK/$S/init.js"
  [[ -f "$DEST/dnx_3dtool.js" ]] && cp -a "$DEST/dnx_3dtool.js" "$BACK/$S/dnx_3dtool.js" || true
  cp "$HERE/files/dnx_3dtool.js" "$DEST/dnx_3dtool.js"; cp "$HERE/files/dnx_3dtool.css" "$DEST/dnx_3dtool.css"; remove_loader
  if ! grep -q "Plugins.load('dnx_3dtool')" "$INIT" && ! grep -q 'Plugins.load("dnx_3dtool")' "$INIT"; then
    cat >> "$INIT" <<'JS'

/* DNX_INTEGRATED_WATERFALL_LOADER_START */
(function(){
  if(window.__dnx3dToolReleaseLoader) return; window.__dnx3dToolReleaseLoader = true;
  var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/static/plugins/receiver/dnx_3dtool/dnx_3dtool.css'; document.head.appendChild(l);
  if(window.Plugins && typeof Plugins.load === 'function'){ try{ Plugins.load('dnx_3dtool'); return; }catch(e){} }
  window.Plugins = window.Plugins || {}; window.Plugins.dnx_3dtool = window.Plugins.dnx_3dtool || {};
  var s = document.createElement('script'); s.src = '/static/plugins/receiver/dnx_3dtool/dnx_3dtool.js'; document.head.appendChild(s);
})();
/* DNX_INTEGRATED_WATERFALL_LOADER_END */
JS
  fi
  command -v node >/dev/null 2>&1 && node --check "$DEST/dnx_3dtool.js" && node --check "$INIT"
  restart_owrx; echo "DNX Integrated Waterfall 3D v3.10 installiert."
}
uninstall_cmd() {
  [[ $EUID -eq 0 ]] || { echo "Bitte als root/sudo ausfuehren."; exit 1; }
  resolve_paths; S=$(date +%F-%H%M%S); mkdir -p "$BACK/$S"; cp -a "$INIT" "$BACK/$S/init.js"; remove_loader
  rm -f "$DEST/dnx_3dtool.js" "$DEST/dnx_3dtool.css"; restart_owrx; echo "DNX Integrated Waterfall 3D entfernt."
}
status_cmd() { resolve_paths; [[ -f "$DEST/dnx_3dtool.js" ]] && echo "dnx_3dtool.js vorhanden ($DEST)" || echo "nicht installiert"; }
case "$CMD" in install|update) install_cmd ;; uninstall) uninstall_cmd ;; status) status_cmd ;; *) echo "Aufruf: $0 [install|update|status|uninstall]" ;; esac
