# Fotos de jugadores

Coloca aquí las fotos de los jugadores como **PNG transparente** (fondo eliminado).

- Nombre del archivo: el `id` del jugador → `benjy.png`, `aspas.png`, `tenz.png`…
  (ver `src/data/players.ts`).
- Recomendado: busto/medio cuerpo, alta calidad, fondo recortado.
- Se escalan y centran automáticamente en la carta.
- Si falta la foto, la carta muestra una **silueta por defecto** con las iniciales.

La ruta se resuelve en `src/lib/assets.ts` (`/players/{id}.png`). Para cambiar la
ubicación o usar una CDN, edita `ASSETS.playersDir` allí.
