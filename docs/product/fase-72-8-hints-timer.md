# F72.8 · Pistas en color real + reloj de decisión con jugada automática (servidor)

> **SUPERADO EN PARTE por DUEL GAMEPLAY UX 2.0 (2026-10-06):** contra un BOT (partida rápida, campaña, Draft
> Gauntlet) ya NO hay reloj: ni plazo, ni jugada automática, ni derrota por tiempo (`decisionDeadline(true, …)` = null;
> un `turn_deadline_at` heredado se ignora). El reloj de 30 s de este documento sigue IGUAL en PvP (ranked, amistoso,
> torneo). Ver `docs/product/duel-gameplay-ux-2.md`.

Build servida en :3005: `drl-0.1.1-1-628b76e3` (stop → `npm run build` → start canónicos). Sin commit, push, deploy ni migración.

## A · Pistas

**Auditoría** (`scripts/_f728-audit.ts`, Chrome real, movimiento normal y reducido): ninguna capa —ni las de
`pointer-events:none` ni pseudo-elementos— se pintaba encima de la pista. Lo que sí había en su cadena: el
`filter: drop-shadow` del abanico (antepasado: la pista se rasterizaba dentro de una superficie filtrada), el giro de
cada dorso (re-muestreo), el `translate(-50%)` de la propia pista (posición de medio píxel), la sombra negra + anillo
blanco de la bandera y el `drop-shadow` del logo; y la bandera pegada al magenta (el blanco se percibe rosado).

**Ahora** (`DuelCard.tsx` · `DuelCardBack`, `arena/HandFan.tsx` · `RivalHand`):

```
abanico (sin filtro) ─ halo = <span data-hand-halo> propio, DETRÁS (-z-10, box-shadow rosa)
└── dorso (sin filtro, sin giro; desplazamiento en px enteros) · recorte overflow-hidden
    ├── fondo rojo, textura, borde, emblema, neón INTERIOR (inset box-shadow)
    └── capa limpia <span data-hint-layer isolate>  (posición en %, sin transform)
          ├── placa neutra <span data-hint-plate> #0b0c12   ← del dorso, debajo
          └── <img data-hint-art src=/flags|/hints/teams>  object-fit:contain · filter:none · blend normal · opacity 1
```

Sin asset → la imagen se oculta (`onError`), nunca icono roto. Sin pistas, el dorso conserva su halo y giro de siempre.

**Resultado** (`scripts/_f728-color-qa.ts`, :3005, 1440/1024/390): arnés ORIGINAL | IN-GAME (marcado real de
`RivalHand` + CSS de la build, inyectado en `:3005/offline.html`; ninguna ruta nueva) con US KR CN TR JP ID + Fnatic C9
G2 GiantX consecutivos, y partida real. 59 PASS con Δ0 por color (blanco #ffffff, JP #bc002d, TR #e30a17, CN #ee1c25,
ID #e70011, KR, US #bd3d44, Fnatic #ff5900, C9 #26ace2…); 1 NO MEDIBLE: EE. UU. a 18×14 px (13 franjas en 14 px, la
comparación mide la fase de rasterizado), revisada a ojo: mismos colores. **España: no hay `es.svg`** (ninguna carta es
ES; F72.3 solo importó las usadas); no se añadió ningún asset. Assets byte-idénticos (68 ficheros).

## B · Reloj

- `src/lib/duel/turnClock.ts`: `TURN_DECISION_SECONDS = 30` (único sitio), `decisionKey` (turno+tipo+bando),
  `autoDecision` (hash FNV-1a de `matchId|turno|ATTACK/DEFENSE|bando` sobre la mano ordenada; se prueba carta a carta con
  el orquestador; stat atacando por el mismo hash entre las legales; defendiendo, la obligada), helpers de contador.
- Plazo en `duel_matches.turn_started_at / turn_deadline_at` (columnas de 0031, ya usadas por PvP): sin migración.
- PvE (`duels.ts`): `launchPve` fija el primer plazo; `commitDecision` = un solo camino para jugada humana y automática
  (bot, confirmación, `persist` condicionado por versión —y por el mismo plazo vencido en la automática—, pago, campaña/
  draft). `settleClock` resuelve en `state`, `active` (F5/reconexión) y en una jugada tardía (409 `TURN_EXPIRED` + estado).
- PvP (`duelsPvp.ts`): `PVP_TURN_MS = TURN_DECISION_MS` (antes 90 s por turno); plazo por DECISIÓN; `expireTurnIfDue`
  ya no cierra EXPIRED: juega la decisión con la misma puerta (versión + plazo vencido) y la registra en
  `duel_match_actions`. Disparadores existentes: sondeo de cualquiera de los dos, acción tardía, barrido al encolar.
- Registro público `state.timeouts` ({turno, bando, tipo}, sin cartas); `projectMatchFor` lo propaga a los dos.
- Cliente: `useDecisionClock` solo pinta `deadline − serverNow` corregido; a 0 pregunta al servidor (reintenta 1 s).
  `TurnTimer` único (PvE en `MatchTopBar`, PvP en su barra), ámbar ≤10 s, rojo ≤5 s, latido solo con movimiento no
  reducido; `TimeoutNotice` «Tiempo agotado · Jugada automática» sin modal. El tablero limpia la selección al cambiar de
  decisión.

**Resultado real en :3005** (`scripts/_f728-timer-qa.ts`, esperas reales de 30 s): 1440 20/20, 1024 14/14, 390 14/14
(390 en movimiento reducido), PvP 9/9 (ranked real F/G). Ataque y defensa vencen solos (retraso 0,8–1,8 s), F5 con 00:05
sigue en 00:05 y vence en el plazo original (+0,4 s), dos clientes de la misma cuenta = una resolución y el mismo
resultado; PvP: mismo plazo para los dos, el servidor juega por quien debía, estado idéntico, la partida sigue.

Tests: `turnClock.test.ts` (8), `turnClock.service.test.ts` (14, MemSupabase: carreras reales), `f726.hintColor.render.test.tsx`
(3, contrato de capas nuevo). Contratos actualizados a propósito: F72.2 P2 (fondo CSS → `<img>`), B7 (contador compartido),
T114 (firma de `persist`), 44+45+46 (`PVP_TURN_MS`), UI_FILES (+TurnTimer). Huella dorada del motor (F61) intacta.

## Deudas / notas

- `scripts/pvp-timeout-verify.ts` (vivo, fuera de CI) espera el comportamiento antiguo (cerrar EXPIRED): marcado SUPERADO.
- PvE sin nadie mirando: la decisión vencida se resuelve cuando el servidor vuelve a ser consultado (F5, volver a JUGAR),
  una por consulta; no hay barrido PvE (no hay rival esperando). «Salir y guardar» sigue existiendo.
- La animación de intro/revelación consume parte de los 30 s de la decisión siguiente (~2–3 s).
- El barrido global PvP (`duel_pvp_expired_candidates`, 0035) solo cubre `PVP`; el privado se resuelve por sondeo.
- `src/design/tokens.ts` lo modificó otro proceso hoy a las 14:18 (no F72.8): no está en la build servida.
