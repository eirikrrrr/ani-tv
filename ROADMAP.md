# Hoja de ruta de Anime TV

Estado al 27 de noviembre de 2026 · última versión: **0.1.0-alpha.8**

Este documento dice qué viene después y en qué orden, y cómo se describe una feature nueva
antes de construirla. La lista corta está en el [README](README.es.md) (sección *Hoja de ruta*).

**Canal:** todas las versiones son *alpha* (`vX.Y.Z-alpha.N`, pre-release en GitHub) hasta que
se decida pasar a beta. Cada versión publicada trae sus notas en
[`.github/release-notes/`](.github/release-notes/).

---

## ✅ Hecho

| Versión | Qué trajo |
|---|---|
| alpha.1 | Catálogo (AniList), favoritos, "Continuar viendo", tema claro/oscuro, Discord Rich Presence |
| alpha.2 | Fuentes Torznab y RSS, ranking por idioma de audio/subtítulos, resolución y seeders |
| alpha.3 | App de Discord propia con conexión automática, cursor animado, animaciones |
| alpha.4 | Addons compatibles con Stremio y tienda dentro de la app |
| alpha.5 | Streaming por torrent con mpv incluido, ajustes de descargas |
| alpha.6 | Reproductor **dentro de la ventana** con controles propios; arreglo de resultados RSS que no cargaban |
| alpha.7 | Límites de descarga y subida en vivo; compartir después de ver, con consentimiento; conexiones entrantes |
| alpha.8 | Interfaz en inglés y español, notas con minuto, chip "Descargado", animaciones del reproductor |

---

## 🔜 Próximas versiones

El orden prioriza lo que más se usa con menos riesgo, y construye antes las bases que
comparten varias features (servidor en la LAN, cola de descargas, conversión de vídeo).
Las fichas completas están en [Features nuevas](#-features-nuevas).

| Versión | Contenido | Tamaño |
|---|---|---|
| alpha.9 | **Métricas locales** (F1) | M |
| alpha.10 | **Listas y cola de reproducción** (F3, fase A) | M |
| alpha.11 | **Continuar donde lo dejaste** + siguiente episodio automático | M |
| alpha.12 | **Cola de descargas** / ver sin conexión (F3, fase B) + caché del DHT | L |
| alpha.13 | **Enviar a la TV por DLNA** (F4, fase A) + servidor en la LAN | L |
| alpha.14 | **Rooms en la LAN, entre apps** (F2, fase A) | L |
| alpha.15 | Conversión con ffmpeg → **Chromecast** (F4-B) e **invitados por navegador** (F2-B) | XL |
| más adelante | **Rooms por internet** (F2, fase C) | XL |

### Continuar donde lo dejaste (alpha.11)
- Guardar la posición de cada episodio (cada pocos segundos y al cerrar) y ofrecer
  "Continuar desde 12:34".
- Marcar como visto al pasar del ~90 %; barra de progreso en "Continuar viendo".
- Siguiente episodio automático: elegir solo el mejor resultado y recordar el grupo o
  release que usaste en esa serie.

**Listo cuando:** cierro la app a mitad de un episodio, la abro, y sigue en el mismo minuto (±5 s).

---

## ✨ Features nuevas

### F1 · Panel de métricas (local)

**Problema:** no sé cuánto he compartido ni descargado, ni cuánto anime veo.
**Propuesta:** una sección *Estadísticas* con lo que la app ya sabe, guardado solo en este
equipo y con un formato pensado para subirlo a una API más adelante.

**Incluye:**
- Totales: compartido, descargado y proporción (en MB, GB o TB según el tamaño), horas vistas,
  episodios y series.
- Gráfico por día y por mes (subida / descarga / tiempo visto), últimos 30 días y 12 meses.
- Top de series por tiempo visto y por datos compartidos.
- Rachas ("7 días seguidos viendo anime") y récords (día con más subida).
- Exportar a JSON; botón para borrar las estadísticas.

**No incluye (por ahora):** cuentas, servidor ni rankings entre usuarios.

**Cómo se mide:** el motor torrent da bytes subidos y bajados por torrent, pero se reinician
al cerrar la app. Se guardan **incrementos** cada pocos segundos en un registro local
(`{día, serie, episodio, subido, bajado, segundos vistos}`) que el panel agrega. Cada fila
lleva un id y una fecha, para poder sincronizarla sin duplicados cuando exista la API.

**Listo cuando:** veo un episodio compartiendo 10 min, cierro y abro la app, y el panel
muestra esos MB y minutos en el día de hoy.
**Prioridad:** alta · **Tamaño:** M · **Riesgos:** ninguno (los datos no salen del equipo).
**Futuro:** con la API, cada usuario registrado sube sus filas y ve el total entre dispositivos.

---

### F2 · Rooms: ver con amigos

**Problema:** quiero ver un episodio a la vez con amigos, sincronizado y con chat,
aunque alguno no tenga la app.

**Diseño (mejor que el de la referencia):**
- **Solo salas privadas, por invitación.** A diferencia de la referencia, no hay una lista
  pública de salas: emitir contenido a desconocidos sería distribuirlo, y además expone a
  quien la crea.
- **Crear en dos pasos y no en un formulario largo:**
  1. ¿Qué vemos? Sale de la ficha de la serie o del episodio actual, sin buscar de nuevo.
  2. ¿Cuándo? *Ahora* o *Programar*, y quién puede entrar (invitación con código).
- **Sala de espera:** portada grande, cuenta atrás si está programada, lista de miembros con
  estado (*conectado*, *cargando 40 %*, *listo*), y botón "Empezar cuando todos estén listos".
- **Dentro de la sala:** el reproductor de siempre más un panel lateral con miembros, chat y
  reacciones que flotan sobre el vídeo. Indicador de sincronía ("en sync" o "+1,2 s,
  resincronizando"). Quien crea la sala manda; puede pasar el mando a otro.
- **Invitar:** enlace o código corto de 6 caracteres, y QR para el móvil.

**Fases:**
- **A · LAN, entre apps (L).** La app anfitriona abre un servidor en la red local con
  WebSocket para el estado (play, pausa, seek, episodio, chat). Los invitados la descubren
  en la LAN (mDNS) o entran con el código. Cada invitado descarga el episodio con su propio
  torrent y solo se sincroniza el tiempo. Así el anfitrión no gasta subida.
- **B · Invitados por navegador en la LAN (XL).** El anfitrión sirve una página web con la sala
  y el vídeo. Los navegadores no reproducen MKV, HEVC ni subtítulos ASS, así que hace falta
  **convertir con ffmpeg** (H.264/AAC en HLS, subtítulos a WebVTT o incrustados). Es la misma
  base que Chromecast (F4-B).
- **C · Por internet (XL).** Hace falta un servidor intermedio: de señalización y relay
  (VPS propio o WebRTC con TURN, de pago) o una red tipo Tailscale/ZeroTier que monte cada
  usuario. Se decide después de A y B.

**Listo cuando (A):** dos PCs en la misma red: uno crea la sala, el otro entra con el
código, y pausa, seek y cambio de episodio se reflejan en menos de 1 s.
**Prioridad:** media-alta · **Tamaño total:** XL (repartido en 3 fases).
**Riesgos / legal:** solo salas privadas; quien crea la sala acepta un aviso como el de
compartir; el puerto de la LAN solo se abre mientras la sala existe (Windows pedirá permiso
al firewall).
**Depende de:** el servidor en la LAN (alpha.13); B depende de ffmpeg.

---

### F3 · Listas, cola y descargas (estilo Spotify)

**Problema:** quiero organizar lo que voy a ver y dejar episodios descargándose antes.
**Propuesta:** biblioteca con listas como Spotify, con los colores, la tipografía y las
formas de Anime TV.

**Fase A · Listas y cola (M):**
- *Tu biblioteca* en la barra lateral: listas con portada en mosaico (4 portadas), fijar
  arriba y ordenar.
- Página de lista: cabecera grande con degradado del color de la portada, botón ▶ rojo,
  aleatorio, y tabla de episodios (n.º, serie, episodio, duración, añadido, ⋯).
- Añadir a una lista desde cualquier tarjeta, episodio o menú ⋯, y arrastrar para ordenar.
- **Cola** ("A continuación"): reproducir siguiente, añadir a la cola, y panel lateral de la
  cola como el de Spotify.
- Listas automáticas: *Favoritos*, *Continuar viendo*, *Con notas*.

**Fase B · Cola de descargas y ver sin conexión (L):**
- "Descargar" en un episodio, una lista o una temporada; vista *Descargas* con progreso,
  pausar o reanudar, y espacio usado/libre.
- Prioridad: primero lo que está antes en la cola; límite de descargas simultáneas.
- Los episodios descargados se abren al instante y sin internet.
- Necesita que el motor recuerde los torrents entre reinicios (persistencia de librqbit).

**Listo cuando (A):** creo una lista con 3 episodios de 2 series, pulso ▶ y se reproducen
seguidos.
**Listo cuando (B):** dejo 2 episodios descargando, cierro y abro la app, terminan, y se
reproducen sin red.
**Prioridad:** alta · **Tamaño:** A = M, B = L.

---

### F4 · Enviar a la TV / Chromecast

**Problema:** quiero ver en la tele lo que tengo en la app.
**Propuesta:** botón "Enviar a…" en el reproductor, con la lista de TVs encontradas en la red.

**Fase A · Smart TV por DLNA/UPnP (L):** la mayoría de teles (Samsung, LG, Sony, Android TV)
reproducen MKV y HEVC tal cual. La app expone el vídeo en la LAN y se lo pasa a la tele.
Los controles de la app (pausa, seek, volumen) mandan sobre la tele.
**Fase B · Chromecast / Google TV (XL, con ffmpeg):** el protocolo Cast se puede hablar desde
Rust, pero Chromecast solo acepta MP4/WebM con H.264/VP9 y subtítulos WebVTT. Los MKV con
HEVC o ASS hay que convertirlos al vuelo, y eso gasta CPU.

**Listo cuando (A):** en la misma red, "Enviar a…" muestra mi tele, el episodio empieza
en ella y pausa/seek funcionan desde la app.
**Prioridad:** media · **Tamaño:** A = L, B = XL.
**Riesgos:** abrir el servidor de vídeo a la LAN (con token y solo mientras se usa); el
firewall de Windows pedirá permiso; cada marca de TV tiene sus rarezas, así que habrá que
probar en teles reales.

---

### Bases compartidas

| Base | La usan | Nota |
|---|---|---|
| Servidor en la LAN (vídeo + WebSocket, con token) | F2, F4 | Hoy el servidor escucha solo en 127.0.0.1 |
| Descubrimiento mDNS/SSDP | F2-A, F4 | Encontrar salas y teles sin escribir IPs |
| ffmpeg (remux/transcodificar a HLS) | F2-B, F4-B | +~80 MB al instalador; licencia LGPL/GPL según el build |
| Motor con torrents persistentes | F3-B, F1 | Descargas que sobreviven a reinicios |

## 🧭 Medio plazo

- **Cuentas de usuario y API**: métricas por usuario (F1), base para rooms por internet (F2-C).
- **Sincronizar con AniList / MyAnimeList:** progreso y listas (viendo, completado, pendiente).
- **Avisos de episodios nuevos** de las series que sigues (notificación del sistema).
- **Notas:**
  - añadirlas desde la ficha de la serie
  - exportar e importar (copia de seguridad)
  - capturas del fotograma junto a la nota

## 🏁 Antes de salir de alpha

- **Instaladores firmados**: hoy Windows avisa al instalar.
- **Actualización automática** dentro de la app.
- **Licencia del proyecto:** falta un archivo `LICENSE` (ver *Decisiones pendientes*).
- **Linux y macOS:** builds en CI. El reproductor integrado necesita trabajo aparte en cada sistema.

---

## ❓ Decisiones pendientes

| Tema | Opciones | Qué implica |
|---|---|---|
| Licencia | MIT, Apache-2.0, GPL-3.0… | mpv se incluye como programa aparte (GPLv2+); una licencia permisiva es compatible así |
| Firma de código | Certificado OV/EV, Azure Trusted Signing | Coste anual; quita el aviso de SmartScreen |
| Paso a beta | Cuándo | Criterio propuesto: alpha.9–11 probadas en Windows sin errores graves |

---

## 💡 Ideas sin planificar (backlog)

*(Aquí van las ideas nuevas, descritas con la plantilla de abajo. Cuando una entra en una
versión, pasa a "Features nuevas" y a la tabla de versiones.)*

- API de métricas por usuario registrado (después de F1, cuando haya cuentas).

---

## 📝 Plantilla para una feature nueva

Copia este bloque en *Ideas sin planificar* y rellénalo. Lo justo para decidir si entra y
en qué versión: no hace falta escribirlo todo de golpe.

```markdown
### Nombre corto de la feature

**Problema:** qué te molesta o qué no puedes hacer hoy (una o dos frases).
**Propuesta:** qué haría la app (lo que verías y harías tú, no cómo se programa).
**Ejemplo:** un caso concreto ("estoy viendo X, pulso Y, pasa Z").

**Incluye:**
- …
**No incluye (por ahora):**
- …

**Listo cuando:** una comprobación que se pueda hacer en la app.
**Prioridad:** alta · media · baja
**Tamaño estimado:** S (horas) · M (un día) · L (varios días) · XL (hay que partirla)
**Riesgos / legal:** privacidad, contenido con copyright, dependencias nuevas…
**Depende de:** otras features o decisiones
```

### Criterios para ordenar

1. **Valor para quien ve anime:** ¿lo usarías en cada sesión o una vez al mes?
2. **Tamaño:** lo pequeño y valioso va primero; lo XL se parte en varias versiones.
3. **Dependencias:** p. ej. "siguiente episodio automático" va después de "continuar donde lo dejaste".
4. **Riesgo:** lo que toca privacidad o legalidad se diseña con más cuidado (consentimiento,
   nada de contenido incluido en la app).
