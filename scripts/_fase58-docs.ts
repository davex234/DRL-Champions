/** F58 · genera routes.json y permissions.json desde el código (instrumento `_`, fuera de CI). */
import { writeFileSync, mkdirSync } from "node:fs";
import { ADMIN_SECTIONS, PALETTE_ACTIONS } from "@/domain/admin/nav";
const OUT = "docs/product/qa/fase58-admin";
mkdirSync(OUT, { recursive: true });
const api = [
  { path: "/api/admin/dashboard", methods: { GET: "admin_read" } },
  { path: "/api/admin/search", methods: { GET: "admin_read" } },
  { path: "/api/admin/users", methods: { GET: "admin_read", POST: "admin_write (adjust_credits · grant)" } },
  { path: "/api/admin/moderation", methods: { GET: "admin_read", POST: "admin_write (sanction · revoke)" } },
  { path: "/api/admin/events", methods: { GET: "admin_read", POST: "admin_write (preview · create · update · cancel · publish)" } },
  { path: "/api/admin/audit", methods: { GET: "admin_read (sin escritura HTTP)" } },
  { path: "/api/admin/system", methods: { GET: "admin_read" } },
  { path: "/api/admin/catalog", methods: { GET: "admin_read (players · player · teams · team · seasons · competitive · rewards)", POST: "admin_read (import_dry_run: solo valida)" } },
  { path: "/api/admin/packs", methods: { GET: "admin_read (lista · ficha · economy)", POST: "admin_write (simulate: solo lectura, CPU)" } },
  { path: "/api/admin/cards", methods: { POST: "existente (verifyAdmin): list · facets · create · updateDraft · publish · lifecycle · artwork…" } },
  { path: "/api/admin/pools", methods: { POST: "existente (verifyAdmin)" } },
  { path: "/api/admin/{assets,operations,releases,tournaments,session}", methods: { "*": "existentes (verifyAdmin)" } },
];
writeFileSync(`${OUT}/routes.json`, JSON.stringify({ ui: ADMIN_SECTIONS.map((s) => ({ ...s })), extraUi: ["/admin/cards/new → /admin/cartas/nueva", "/admin/cards/[id] → /admin/cartas/[id]", "/admin/events/new", "/admin/events/[id]", "/admin/users/[id]", "/admin/players/[id]", "/admin/teams/[id]", "/admin/packs/[id]", "/admin/roster (editor local heredado)"], api, palette: PALETTE_ACTIONS }, null, 2));
writeFileSync(`${OUT}/permissions.json`, JSON.stringify({
  model: "Un único rol: profiles.is_admin (no existe superadmin ni jerarquía en el esquema).",
  uiGate: "AdminGuard → GET /api/admin/session → verifyAdmin (Bearer → GoTrue → profiles.is_admin con service_role). Falla cerrado.",
  apiGate: "Todas las rutas /api/admin/* verifican por su cuenta (runAdmin/verifyAdmin); el middleware corta en el borde las peticiones sin Bearer.",
  dbGate: "RPC de 0055: security definer, execute SOLO service_role, y comprueban que p_actor es admin. Tablas nuevas: RLS activa y sin grants a anon/authenticated.",
  roles: { anon: "401 en todo /api/admin/*", authenticatedUser: "401 en todo /api/admin/* (idéntico al anónimo: no es un oráculo)", admin: "lectura y acciones del panel; nunca sobre sí mismo (auto-sanción) ni sanciones a otros admins" },
  riskLevels: { LOW: [], MEDIUM: ["editar/cancelar borrador de evento", "guardar borrador de carta"], HIGH: ["ajustar créditos", "conceder sobre/carta", "suspender", "revocar sanción", "publicar evento (escribir su nombre)", "importar cartas (tras dry run)"], CRITICAL: ["ban permanente (escribir el usuario)", "cambio de estado masivo de cartas (escribir «N cartas»)"] },
  rateLimits: { admin_read: "240/min por admin", admin_write: "20/min por admin" },
  idempotency: { credits: "ref admin:credits:<gesto> (credit_transactions)", grants: "ref admin:grant:<gesto> (app_grant_reward)", sanctions: "una activa por usuario (lock del perfil)", events: "publicar solo un borrador; updated_at como versión" },
}, null, 2));
console.log("ok");
