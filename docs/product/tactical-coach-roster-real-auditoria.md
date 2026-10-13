# Tactical Coach · roster real — auditoría previa (antes de tocar nada)

Fecha: 2026-09-21. Estado de partida: F47/F47.1 cerradas, F48/48B/48C sobre diez agentes propios.

## A · Dónde vive el roster ficticio

- `src/agents/catalog.ts` → `AGENTS` (Veil, Haze, Probe, Pulse, Spear, Blitz, Warden, Tripwire, Specter, Echo), con clase, perfil de capacidades y kit abstracto.
- `src/abilities/catalog.ts` → `ABILITIES` (Smoke Screen, Containment, Recon Pulse…): **derivadas** de clase × mecánica, no de agente.
- `src/agents/visuals.ts` (F48) → acento, silueta, `published`.

**Ese catálogo NO es sólo del entrenador.** Lo consume el **motor de simulación** y el juego de cartas:
`src/sim/engine.ts` (`buildLineup`, `analyzeComposition`), `src/utility/engine.ts`,
`src/abilities/decide.ts`/`apply.ts`, `src/broadcast/postround.ts`, `src/deck/analysis.ts`. Por eso
**no se toca**: cambiarlo sería cambiar gameplay.

## B · Componentes del Tactical Coach que dependen de él

8 puntos: `AgentEmblem`, `AgentPicker` (+ `AbilityPicker`), `CompositionBuilder` (+ `CompositionStrip`),
`StrategyBoard`, `TacticalTheater` (vía `agentById`/`AgentPortrait`), `domain/tactics/composition.ts`,
`domain/tactics/strat.ts` (saneador), `app/entrenador/strats/page.tsx` (`getAbility`). Más F48:
`AgentPortrait` + `visuals.ts`.

## C · Datos persistidos (consulta de solo lectura a la BD del VPS)

| Tabla | Filas | Con ids ficticios | Dueño |
|---|---|---|---|
| `user_compositions` | **1** | 1 (`veil, haze, probe, pulse, spear`) | cuenta QA `1ff2c0ef` (`__QA_F47_COMPOSITION__`) |
| `user_strats` | **4** | 2 con `agentId` (`veil, echo, probe, warden, spear`, 6 fichas cada uno) | cuenta QA `1ff2c0ef` |
| `abilityId` en `plan` | **0** | — | — |

Ningún usuario real tiene datos del modelo ficticio. Aun así, **no hay migración destructiva**.

**Riesgo encontrado:** los dos saneadores (`sanitizeStrat`, `sanitizeComposition`) **descartan en
silencio** cualquier `agentId`/`abilityId` que no esté en el catálogo. Cambiar el catálogo a secas
borraría los agentes de esas jugadas la próxima vez que se abrieran y guardaran.

## D · Cómo están modeladas las utilities

- Pizarra: `UtilityToken { kind, label, x, y, to?, abilityId?, ownerId? }`. `kind` (9 marcas:
  humo, destello, incendiaria, aturdidor, muro, información, spike, punto de ruta, marcador)
  manda en el DIBUJO; `abilityId` es opcional.
- `AbilityPicker` deriva las habilidades del kit abstracto y **traduce** la mecánica del motor a
  la marca (`KIND_DEL_MOTOR`).

## E · Datos de agentes reales en el repo

Sí, parciales: `src/importer-vlr/agents.ts` tiene **27 nombres** (slug de VLR → nombre), sin rol ni
habilidades. Le faltan **Veto** y **Miks**.

## F · Fuente del roster real

- **Datos**: `valorant-api.com/v1/agents?isPlayableCharacter=true` — versión del juego
  **13.05.00.5350494, compilada 2026-08-20**. 29 agentes, rol, y habilidades por ranura.
- **Verificación**: la página oficial `playvalorant.com/en-us/agents/` (2026-09-21) lista los
  mismos **29** nombres, incluidos Miks y Veto (páginas `/agents/miks/` y `/agents/veto/` → 200).
- Ranuras: `Grenade`/`Ability1`/`Ability2`/`Ultimate` = teclas por defecto **C / Q / E / X**.
  Las pasivas (`Passive`) no se ofrecen como marca: no se lanzan.

## G · Assets

- **Datos** (nombres, roles, nombres de habilidad): se usan — el producto no funciona sin ellos y
  es referencia nominativa.
- **Artwork** (retratos, iconos de agente y de habilidad de Riot): **no**. El proyecto no tiene
  licencia (criterio vigente desde la Fase 16, `phase-16-report.md`: «nada que no tenga
  licencia»). No se descarga, no se enlaza, no se incrusta.
- Respaldo: ficha limpia con el **color del rol** y un **código de tres letras** derivado del nombre
  por regla (tres primeras letras), sin tabla inventada. Ningún personaje falso.

## H · ¿Hace falta migración?

**No.** `agent_ids` es `text[]` (≤ 5) sin restricción de catálogo, y `plan` es `jsonb`. El cambio es
de catálogo y de saneado. Cabecera sigue en **0054**.

## I · Cómo se preserva F47

Se cambia el CATÁLOGO que consume, no el motor táctico: coordenadas, dibujos, flechas, zonas,
texto, zoom/pan/pinch, pasos, reproducción de 520 ms, pantalla completa, línea de tiempo,
concurrencia (`updated_at`) y asignaciones a partidas quedan como están.

## J · Composiciones y jugadas antiguas

Los diez ids ficticios pasan a **legado**: los saneadores los **conservan** (no se borra nada, ni
en BD ni al volver a guardar), la interfaz los enseña como «Modelo anterior» con su emblema de
siempre y **no se pueden elegir** para nada nuevo. El entrenador los sustituye cuando quiera.
**Ningún mapeo** ficticio → real: no existe una equivalencia honesta entre modelos distintos.
