# Anime TV

App de escritorio (Windows, Linux, macOS) para descubrir y ver anime, con
**estado en Discord**: tus amigos ven qué serie y qué episodio estás viendo,
con su portada.

> Estado: **fase 1**. El catálogo, la interfaz y Discord funcionan; el
> reproductor y el streaming llegan en la fase 2.

## Qué hace ya

- Catálogo de [AniList](https://anilist.co): tendencias, temporada actual, populares,
  mejor valoradas, películas, búsqueda y géneros.
- Ficha de cada serie con episodios emitidos, favoritos y «Continuar viendo».
- **Discord Rich Presence**: «Viendo _Serie_ · Episodio 3 de 12», con portada,
  tiempo transcurrido y botón «Ver la serie».
- Tema oscuro y claro; diseño adaptable (en ventanas estrechas, dock inferior).

## Arquitectura

| Pieza | Tecnología |
|---|---|
| Shell de escritorio | Tauri 2 (Rust) |
| Interfaz | React 19 + TypeScript + Tailwind v4 (Vite) |
| Núcleo sin ventana (`core/`) | Rust: Discord IPC, parser de nombres de release; después fuentes y torrent |
| Metadatos y portadas | API GraphQL de AniList (caché de 1 h) |
| Discord | IPC local con el cliente de Discord (sin OAuth) |

```
core/        anime-tv-core: lógica testeable sin ventana (cargo test)
src-tauri/   la app Tauri: comandos discord_* que llama la interfaz
src/         interfaz React
```

### Hoja de ruta

1. **Fase 1 (hecha):** interfaz, catálogo, favoritos/progreso, Discord.
2. **Fase 2:** fuentes configurables por el usuario (feeds RSS / indexadores), al
   estilo de los addons de Stremio. Streaming torrent con
   [librqbit](https://github.com/ikatson/rqbit) (reproduce mientras descarga) y
   reproductor **mpv** (MKV, HEVC, subtítulos ASS). Emparejar los nombres de
   archivo con la serie (parser tipo anitomy).
3. **Fase 3:** episodios vistos sincronizados con AniList/MAL, avisos de
   episodios nuevos de tus favoritos.
4. **Fase 4:** instaladores (MSI/NSIS, AppImage, deb) y actualizaciones automáticas.

**Sobre el contenido:** la app no aloja, indexa ni distribuye vídeo. Las fuentes
las añade cada usuario y es responsabilidad suya usar solo contenido que tenga
derecho a ver.

## Discord

1. Crea una aplicación en <https://discord.com/developers/applications> (el nombre,
   p. ej. «Anime TV», es lo que se muestra si Discord no puede mostrar la serie).
2. Copia su **Application ID** en *Ajustes → Discord* y pulsa *Conectar*.
3. Con Discord abierto en el mismo equipo, al ver un episodio tu perfil mostrará
   la serie y el episodio.

## Desarrollo

Requisitos: Node 20+, Rust estable.

```bash
npm install
npm run dev          # interfaz en http://localhost:1420 (navegador, sin Discord)
npm run tauri dev    # la app de escritorio (necesita WebView: WebView2/WebKitGTK)
cargo test           # pruebas del núcleo
```

### Compilar para Windows

Cada push a `main` (o *Run workflow* en la pestaña Actions) lanza
[`.github/workflows/windows.yml`](.github/workflows/windows.yml), que compila en
Windows y deja en los *Artifacts* del run `anime-tv-windows`: instalador NSIS
(`.exe`), MSI y un `anime-tv-portable.exe` que no necesita instalación.
Windows 10/11 ya trae WebView2.
