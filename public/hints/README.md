# Iconos de pista de las cartas ocultas (F72.2)

Aquí van los iconos que las cartas ocultas del rival usan como pista visual. `roles/` y `regions/` siguen VACÍAS
(F72.3): los iconos de rol de VALORANT y de liga VCT requieren licencia de Riot; no se importan ni se recrean.

- `roles/duelist.svg`, `roles/controller.svg`, `roles/initiator.svg`, `roles/sentinel.svg` — iconos OFICIALES de rol de VALORANT.
- `regions/americas.svg`, `regions/emea.svg`, `regions/pacific.svg`, `regions/china.svg` — iconos de liga VCT.

Añadir uno son dos gestos: dejar el fichero y añadir su id (`roles/duelist`, `regions/emea`…) a `HINT_ICONS_AVAILABLE`
en `src/lib/duel/hintVisuals.ts`. Un test (`f722.visualHints` V5) compara la lista con esta carpeta.

Logos de equipo (F72.3): `teams/<canonicalId>.png` + `HINT_TEAM_LOGOS` (`src/data/teamLogos.ts`), 25 copiados de la
biblioteca NEXUSFICHAJES; ver `teams/README.md` (integración técnica aprobada, derechos para release SIN RESOLVER).
Banderas: `public/flags/` (flag-icons, MIT).

Mientras falte un icono, ese tipo de pista no se elige: el servidor pasa a la siguiente pista con asset (mismo orden
determinista) y, si no hay ninguna, la carta sale con el dorso normal.
