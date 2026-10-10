# Sismos cerca de ti

Panel en español, con Panamá y alrededores como centro inicial (8.54, −80.78) y radio de 1.000 km. Consulta USGS y Geociencias UP cada 30 segundos mientras está abierto. Los navegadores pueden limitar la frecuencia en segundo plano. Publicado en https://sismos-pma.xyzsolutions.tech como PWA instalable con avisos (locales con el panel abierto, Web Push con el panel cerrado); también funciona en local, sin Web Push.

## Abrir

Haz doble clic en `Abrir panel.command`. Requiere Node.js 22 o posterior y haber instalado las dependencias con `npm ci`. También puedes ejecutar:

```sh
git clone https://github.com/XYZ-Solutions-tech/sismos-pma.git
cd sismos-pma
npm ci
npm start
```

Abre http://localhost:8787. El servidor escucha exclusivamente en 127.0.0.1 y solo sirve los archivos del panel; no expone otros directorios del equipo. `SISMOS_PORT` permite cambiar el puerto al ejecutarlo por terminal. El lanzador de doble clic usa 8787 y conserva los logs en `.runtime/`. Usa el servicio temporal de macOS `local.sismos-panel` para que el servidor siga activo al cerrar Terminal; no instala un inicio automático para futuros reinicios. Para detenerlo, haz doble clic en `Detener panel.command`; con `npm start`, usa Ctrl+C.

## Datos y comportamiento

- USGS: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson. Geociencias UP: https://sismosgeociencias.up.ac.pa/. Consultas en paralelo, cache independiente de 30 segundos, timeout de 20 segundos y reintentos limitados a uno cada 30 segundos por fuente. Del feed de USGS solo se envían al navegador los sismos y los campos que usa el panel. Una fuente se marca desactualizada tras 5 minutos sin consulta exitosa.
- Por defecto muestra ambas fuentes; el filtro Fuente permite consultar UP o USGS por separado. Los conteos y gráficos son registros publicados: un mismo sismo puede tener un registro en cada catálogo con magnitud, ubicación y profundidad diferentes. No se mezclan ni se promedian las mediciones de las redes.
- El adaptador UP lee los parámetros de los enlaces oficiales de detalle. Deduplica las filas repetidas en las vistas desktop/móvil y las filas idénticas de la propia página. Convierte la hora local a UTC con offset −05:00 y conserva el estado preliminar/revisado. Si el formato deja de poder interpretarse, avisa y conserva el último catálogo exitoso.
- UP no publica un ID persistente ni una hora de generación del listado. Se identifica cada registro por hora y coordenadas; una revisión que cambie esos campos puede aparecer como un registro nuevo. Los cambios de magnitud, profundidad o estado con la misma hora/coordenadas se anuncian como revisiones.
- Profundidad de exactamente 10 km: valor provisional o fijado que las redes publican cuando no pudieron calcularla, no necesariamente una medición. La lista lo marca «prov.» y la ficha lo explica; las ondas P/S lo usan como aproximación. Otros valores se muestran tal como se publican.
- Filtros locales por distancia geodésica al epicentro, período (1 hora, 24 horas, 7 días) y magnitud. Las distancias no son distancias al hipocentro ni estimaciones de intensidad.
- Nuevo: registro incorporado desde la consulta anterior, resaltado durante 5 minutos. Las revisiones se anuncian aparte. La primera carga exitosa de cada fuente no genera avisos de registros nuevos. Cambiar filtros no genera avisos de publicación.
- Si falla una fuente, conserva sus últimos datos e indica cuál falló; la otra fuente sigue disponible. Muestra la hora de consulta y del registro más reciente por fuente, y la hora de generación cuando USGS la proporciona. No atribuye a UP una hora de actualización que no publicó.
- Ubicación opcional con permiso del navegador. Si el permiso ya estaba concedido, el panel la pide al abrirse; si no, espera al botón «Usar mi ubicación». Se dibuja como punto azul («Tú») con su círculo de precisión cuando supera 150 m. Las coordenadas se usan solo en memoria del navegador; no se guardan ni se envían a los catálogos. Solo radio, magnitud, período, fuente, el modo de ondas y si los avisos están activados se guardan en localStorage. Con avisos activados, el servidor guarda además la suscripción push y esos filtros, con la ubicación redondeada a 0,1° (~11 km); ver «PWA y avisos».
- Ondas en el mapa: cada registro emite un anillo animado cuyo tamaño crece con la magnitud (energía relativa, simbólico y educativo; no es área de daño, intensidad ni alerta anticipada). El control «Ondas» los muestra todos, solo los de la última hora o ninguno. Con «reducir movimiento» del sistema quedan fijos.
- Ondas P y S del sismo seleccionado: repetición con frentes geográficos reales (radio en km sobre la superficie) desde el epicentro hasta tu ubicación o el centro de consulta, con velocidades medias de corteza (P 6,0 km/s, S 3,5 km/s) y distancia al hipocentro. Muestra los tiempos de llegada aproximados. Es educativo: los catálogos publican cuando las ondas ya pasaron; no es cuenta regresiva ni alerta.
- «Reproducir el día» repite el período seleccionado en 20, 60 o 180 segundos: los registros aparecen en su hora con un destello proporcional a la magnitud. Las barras (48 intervalos) permiten saltar.
- La ficha del sismo indica el registro de la otra fuente cuando coincide en ±20 s y 80 km («También en…»), sin mezclar mediciones. Con ambas fuentes, la lista marca esos registros («también en USGS/UP») y el subtítulo indica cuántos sismos aparecen en ambas; los conteos siguen siendo registros. Los lugares de UP se muestran como «32 km al sur de Soná» y conservan la región como subtítulo.
- Google Maps (Maps JavaScript API, canal estable weekly, raster con estilo oscuro propio) es el mapa principal. Los epicentros, tu ubicación y las etiquetas son una capa HTML propia (`OverlayView`); las ondas P/S, el radio y la línea al sismo son polígonos y polilíneas de Google. Mapa y satélite requieren internet. Si falta la configuración o falla la carga inicial del SDK, usa Leaflet con las capas oscuras de Esri y la misma capa de marcadores. El proveedor recibe las solicitudes del mapa visible.
- USGS puede publicar con retraso, revisar o retirar eventos y no incluye necesariamente todos los sismos pequeños registrados por las redes locales. Referencia local: https://geociencias.up.ac.pa/.
- No estima daños, riesgo de tsunami ni intensidad en tu ubicación. No predice sismos ni funciona como alerta temprana.

## PWA y avisos

- `public/manifest.webmanifest` e íconos en `public/` permiten instalar el panel (Chrome/Edge/Android: botón «Instalar app» o menú del navegador; iPhone/iPad: Compartir → Agregar a inicio).
- `public/sw.js` guarda el panel para abrirlo sin conexión (red primero, caché como respaldo). No guarda `/api/*`: sin conexión el panel indica «Sin conexión».
- «Activar avisos» pide permiso de notificaciones. En cada consulta, los registros nuevos que cumplen los filtros actuales (radio, magnitud, fuente y período) generan una notificación local: una por consulta, con el registro de mayor magnitud. Tocarla enfoca el panel y selecciona ese registro. La primera carga no avisa.
- Con el panel abierto, los avisos son locales tras cada consulta (30 s). En segundo plano, Chrome de escritorio espacia las consultas (≈1 por minuto) y los móviles las pausan al poco tiempo.
- Con el panel cerrado llegan por Web Push. «Activar avisos» también suscribe el navegador (`/api/push`) y guarda en Upstash Redis la suscripción y los filtros: radio, magnitud, fuente, período y el centro (Panamá, o tu ubicación redondeada a 0,1°). Cambiar filtros o ubicación los actualiza; desactivar los avisos borra el registro. Al abrir el panel con avisos activos se vuelve a registrar.
- `/api/push-check` (protegido con `CRON_SECRET`) consulta ambos catálogos, detecta registros nuevos y envía un push por suscriptor con los que cumplen sus filtros, con el mismo texto y etiqueta que el aviso local (si el panel ya lo mostró, el push lo reemplaza sin volver a sonar). La primera consulta exitosa de cada fuente solo registra lo existente. Los IDs vistos se guardan por fuente en Redis (`ZADD NX`), así dos ejecuciones nunca anuncian el mismo registro. Las suscripciones expiradas (404/410) se eliminan.
- Lo llama cada minuto el Worker de Cloudflare `sismos-pma-cron` (`cron-worker/`), porque el plan Hobby de Vercel solo permite cron diario. Con Vercel Pro bastaría un cron en `vercel.json` hacia la misma ruta: Vercel envía el mismo `CRON_SECRET`.
- El aviso llega cuando la fuente publica el registro, minutos después del sismo: no es una alerta temprana. En iPhone/iPad las notificaciones (locales y push) solo funcionan en la app instalada en la pantalla de inicio (iOS 16.4+).

## Publicación en Vercel

Proyecto `xyzsolutions/sismos-pma`, dominio `sismos-pma.xyzsolutions.tech` (DNS en Cloudflare: CNAME `sismos-pma` → valor indicado por Vercel, sin proxy). `npm run build` copia `public/` y Leaflet a `dist/`; `api/earthquakes.js` y `api/map-config.js` son las funciones equivalentes al servidor local. La respuesta de sismos se comparte en la CDN 15 s (`Vercel-CDN-Cache-Control`); el navegador no la guarda. La CSP y demás cabeceras están en `vercel.json`. `.vercelignore` excluye `.runtime/` (clave local, logs y `push-secrets.json`) y `cron-worker/`.

Variables de producción: `SISMOS_GOOGLE_MAPS_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET` y las de Upstash Redis (`KV_REST_API_URL`, `KV_REST_API_TOKEN`, creadas por la integración `sismos-pma-redis`). Las claves VAPID y `CRON_SECRET` también están en `.runtime/push-secrets.json` (fuera de Git); `CRON_SECRET` es además un secreto del Worker. Para publicar el Worker: `cd cron-worker && npm ci && npx wrangler deploy` (cuenta XYZ Solutions de Cloudflare).

Vercel Web Analytics está activado en el proyecto; `scripts/build.mjs` copia `inject()` de `@vercel/analytics` a `vendor/` y el panel lo carga solo fuera de localhost. No usa cookies.

El repositorio https://github.com/XYZ-Solutions-tech/sismos-pma está conectado al proyecto: cada push a `main` publica en producción y cada rama o pull request genera una vista previa. Para publicar sin pasar por Git:

```sh
vercel deploy --prod --scope xyzsolutions
```

## Estructura

`server.mjs`: servidor HTTP local; `sources/catalogs.mjs`: consultas y cache de las fuentes; `sources/geociencias.mjs`: adaptador del listado oficial de UP; `public/domain.js`: geodesia, filtros, detección de cambios, registro gemelo y nombres de lugar; `public/waves.js`: tiempos de llegada P/S, frentes de onda y tamaños de marcadores; `public/overlay.js`: marcadores HTML, ubicación y etiquetas comunes a ambos proveedores; `public/data.js`: acceso a datos y preferencias; `public/map.js`: selección de proveedor; `public/google-map.js`: Google Maps oscuro; `public/leaflet-map.js`: mapa alternativo; `public/app.js`: estado, reproductor de ondas, repetición del período e interacción; `public/notify.js`: permiso, notificaciones locales, suscripción Web Push e instalación; `public/sw.js`: service worker (caché, push, clic en avisos); `api/`: funciones de Vercel; `sources/push.mjs`: validación de suscripciones y comprobación de registros nuevos; `sources/push-env.mjs`: Redis y VAPID en Vercel; `cron-worker/`: disparador por minuto en Cloudflare; `scripts/build.mjs`: salida estática para Vercel. Dependencias fijadas: Leaflet 1.9.4 (navegador), `web-push` 3.6.7 y `@upstash/redis` 1.39.0 (funciones), `@vercel/analytics` 2.0.1 (copiado al build).

## Verificar

```sh
npm test
npm audit --omit=dev
```

## Configuración de Google Maps

La clave del navegador se lee desde `SISMOS_GOOGLE_MAPS_KEY` (en Vercel, variable de entorno de producción) o `.runtime/google-maps.json` (`googleMapsKey`). Este archivo está excluido de Git; la clave se entrega al navegador exclusivamente desde el servidor local y no se imprime en logs. Las claves de Maps JavaScript son visibles en las solicitudes del navegador y deben restringirse en Google Cloud. La clave del panel está limitada a Maps JavaScript API y a `http://localhost:8787/*` y `http://127.0.0.1:8787/*`. Si cambias el puerto, también debes actualizar las restricciones en Cloud. Para la versión publicada hay que añadir `https://sismos-pma.xyzsolutions.tech/*` a los referentes permitidos. Si Google rechaza la clave en un dominio, el panel recarga una vez con el mapa alternativo durante esa sesión.

El mapa no utiliza la capa SOS de Google: presenta registros oficiales de UP y USGS como puntos. El tamaño/color representa magnitud y no intensidad, propagación ni área afectada. La facturación y las cuotas corresponden al proyecto Google Cloud configurado.
