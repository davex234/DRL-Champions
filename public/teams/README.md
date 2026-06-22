# Logos de equipos

Coloca aquí los logos oficiales como **PNG transparente**.

- Nombre del archivo: el `slug` del equipo → `heretics.png`, `fnatic.png`,
  `sentinels.png`, `geng.png`, `edg.png`… (ver `src/data/teams.ts`).
- Si falta el logo, la carta muestra un **monograma** con la etiqueta del equipo
  y su color de marca.

La ruta se resuelve en `src/lib/assets.ts` (`/teams/{slug}.png`).
