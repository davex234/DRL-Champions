# F58 · Arquitectura del Admin Control Center

## Capas

```
Navegador (/admin/*, cliente)
  AdminGuard ──► GET /api/admin/session ──► verifyAdmin (Bearer → GoTrue → profiles.is_admin)
  AdminShell (barra lateral, cabecera, Ctrl+K)
  páginas ──► components/admin/cc/api.ts (adminFetch con Bearer; sin éxito optimista)
        │
        ▼
/api/admin/<sección>/route.ts   (finas: montan los handlers con DEFAULT_DEPS)
        │
        ▼
server/admin/handlers.ts  ──► runAdmin: verifyAdmin → app_rate_take (admin_read/admin_write) → cuerpo acotado + lista blanca → no-store → errores saneados
        │
        ├─ server/admin/users.ts        búsqueda (RPC), ficha 360, créditos (RPC), concesiones (award())
        ├─ server/admin/moderation.ts   sancionar / revocar (RPC) · listado
        ├─ server/admin/events.ts       borradores + publicar (RPC) · ficha con analítica real
        ├─ server/admin/audit.ts        escribir (RPC) · leer paginado
        └─ server/admin/overview.ts     dashboard, sistema/salud, búsqueda global, competitivo, temporadas, recompensas, jugadores, equipos, dry-run de importación
        │
        ▼
dominio puro: domain/admin/{sanctions, credits, events, packAdmin, redact, nav}.ts
        │
        ▼
Supabase (VPS): 0055 → user_sanctions · admin_event_drafts · content_audit_log(+entity) · 10 RPC service_role
```

## Qué se reutiliza (no se duplica)

| Necesidad | Sistema existente reutilizado |
|---|---|
| Autenticación admin | `verifyAdmin`, `AdminGuard`, `/api/admin/session`, middleware |
| Cartas | `/api/admin/cards` (list, facets, create, updateDraft, publish, lifecycle, artwork) y sus páginas `/admin/cartas/*` |
| Pools | `/admin/pools` + `/api/admin/pools` |
| Libro mayor | `_ledger_apply` + `credit_transactions` (0019) |
| Concesiones | `award()` → `app_grant_reward` (idempotente) |
| Auditoría | `content_audit_log` (0040), ampliada |
| Eventos | `public.events` (lo que consume el juego), `challengeSetFor` (recompensas), `eventPhase` (estado) |
| Temporadas | `loadSeasonCalendar` + `resolveCalendar` |
| Competitivo | `duel_pvp_ratings`, `duel_pvp_rating_events` |
| Economía | `PACK_STATS`, `MAIN_PACK_DISTRIBUTION`, `marketValue`, `salvageValue`, `packOddsFor` |
| Límite de frecuencia | `app_rate_take` (0036), dos cubetas nuevas |
| Arte | `CardThumb`/`CardArt` reales, `packArtwork()` |

## Migración 0055 (aditiva)

- `user_sanctions`: no existía nada persistido.
- `admin_event_drafts`: `public.events` se lee sin filtrar estado, así que un borrador allí sería visible. Es la antesala del evento canónico, no un segundo sistema.
- `content_audit_log`: dos columnas nullable (`entity_type`, `entity_id`) y el trigger append-only.
- 10 RPC: `app_admin_sanction`, `app_admin_revoke_sanction`, `app_admin_adjust_credits`, `app_admin_audit`, `app_admin_publish_event`, `app_admin_search_users`, `app_admin_user_identity`, `app_admin_dashboard_stats`, `app_admin_ledger_summary` y `app_admin_schema_probe`.

## Lo que el panel NO escribe (a propósito)

- **Precios, probabilidades, pools, `marketValue` y desguace.** Están congelados por F57.6 y viven en código. El panel los muestra y los simula (solo lectura).
- **Jugadores y equipos.** No hay backend de escritura: su identidad llega por VLR/`teamIdentities.ts`, y el equipo impreso de una carta es histórico.
- **Cierre de temporada y acciones de competitivo.** No existen en el dominio y no se inventan botones.
- **Feature flags.** Solo lectura.
