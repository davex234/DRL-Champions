# F72.6 · Color real de banderas y logos en las pistas

**Estado:** GO técnico en navegador real sobre el código nuevo (servidor dev en :3016). **La build de producción de :3005 sigue siendo la anterior**: hay que recompilarla (stop → `npm run build` → start) para que el usuario vea el arreglo.

## 1. Causa raíz

No era un `mix-blend-mode`, ni un filtro de color, ni una opacidad sobre la pista (medido: `elementsFromPoint` en el centro de la pista = la propia pista; ningún antepasado con blend ni opacidad).

Era la **sombra del dorso vecino**. En `RivalHand` (`src/components/duel/arena/HandFan.tsx`) cada dorso iba en un envoltorio con
`filter: drop-shadow(0 0 8px rgba(255,46,99,.45)) drop-shadow(0 8px 14px rgba(0,0,0,.6))` y `zIndex: i`. Los dorsos casi se tocan (margen −2…−4 px), así que el halo rosa + la sombra negra del dorso **i+1**, que se pinta por encima, caía sobre el borde derecho del dorso **i** y de su bandera o logo. `elementsFromPoint` no lo ve: las sombras no se pueden señalar.

Medido en Chrome real (build antigua, `qa/fase72-6/antes/`): el blanco de Corea era `#ffffff` a la izquierda y `#e6dfe0` de mediana a 390 px; el rojo de China `#ee1c25` → `#d61a24`. **La última carta de cada mano, sin vecino a la derecha, salía exacta.**

## 2. Arreglo

Con pistas, el halo se aplica **una vez, en la raíz del abanico** (`RIVAL_BACK_HALO`), y no en cada dorso. Un `filter` en el grupo se pinta detrás de todo su contenido: el conjunto mantiene su halo rosa y su sombra de caída, y ninguna sombra pisa a otra carta. Sin pistas no hay nada que proteger y cada dorso lleva su halo como antes (ahí las cartas sí se solapan y la sombra las separa).

Capas resultantes de un dorso con pista:

```
abanico (filter: halo rosa + sombra)  ← detrás de todo
└── dorso i (sin filter) → recorte overflow-hidden
    ├── fondo rojo / textura / borde
    ├── emblema (opacity .22, drop-shadow) — debajo
    └── pista (bandera: box-shadow exterior · logo: drop-shadow) — ÚLTIMA capa, sin blend, sin opacidad
```

Sin cambios en el dorso (`DuelCard.tsx`), en el tamaño de las pistas, en los assets ni en nada del servidor.

## 3. Evidencia (Chrome real, 1440 / 1024 / 390)

`scripts/_f726-qa.ts`: captura cada pista a escala 4, dibuja el asset original al mismo tamaño y compara, en las zonas uniformes del original, la **mediana** por color (un tinte o una sombra encima la desplazan; la rotación ±1,5° del abanico solo desalinea bordes finos, y se compensa con registro de ±2 px).

- Pistas reales de partida: todas Δ0 en 1440 y 1024. KR `#ffffff/#cd2e3a/#0047a0`, CN `#ee1c25`, RU, PL, US; logos GiantX, Fnatic `#ff5900`, C9 `#26ace2`.
- Japón y Turquía no salen en el reparto determinista de estas partidas → **sustitución declarada** en el mismo tablero real (se cambia solo el fichero de pistas que tienen vecino a la derecha, el peor caso): JP `#ffffff/#bc002d`, TR `#e30a17/#ffffff`, ID `#e70011`, CN, PL, KR, Fnatic, C9, G2 → Δ0 en las tres anchuras.
- Única excepción del instrumento: EE. UU. a 390 px no se puede medir (franjas de ~1 px CSS, sin zonas uniformes). Revisada a ojo: limpia.
- Comparación visual: `qa/fase72-6/compuesto-despues.png` y `despues/shots/*-<asset>.png` (original | render); mano antes/después: `antes|despues/shots/mano-rival-*.png`.

## 4. Regresión

- `src/components/duel/f726.hintColor.render.test.tsx`: sobre el marcado real de `RivalHand` y de `MatchBoard`, (A) fuera del recorte de cada dorso nada lleva filtro/sombra/blend/opacidad salvo la raíz del abanico, (B) la pista es la última capa del dorso, (C) ni la pista ni sus antepasados la tiñen, (D) el halo y el dorso NEXUS siguen. Con el filtro por dorso devuelto a su sitio, C1 y C3 fallan.
- `scripts/_f723-qa.ts` contra el código nuevo: 40/40 (0 texto, bandera y logo como imagen local, 0 rotas, recarga y reconexión = mismas pistas, reveladas = algoritmo del servidor, 0 errores, 0 Failed to fetch). Admite ahora `BASE_URL` y `F723_OUT`.
- `npm test` 5545/5545 · typecheck web+scripts OK · lint 0 errores (27 avisos previos, ninguno en ficheros tocados) · `smoke:production` 74/74 · `/api/health` 200 · `/api/ready` ready.
- `gate:browser` contra dev :3016: todas las comprobaciones de pistas, duelo, competitivo y draft PASS. FAIL de entorno: aviso de hidratación de React que solo existe en dev (páginas sin mano rival), SW no registrado en dev y saldo de la persona I agotado (570) para la precondición de compra. Salida: `qa/fase72-6/browser-gate-dev3016.json`. **Pendiente repetirlo contra :3005 tras recompilar** (y recargar saldo QA de la persona I).

## 5. Deudas

- Recompilar y reiniciar :3005 (el clasificador de auto mode no me deja parar el servicio).
- Persona I sin saldo para el siguiente `gate:browser`.
