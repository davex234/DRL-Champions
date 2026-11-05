"use client";

/**
 * I18N · REACT — proveedor, selector y suscripción al idioma.
 *
 * `useLocale()` es todo lo que necesita un componente para volver a pintarse cuando cambia el idioma: el codemod la
 * añade a cada componente de primer nivel que traduce. No hay contexto que pasar ni claves que cargar por pantalla.
 *
 * CARGA. El español va en el código (es el texto fuente). Cada idioma restante es UN trozo (`bundles/<idioma>`) que se
 * descarga solo si el jugador lo usa, y la administración va aparte (`bundles/<idioma>.admin`).
 *
 * CAMBIO SEGURO. Cambiar de idioma solo cambia textos: no navega, no recarga, no remonta componentes (formularios,
 * partida y sesión siguen donde estaban) y no toca ninguna petición. Si hay una operación crítica en curso (apertura
 * de sobre, compra) el cambio se APLAZA hasta que termine — `beginCriticalOperation()`.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { getSupabase } from "@/lib/supabase/client";
import { ACCOUNT_LOCALE_AT_KEY, ACCOUNT_LOCALE_KEY, DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_STORAGE_KEY, type Locale } from "./config";
import { beginCriticalOperation, isCriticalOperationActive, onCriticalIdle } from "./critical";
import { accountLocaleOf, decideLocale, parseStoredLocale, type StoredLocale } from "./preference";
import { registerContentTranslations } from "./content";
import { CONTENT_TRANSLATIONS_ENABLED } from "@/config/features";
import { getLocale, hasCatalog, i18nVersion, registerCatalog, setActiveLocale, subscribeLocale, td, type Catalog } from "./runtime";

type Loader = () => Promise<{ default: Catalog }>;
const GAME: Partial<Record<Locale, Loader>> = {
  en: () => import("./bundles/en"),
  de: () => import("./bundles/de"),
  it: () => import("./bundles/it"),
  fr: () => import("./bundles/fr"),
  "pt-PT": () => import("./bundles/pt-PT"),
  "pt-BR": () => import("./bundles/pt-BR"),
  ja: () => import("./bundles/ja"),
};
const ADMIN: Partial<Record<Locale, Loader>> = {
  en: () => import("./bundles/en.admin"),
  de: () => import("./bundles/de.admin"),
  it: () => import("./bundles/it.admin"),
  fr: () => import("./bundles/fr.admin"),
  "pt-PT": () => import("./bundles/pt-PT.admin"),
  "pt-BR": () => import("./bundles/pt-BR.admin"),
  ja: () => import("./bundles/ja.admin"),
};

/* ─────────────────────────── estado del cliente (fuera de React: lo leen hooks y código puro) ─────────────────────────── */

const state = { ready: false, pending: null as Locale | null, admin: false, gameLoaded: new Set<Locale>(), adminLoaded: new Set<Locale>(), contentLoaded: new Set<Locale>() };
const listeners = new Set<() => void>();
let tick = 0;
const emit = () => { tick++; for (const l of [...listeners]) l(); };
const subscribe = (l: () => void) => { listeners.add(l); const off = subscribeLocale(l); return () => { listeners.delete(l); off(); }; };
const snapshot = () => tick * 1_000_003 + i18nVersion();

/** Vuelve a pintar el componente cuando cambia el idioma (o llegan sus traducciones). Devuelve el idioma activo. */
export function useLocale(): Locale {
  useSyncExternalStore(subscribe, snapshot, () => 0);
  return getLocale();
}

async function ensureLoaded(locale: Locale): Promise<void> {
  if (locale === DEFAULT_LOCALE) return;
  const jobs: Promise<void>[] = [];
  if (!state.gameLoaded.has(locale)) jobs.push(GAME[locale]!().then((m) => { registerCatalog(locale, m.default); state.gameLoaded.add(locale); }));
  if (state.admin && !state.adminLoaded.has(locale)) jobs.push(ADMIN[locale]!().then((m) => { registerCatalog(locale, m.default); state.adminLoaded.add(locale); }));
  await Promise.all(jobs);
  loadContentLayer(locale);
}

/** Capa opcional del contenido editable (`i18n/content.ts`). Va DESPUÉS del catálogo del código y nunca bloquea: si falla, español. */
function loadContentLayer(locale: Locale): void {
  if (!CONTENT_TRANSLATIONS_ENABLED || state.contentLoaded.has(locale)) return;
  state.contentLoaded.add(locale);
  void fetch(`/api/content/i18n?locale=${locale}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { entries?: unknown } | null) => { if (j && registerContentTranslations(locale, j.entries)) emit(); })
    .catch(() => { state.contentLoaded.delete(locale); });
}

function readDevice(): StoredLocale | null {
  try { return parseStoredLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY)); } catch { return null; }
}

function writeDevice(v: StoredLocale): void {
  try { window.localStorage.setItem(LOCALE_STORAGE_KEY, JSON.stringify(v)); } catch { /* modo privado: la cookie basta para esta sesión */ }
  writeCookie(v.locale);
}

function writeCookie(locale: Locale): void {
  try { document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`; } catch { /* sin cookies */ }
}

/** Aplica un idioma a la interfaz. Con una operación crítica en curso lo deja pendiente. `false` si no se pudo cargar. */
async function apply(locale: Locale): Promise<boolean> {
  if (isCriticalOperationActive() && locale !== getLocale()) { state.pending = locale; emit(); return true; }
  try { await ensureLoaded(locale); } catch { return false; }
  state.pending = null;
  setActiveLocale(locale);
  try { document.documentElement.lang = locale; } catch { /* sin DOM */ }
  writeCookie(locale);
  emit();
  return true;
}

onCriticalIdle(() => { if (state.pending) void apply(state.pending); });

/** Mantiene la operación crítica mientras `active` sea verdadero (para pantallas con fases). */
export function useCriticalOperation(active: boolean): void {
  useEffect(() => (active ? beginCriticalOperation() : undefined), [active]);
}

async function saveToAccount(v: StoredLocale): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try { await sb.auth.updateUser({ data: { [ACCOUNT_LOCALE_KEY]: v.locale, [ACCOUNT_LOCALE_AT_KEY]: v.at } }); } catch { /* sin red: el dispositivo ya lo guardó y se subirá en la próxima sesión */ }
}

export interface I18nControls {
  locale: Locale;
  /** Hay un cambio aplazado por una operación crítica. */
  pending: Locale | null;
  /** El idioma inicial ya está decidido y cargado. */
  ready: boolean;
  /** Elección EXPLÍCITA del jugador: se guarda en el dispositivo y, con sesión, en la cuenta. */
  setLocale: (locale: Locale) => Promise<boolean>;
}

export function useI18n(): I18nControls {
  const locale = useLocale();
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const setLocale = useCallback(async (next: Locale) => {
    const stored: StoredLocale = { locale: next, at: Date.now() };
    const ok = await apply(next);
    if (!ok) return false;
    writeDevice(stored);
    if (uid) void saveToAccount(stored);
    return true;
  }, [uid]);
  return { locale, pending: state.pending, ready: state.ready, setLocale };
}

/** ¿Está ya decidido el idioma inicial? (la puerta de hidratación espera a esto para no enseñar un idioma y luego otro). */
export function useI18nReady(): boolean {
  useSyncExternalStore(subscribe, snapshot, () => 0);
  return state.ready;
}

/**
 * Decide el idioma al arrancar y lo mantiene sincronizado con la cuenta y con otras pestañas. No pinta nada propio.
 * Debe ir DENTRO de `AuthProvider`.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname() ?? "";
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const syncedFor = useRef<string | null>(null);

  // 1 · Arranque: dispositivo → navegador → español. (La cuenta se concilia en cuanto se conoce la sesión.)
  useEffect(() => {
    const d = decideLocale({ device: readDevice(), account: undefined, browserLanguages: navigator.languages?.length ? navigator.languages : [navigator.language] });
    void apply(d.locale).then(() => { state.ready = true; emit(); });
  }, []);

  // 2 · Sesión: gana la elección más reciente entre dispositivo y cuenta (ver `preference.ts`).
  const uid = user?.id ?? null;
  const metadata = user?.user_metadata;
  useEffect(() => {
    if (loading || !uid) { if (!uid) syncedFor.current = null; return; }
    const account = accountLocaleOf(metadata);
    const key = `${uid}:${account?.locale ?? ""}:${account?.at ?? 0}`;
    if (syncedFor.current === key) return;
    syncedFor.current = key;
    const d = decideLocale({ device: readDevice(), account, browserLanguages: [] });
    if (d.source === "default") return; // ni dispositivo ni cuenta: se queda el idioma detectado al arrancar
    if (d.writeDevice) writeDevice(d.writeDevice);
    if (d.writeAccount) void saveToAccount(d.writeAccount);
    if (d.locale !== getLocale()) void apply(d.locale);
  }, [loading, uid, metadata]);

  // 2b · Otro DISPOSITIVO cambió el idioma. La sesión guardada trae los metadatos de cuando se inició (Supabase no los
  //      refresca hasta renovar el token), así que al arrancar con sesión se pide UNA vez el usuario al servidor y se
  //      concilia con la misma regla. Sin red no pasa nada: queda lo que había.
  const freshFor = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !uid) { if (!uid) freshFor.current = null; return; }
    if (freshFor.current === uid) return;
    freshFor.current = uid;
    const sb = getSupabase();
    if (!sb) return;
    void sb.auth.getUser().then(({ data }) => {
      if (data.user?.id !== uid || freshFor.current !== uid) return;
      const account = accountLocaleOf(data.user.user_metadata);
      if (!account) return;
      const d = decideLocale({ device: readDevice(), account, browserLanguages: [] });
      if (d.source === "default") return;
      if (d.writeDevice) writeDevice(d.writeDevice);
      if (d.locale !== getLocale()) void apply(d.locale);
    }).catch(() => undefined);
  }, [loading, uid]);

  // 3 · Otra pestaña cambió el idioma.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LOCALE_STORAGE_KEY) return;
      const v = parseStoredLocale(e.newValue);
      if (v && v.locale !== getLocale()) void apply(v.locale);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // 4 · La administración tiene su propio trozo de traducciones.
  useEffect(() => {
    state.admin = isAdmin;
    const l = getLocale();
    if (isAdmin && l !== DEFAULT_LOCALE && !hasCatalog(l, "admin")) void ensureLoaded(l).then(emit).catch(() => undefined);
  }, [isAdmin]);

  // 5 · Título de la pestaña. Next lo escribe en español (metadata estática, mismas URL para todos los idiomas): aquí
  //     se traduce por su texto. Se guarda el original para poder volver a español o cambiar a otro idioma.
  const locale = useLocale();
  useEffect(() => {
    const el = document.querySelector("title");
    if (!el) return;
    let source = document.title;
    let shown = source;
    const paint = () => {
      if (document.title !== shown) source = document.title; // Next puso un título nuevo (navegación)
      shown = td(source);
      if (document.title !== shown) document.title = shown;
    };
    paint();
    const mo = new MutationObserver(paint);
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    return () => { mo.disconnect(); if (document.title === shown) document.title = source; };
  }, [locale, pathname]);

  return <>{children}</>;
}

export { beginCriticalOperation } from "./critical";
