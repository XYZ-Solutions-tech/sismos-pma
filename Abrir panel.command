#!/bin/zsh
set -eu
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
mkdir -p .runtime
if curl -fsS http://localhost:8787/api/health 2>/dev/null | /usr/bin/grep -q '"app":"sismos-local"'; then
  open http://localhost:8787
  exit 0
fi
if ! command -v node >/dev/null; then
  print 'Se necesita Node.js 22 o posterior para abrir el panel.'
  read '?Pulsa Enter para cerrar.'
  exit 1
fi
if [ ! -f node_modules/leaflet/dist/leaflet.js ]; then
  print 'Faltan las dependencias. Ejecuta npm ci en esta carpeta.'
  read '?Pulsa Enter para cerrar.'
  exit 1
fi
launchctl submit -l local.sismos-panel -o "$PWD/.runtime/server.log" -e "$PWD/.runtime/server-error.log" -- "$(command -v node)" "$PWD/server.mjs"
for attempt in {1..30}; do
  if curl -fsS http://localhost:8787/api/health 2>/dev/null | /usr/bin/grep -q '"app":"sismos-local"'; then
    open http://localhost:8787
    exit 0
  fi
  sleep 0.2
done
print 'No se pudo iniciar el panel. Revisa .runtime/server.log; el puerto 8787 puede estar ocupado.'
read '?Pulsa Enter para cerrar.'
exit 1
