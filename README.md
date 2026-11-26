# Anime TV

App de escritorio (Windows, Linux, macOS) para descubrir y ver anime, con
**estado en Discord**: tus amigos ven qué serie y qué episodio estás viendo,
con su portada.

> Estado: **alpha**. Catálogo, Discord, fuentes e idiomas funcionan; el
> reproductor integrado (streaming) llega en la próxima fase.

## Qué hace ya

- Catálogo de [AniList](https://anilist.co): tendencias, temporada actual, populares,
  mejor valoradas, películas, búsqueda y géneros.
- Ficha de cada serie con episodios emitidos, favoritos y «Continuar viendo».
- **Discord Rich Presence**: logo de la app mientras navegas; al ver, «Viendo _Serie_ ·
  Episodio 3 de 12» con la portada, tiempo transcurrido y botón «Ver la serie».
- Fuentes Torznab/RSS con idiomas preferidos (audio o subtítulos) y selector de releases.
- Cursor animado (personajes propios o un GIF/APNG/WebP del usuario) y animaciones.
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

Con Discord abierto en el mismo equipo, la app se conecta sola (aplicación
«Anime TV» de Discord, sin login):

- navegando: logo de Anime TV y «Explorando el catálogo»;
- viendo un episodio: portada de la serie, «Viendo _Serie_» y «Episodio 3 de 12».

Si Discord se abre después, la app reintenta cada 30 s. En *Ajustes → Discord →
Avanzado* se puede usar otra aplicación de Discord (su Application ID). No hace
falta añadir la app a «Juegos registrados».

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
