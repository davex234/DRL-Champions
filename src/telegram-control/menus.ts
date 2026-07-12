/**
 * MENUS — teclados inline del bot. Solo construcción declarativa de botones; cada
 * callback_data es un identificador compacto (≤64 bytes, límite de Telegram) que resuelve
 * callbacks.ts. Los índices refieren a `ledger.order` (registro) y a `generation.cards`
 * (carta), nunca a datos del dominio.
 */
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "./types";

const btn = (text: string, callback_data: string): InlineKeyboardButton => ({ text, callback_data });
const kb = (rows: InlineKeyboardButton[][]): InlineKeyboardMarkup => ({ inline_keyboard: rows });

export const backRow = (to = "m:main"): InlineKeyboardButton[] => [btn("⬅️ Volver", to)];

/** 🏆 Menú principal del spec. */
export const mainMenu = (): InlineKeyboardMarkup => kb([
  [btn("📂 Torneos", "m:tournaments"), btn("🃏 Generaciones", "m:generations")],
  [btn("✅ Revisión", "m:review"), btn("🚀 Publicaciones", "m:publish")],
  [btn("🖥 Runtime", "m:runtime"), btn("📊 Estadísticas", "m:stats")],
  [btn("🕘 Historial", "m:history"), btn("⚙ Configuración", "m:settings")],
]);

/** Lista de torneos: un botón "Ver torneo" por registro. */
export const tournamentListMenu = (count: number): InlineKeyboardMarkup => kb([
  ...Array.from({ length: count }, (_, i) => [btn(`👁 Ver torneo ${i + 1}`, `t:view:${i}`)]),
  backRow(),
]);

/** Detalle de torneo: Ver torneo · Generar cartas · Abrir revisión · Ver historial. */
export const tournamentMenu = (i: number): InlineKeyboardMarkup => kb([
  [btn("🃏 Ver generación", `g:view:${i}`), btn("⚙ Generar cartas", `t:gen:${i}`)],
  [btn("✅ Abrir revisión", `r:open:${i}`), btn("🕘 Ver historial", `t:hist:${i}`)],
  [...backRow("m:tournaments")],
]);

/** Lista de generaciones. */
export const generationListMenu = (count: number): InlineKeyboardMarkup => kb([
  ...Array.from({ length: count }, (_, i) => [btn(`🃏 Generación ${i + 1}`, `g:view:${i}`)]),
  backRow(),
]);

/** Detalle de generación: Abrir revisión · Publicar · Rollback · Exportar informe. */
export const generationMenu = (i: number): InlineKeyboardMarkup => kb([
  [btn("✅ Abrir revisión", `r:open:${i}`), btn("🚀 Publicar", `g:pub:${i}`)],
  [btn("⟲ Rollback", `g:rb:${i}`), btn("📄 Exportar informe", `g:report:${i}`)],
  [...backRow("m:generations")],
]);

/**
 * Revisión: acciones por carta mostrada (✓ aprobar · ✗ rechazar · ⛔ bloquear · ◌ ocultar,
 * por índice de carta) + aprobar selección + aprobar generación completa.
 */
export function reviewMenu(i: number, shownCardIdx: number[]): InlineKeyboardMarkup {
  return kb([
    ...shownCardIdx.map((ci, n) => [
      btn(`✓ ${n + 1}`, `r:a:${i}:${ci}`), btn(`✗ ${n + 1}`, `r:x:${i}:${ci}`),
      btn(`⛔ ${n + 1}`, `r:b:${i}:${ci}`), btn(`◌ ${n + 1}`, `r:h:${i}:${ci}`),
    ]),
    ...(shownCardIdx.length ? [[btn("✅ Aprobar selección", `r:sel:${i}`)]] : []),
    [btn("✅✅ Aprobar generación", `r:all:${i}`)],
    [...backRow(`g:view:${i}`)],
  ]);
}

/** Revisión sin abrir: solo abrirla. */
export const reviewClosedMenu = (i: number): InlineKeyboardMarkup => kb([
  [btn("▶️ Abrir revisión", `r:open:${i}`)],
  backRow(`g:view:${i}`),
]);

/** Publicación: Publicar · Rollback. */
export const publishMenu = (i: number): InlineKeyboardMarkup => kb([
  [btn("🚀 Publicar", `g:pub:${i}`), btn("⟲ Rollback", `g:rb:${i}`)],
  backRow(),
]);

/** Confirmación de acción sensible. */
export const confirmMenu = (): InlineKeyboardMarkup => kb([
  [btn("✅ Confirmar", "cf:yes"), btn("🚫 Cancelar", "cf:no")],
]);

export const settingsMenu = (notificationsOn: boolean): InlineKeyboardMarkup => kb([
  [btn(notificationsOn ? "🔕 Desactivar notificaciones" : "🔔 Activar notificaciones", "s:notif")],
  backRow(),
]);

export const homeMenu = (): InlineKeyboardMarkup => kb([backRow()]);
