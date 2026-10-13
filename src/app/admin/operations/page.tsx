"use client";

/**
 * NEXUS LIVE OPERATIONS — la sala de control (Fase 14, bloque 6).
 *
 * ────────────────────────── QUÉ ES Y QUÉ NO ES ──────────────────────────
 *
 * No es un panel de analítica. Es la pantalla que se abre cuando alguien pregunta «¿está
 * pasando algo?», y tiene que responder en segundos y sin desplazarse.
 *
 * Por eso el orden no es el de importancia de negocio, es el de urgencia:
 *
 *   1. ESTADO      ¿hay alguien dentro y hay algo roto?
 *   2. ERRORES     qué está fallando, agrupado, con su versión
 *   3. FTUE        dónde se cae el jugador nuevo
 *   4. DUELOS      ¿se terminan las partidas?
 *   5. ACTIVIDAD   DAU/WAU y sesiones
 *   6. ZONAS       qué se usa de verdad
 *   7-8. PICK'EMS y MERCADO
 *
 * ────────────────────────── TRES REGLAS DE HONESTIDAD ──────────────────────────
 *
 * **1. No dice «en directo».** Es una foto: se pide una vez y se refresca a mano o cada 60
 * segundos. Poner «LIVE» sin streaming sería mentir, así que arriba pone «hace N s».
 *
 * **2. Un cero ambiguo no se enseña como cero.** Media consola depende de la telemetría,
 * que existe desde la Fase 14. Cuando una métrica cae fuera de la cobertura, se pinta
 * «SIN COBERTURA» y no un 0 que se leería como catástrofe.
 *
 * **3. Lo inferido se dice inferido.** El abandono de duelo es una estimación —una partida
 * en curso que lleva 24 h quieta— y la etiqueta lo pone: «ESTIMADO».
 *
 * ────────────────────────── FALLO PARCIAL ──────────────────────────
 *
 * Cada bloque del snapshot llega con su propio `ok`. Si el mercado falla, el mercado dice
 * que falló y las otras ocho secciones siguen funcionando: es cuando algo va mal cuando
 * más falta hace esta pantalla.
 *
 * ────────────────────────── DATOS ──────────────────────────
 *
 * Una sola llamada a `/api/admin/operations`, protegida por `verifyAdmin`. Este componente
 * no toca ninguna tabla ni calcula ninguna métrica.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { Stage, Plate, Recessed, Rail } from "@/components/ui/Surface";
import { Readout } from "@/components/ui/Readout";
import { Badge } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Meter";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { NxButton } from "@/components/ui/NxButton";
import { Segmented } from "@/components/ui/Segmented";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/format";
import type { OperationsSnapshot, WindowKey, Block } from "@/server/services/operations";
import type { EsportsSyncHealth } from "@/lib/esports/autosync/health";
import type {
  FtueStep, DuelFunnel, PickemFunnel, MarketFunnel, ZoneUsage, SessionStats, ErrorGroup,
} from "@/server/services/analytics";

/** Refresco automático moderado. Una sala de control no necesita más, y menos sería ruido. */
const POLL_MS = 60_000;

export default function OperationsPage() {
  /*
   * BLOQUE 8.1 · V-1 — el acceso ya no se comprueba aquí. Lo hace `app/admin/layout.tsx`,
   * en un solo sitio y contra el servidor (`/api/admin/session` → `profiles.is_admin`).
   * Lo que había en esta línea era `ADMIN_ENABLED`, que ocultaba la pantalla sin
   * protegerla; el propio comentario que estaba aquí ya lo admitía. La barrera de verdad
   * sigue siendo `/api/admin/operations` con `verifyAdmin`: sin él no hay datos.
   */
  return <HydrationGate><Operations /></HydrationGate>;
}

/**
 * La puerta de acceso y el snapshot van en estados SEPARADOS a propósito.
 *
 * Si fueran uno solo, cada refresco tendría que pasar por «cargando» y la consola se
 * quedaría en blanco cada minuto. Así el snapshot anterior sigue en pantalla mientras
 * llega el nuevo, que es como se comporta una sala de control.
 */
type Puerta = "cargando" | "ok" | "sin-sesion" | "sin-permiso" | "error";

function Operations() {
  const [ventana, setVentana] = useState<WindowKey>("24h");
  const [puerta, setPuerta] = useState<Puerta>("cargando");
  const [mensaje, setMensaje] = useState("");
  const [snap, setSnap] = useState<OperationsSnapshot | null>(null);
  const [refrescando, setRefrescando] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());

  const cargar = useCallback(async (w: WindowKey) => {
    setRefrescando(true);
    try {
      if (!isSupabaseConfigured()) { setPuerta("sin-sesion"); return; }
      const sb = getSupabase();
      const { data } = (await sb?.auth.getSession()) ?? { data: { session: null } };
      const token = data.session?.access_token;
      if (!token) { setPuerta("sin-sesion"); return; }

      const res = await fetch(`/api/admin/operations?window=${w}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.status === 401) { setPuerta("sin-sesion"); return; }
      if (res.status === 403) { setPuerta("sin-permiso"); return; }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMensaje((j as { error?: string }).error ?? `Error ${res.status}`);
        setPuerta("error");
        return;
      }
      setSnap((await res.json()) as OperationsSnapshot);
      setPuerta("ok");
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : "Fallo de red");
      setPuerta("error");
    } finally {
      setRefrescando(false);
    }
  }, []);

  useEffect(() => { void cargar(ventana); }, [cargar, ventana]);

  // Refresco moderado y reloj para «hace N s». Ninguno de los dos toca la red por segundo.
  useEffect(() => {
    const p = setInterval(() => void cargar(ventana), POLL_MS);
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => { clearInterval(p); clearInterval(t); };
  }, [cargar, ventana]);

  if (puerta === "cargando" && !snap) {
    return <Plate className="p-10 text-center text-ink-muted">Construyendo el snapshot…</Plate>;
  }
  if (puerta === "sin-sesion") {
    return (
      <Plate className="mx-auto max-w-xl p-8 text-center">
        <SectionTitle as="p">Necesitas iniciar sesión</SectionTitle>
        <p className="mt-1 text-body text-ink-muted">
          Esta consola solo la ve un administrador de NEXUS.
        </p>
        <NxButton variant="primary" size="md" href="/cuenta" className="mt-5">Entrar</NxButton>
      </Plate>
    );
  }
  if (puerta === "sin-permiso") {
    return (
      <Plate tone="primary" className="mx-auto max-w-xl p-8 text-center">
        <SectionTitle as="p">Acceso restringido</SectionTitle>
        <p className="mt-1 text-body text-ink-muted">
          Tu cuenta no tiene permisos de administración. No se ha devuelto ningún dato.
        </p>
        <NxButton variant="secondary" size="md" href="/" className="mt-5">Volver a NEXUS</NxButton>
      </Plate>
    );
  }
  if (puerta === "error" && !snap) {
    return (
      <Plate className="mx-auto max-w-xl p-8 text-center">
        <SectionTitle as="p">No se pudo cargar la consola</SectionTitle>
        <p className="mt-1 text-body text-ink-muted">{mensaje}</p>
        <NxButton variant="primary" size="md" onClick={() => void cargar(ventana)} className="mt-5">
          Reintentar
        </NxButton>
      </Plate>
    );
  }

  if (!snap) return null;
  const segundos = Math.max(0, Math.round((ahora - new Date(snap.generatedAt).getTime()) / 1000));
  const criticos = snap.errors.ok ? snap.errors.data.filter((e) => e.severity === "critical") : [];
  const hoy = snap.activity.ok ? snap.activity.data[snap.activity.data.length - 1] : null;

  return (
    <section className="space-y-5 pb-10">
      {/* ═══════════ CABECERA ═══════════ */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <span className="nx-label">Administración</span>
          <h1 className="mt-1 font-display text-[clamp(26px,4vw,40px)] font-bold uppercase leading-none text-white">
            Live <span className="text-drl">Operations</span>
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            {/*
              «Foto», no «en directo». No hay streaming, y decir LIVE sería mentir.
            */}
            Foto del producto · actualizada hace{" "}
            <b className="tabular-nums text-white">{segundos}s</b>
            {" · "}construida en <b className="tabular-nums text-white">{snap.tookMs}ms</b>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented
            label="Ventana"
            value={snap.window}
            onChange={(v) => setVentana(v as WindowKey)}
            options={[
              { value: "24h" as WindowKey, label: "24 h" },
              { value: "7d" as WindowKey, label: "7 días" },
              { value: "30d" as WindowKey, label: "30 días" },
            ]}
          />
          <NxButton
            variant="secondary"
            size="md"
            onClick={() => void cargar(ventana)}
            disabled={refrescando}
          >
            {refrescando ? "Actualizando…" : "Actualizar"}
          </NxButton>
        </div>
      </header>

      {/* ═══════════ 1 · ESTADO ═══════════ */}
      <Stage tone={criticos.length > 0 ? "primary" : "neutral"} className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle as="h2">Estado</SectionTitle>
          {criticos.length > 0 ? (
            <Badge tone="bad" dot pulse solid>
              {criticos.length} {criticos.length === 1 ? "error crítico" : "errores críticos"}
            </Badge>
          ) : snap.errors.ok ? (
            <Badge tone="ok" dot>Sin errores críticos en 24 h</Badge>
          ) : (
            <Badge tone="warn" dot>Errores no disponibles</Badge>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Cifra
            label={`Activos hoy`}
            valor={hoy?.dau}
            hay={snap.activity.ok}
            cobertura={snap.coverage.hasTelemetry}
            tono="var(--nx-cyan)"
          />
          <Cifra
            label="Activos 7 días"
            valor={hoy?.wau_trailing_7d}
            hay={snap.activity.ok}
            cobertura={snap.coverage.hasTelemetry}
          />
          <Cifra
            label={`Sesiones · ${etiquetaVentana(snap.window)}`}
            valor={snap.sessions.ok ? snap.sessions.data.sessions : undefined}
            hay={snap.sessions.ok}
            cobertura={snap.coverage.hasTelemetry}
          />
          <Cifra
            label="Duelos empezados"
            valor={snap.duel.ok ? snap.duel.data.started : undefined}
            hay={snap.duel.ok}
            cobertura
          />
          <Cifra
            label="Errores 24 h"
            valor={snap.errors.ok ? snap.errors.data.reduce((n, e) => n + e.occurrences, 0) : undefined}
            hay={snap.errors.ok}
            cobertura={snap.coverage.hasTelemetry}
            tono={criticos.length > 0 ? "var(--nx-bad)" : undefined}
          />
        </div>

        {!snap.coverage.hasTelemetry && (
          <Rail label="Cobertura" tone="gold" className="mt-4 p-3">
            <p className="text-[13px] text-ink-muted">
              Todavía no hay ningún evento de telemetría registrado. Las métricas de
              actividad, sesiones, zonas y errores aparecen <b>sin cobertura</b>: no es que
              sean cero, es que aún no se está midiendo. Los embudos que salen de las tablas
              autoritativas sí tienen datos.
            </p>
          </Rail>
        )}
      </Stage>

      {/* ═══════════ 1-bis · ESPORTS SYNC (Fase 24.6) ═══════════ */}
      <Bloque
        titulo="Esports sync"
        nota="Pipeline VLR → NEXUS. Lo que el scheduler ha hecho por última vez; apagado hasta activarlo."
        b={snap.esportsSync}
      >
        {(h) => <EsportsSync h={h} />}
      </Bloque>

      {/* ═══════════ 2 · ERRORES ═══════════ */}
      <Bloque
        titulo="Errores"
        nota="Siempre últimas 24 h, sea cual sea la ventana: la pregunta es si algo está roto AHORA."
        b={snap.errors}
      >
        {(errs) => errs.length === 0 ? (
          <Vacio texto={snap.coverage.hasTelemetry
            ? "Ningún error registrado en las últimas 24 horas."
            : "Sin cobertura: todavía no hay telemetría."} />
        ) : (
          <div className="space-y-2">
            {errs.slice(0, 12).map((e, i) => (
              <Recessed
                key={`${e.fingerprint}-${i}`}
                depth="sm"
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-2 p-3",
                  e.severity === "critical" && "shadow-[inset_2px_0_0_0_var(--nx-bad)]",
                )}
              >
                <Badge tone={e.severity === "critical" ? "bad" : e.severity === "error" ? "warn" : "muted"} dot>
                  {e.severity ?? "—"}
                </Badge>
                <span className="font-display text-[13px] font-bold uppercase tracking-wide text-white">
                  {e.code ?? "sin código"}
                </span>
                <span className="nx-label">
                  {e.occurrences} {e.occurrences === 1 ? "vez" : "veces"} · {e.users} usuarios
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {e.zone && <Badge tone="muted">{e.zone}</Badge>}
                  {e.flow && <Badge tone="info">{e.flow}</Badge>}
                  {e.source && <Badge tone="muted">{e.source}</Badge>}
                  {/* La versión es lo que responde «¿esto solo pasa en la nueva?». */}
                  {e.app_version && <Badge tone="gold">v{e.app_version}</Badge>}
                </div>
                {e.sample && (
                  <p className="min-w-0 flex-1 truncate text-[12px] text-ink-faint" title={e.sample}>
                    {e.sample}
                  </p>
                )}
              </Recessed>
            ))}
            {errs.length > 12 && (
              <p className="nx-label">y {errs.length - 12} grupos más</p>
            )}
          </div>
        )}
      </Bloque>

      {/* ═══════════ 3 · FTUE ═══════════ */}
      <Bloque
        titulo="Primera experiencia"
        nota={`Cohorte: usuarios registrados en ${etiquetaVentana(snap.window)}.`}
        b={snap.ftue}
      >
        {(pasos) => {
          const base = pasos[0]?.users ?? 0;
          if (base === 0) return <Vacio texto="Nadie se registró en esta ventana." />;
          return (
            <div className="space-y-2.5">
              {pasos.map((p) => {
                // Un paso que depende de la telemetría y cae fuera de la cobertura no
                // es un cero: es un desconocido. Se pinta como tal.
                const sinCobertura = p.source === "telemetry_events" && !snap.coverage.hasTelemetry;
                return (
                  <div key={p.step} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="w-full font-display text-[12px] font-bold uppercase tracking-[0.1em] text-white sm:w-48">
                      {NOMBRES[p.step] ?? p.step}
                    </span>
                    <div className="min-w-[120px] flex-1">
                      <Meter
                        value={sinCobertura ? 0 : (p.conv_start ?? 0)}
                        tone={sinCobertura ? "muted" : p.step_order === 1 ? "key" : "info"}
                        label={`${NOMBRES[p.step] ?? p.step}: ${p.users} usuarios`}
                      />
                    </div>
                    <span className="w-16 text-right font-display text-[15px] font-bold tabular-nums text-white">
                      {sinCobertura ? "—" : p.users}
                    </span>
                    <span className="w-14 text-right text-[12px] tabular-nums text-ink-muted">
                      {sinCobertura ? "" : p.conv_start != null ? `${p.conv_start}%` : ""}
                    </span>
                    <Badge tone={p.source === "telemetry_events" ? "info" : "muted"}>
                      {p.source === "telemetry_events" ? "telemetría" : "retroactivo"}
                    </Badge>
                  </div>
                );
              })}
              <p className="nx-label pt-1">
                {snap.coverage.telemetrySince
                  ? `Los pasos de telemetría solo cubren desde ${fecha(snap.coverage.telemetrySince)}. Los marcados «retroactivo» valen para cualquier fecha.`
                  : "Los pasos marcados «telemetría» aún no tienen cobertura. Los «retroactivo» sí."}
              </p>
            </div>
          );
        }}
      </Bloque>

      {/* ═══════════ 4 · DUELOS ═══════════ */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Bloque titulo="Duelos" nota={etiquetaVentana(snap.window)} b={snap.duel}>
          {(d) => d.started === 0 ? (
            <Vacio texto="Ninguna partida empezada en esta ventana." />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Readout size="md" label="Empezadas" value={d.started} />
              <Readout size="md" label="Terminadas" value={d.completed} tone="var(--nx-ok)" />
              <Readout size="md" label="Finalización" value={`${d.completion_rate ?? 0}%`} />
              {/*
                «ESTIMADO» no es un adorno: el abandono se INFIERE de una partida en curso
                que lleva 24 h sin moverse, no de un evento. La palabra lo dice.
              */}
              <Readout size="md" label="Abandono estimado" value={d.abandoned_estimate} tone="var(--nx-warn)" />
              <Readout size="md" label="Jugadores" value={d.players} />
              <Readout
                size="md"
                label="Duración mediana"
                value={d.median_seconds != null ? `${Math.round(d.median_seconds)}s` : "—"}
              />
            </div>
          )}
        </Bloque>

        {/* ═══════════ 5 · ACTIVIDAD ═══════════ */}
        <Bloque titulo="Actividad" nota={etiquetaVentana(snap.window)} b={snap.sessions}>
          {(s) => !snap.coverage.hasTelemetry ? (
            <Vacio texto="Sin cobertura de telemetría todavía." />
          ) : s.sessions === 0 ? (
            <Vacio texto="Ninguna sesión en esta ventana." />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Readout size="md" label="Sesiones" value={s.sessions} />
                <Readout size="md" label="Usuarios" value={s.known_users} tone="var(--nx-cyan)" />
                <Readout size="md" label="Anónimas" value={s.anonymous_sessions} />
                <Readout size="md" label="Autenticadas" value={s.authenticated_sessions} />
                {/*
                  MIXTAS: empezaron anónimas y siguieron autenticadas. Es la cifra que
                  justifica el modelo de sesión entero — el tramo previo al registro.
                */}
                <Readout size="md" label="Mixtas" value={s.mixed_sessions} tone="var(--nx-gold)" />
                <Readout size="md" label="Eventos/sesión" value={s.events_per_session ?? "—"} />
              </div>
              <p className="nx-label mt-3">
                Duración mediana{" "}
                <b className="text-white">
                  {s.median_seconds_lower_bound != null ? `${Math.round(s.median_seconds_lower_bound)}s` : "—"}
                </b>{" "}
                · <b>cota inferior</b>: no se sabe cuánto se estuvo en la última pantalla.
                {s.single_event_sessions > 0 && ` ${s.single_event_sessions} sesiones de un solo evento.`}
              </p>
            </>
          )}
        </Bloque>
      </div>

      {/* ═══════════ 6 · ZONAS ═══════════ */}
      <Bloque
        titulo="Zonas"
        nota="Usuarios, sesiones y entradas son tres cifras distintas y no se suman."
        b={snap.zones}
      >
        {(zs) => zs.length === 0 ? (
          <Vacio texto={snap.coverage.hasTelemetry ? "Sin entradas registradas." : "Sin cobertura de telemetría todavía."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left">
              <thead>
                <tr className="nx-label">
                  <th className="pb-2 pr-3 font-normal">Zona</th>
                  <th className="pb-2 pr-3 text-right font-normal">Usuarios</th>
                  <th className="pb-2 pr-3 text-right font-normal">Sesiones</th>
                  <th className="pb-2 pr-3 text-right font-normal">Entradas</th>
                  <th className="pb-2 text-right font-normal">Entrada inicial</th>
                </tr>
              </thead>
              <tbody>
                {zs.slice(0, 12).map((z) => (
                  <tr key={z.zone} className="border-t border-white/[0.06]">
                    <td className="py-2 pr-3 font-display text-[13px] uppercase text-white">{z.zone}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-drl-cyan">{z.users}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ink-muted">{z.sessions}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-white">{z.entries}</td>
                    <td className="py-2 text-right tabular-nums text-ink-muted">{z.first_of_session}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloque>

      {/* ═══════════ 7-8 · PICK'EMS Y MERCADO ═══════════ */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Bloque titulo="Pick'ems" nota={etiquetaVentana(snap.window)} b={snap.pickems}>
          {(p) => (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Readout
                size="md"
                label="Vieron (telemetría)"
                value={snap.coverage.hasTelemetry ? p.viewers_telemetry : "—"}
                tone="var(--nx-cyan)"
              />
              <Readout size="md" label="Predijeron" value={p.predictors} />
              <Readout size="md" label="Predicciones" value={p.predictions} />
              <Readout size="md" label="Corregidas" value={p.scored} />
              <Readout size="md" label="Acertadas" value={p.correct} tone="var(--nx-ok)" />
              <Readout size="md" label="Recompensados" value={p.rewarded} tone="var(--nx-gold)" />
            </div>
          )}
        </Bloque>

        <Bloque titulo="Mercado" nota={etiquetaVentana(snap.window)} b={snap.market}>
          {(m) => (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Readout
                size="md"
                label="Visitaron"
                value={snap.coverage.hasTelemetry ? m.viewers_telemetry : "—"}
                tone="var(--nx-cyan)"
              />
              <Readout size="md" label="Vendedores" value={m.sellers} />
              <Readout size="md" label="Anuncios" value={m.listings} />
              <Readout size="md" label="Compradores" value={m.buyers} />
              <Readout size="md" label="Compras" value={m.purchases} tone="var(--nx-ok)" />
              <Readout
                size="md"
                label="Anuncio → venta"
                value={m.list_to_sale_pct != null ? `${m.list_to_sale_pct}%` : "—"}
              />
            </div>
          )}
        </Bloque>
      </div>

      <p className="nx-label pt-2">
        Solo agregados: esta consola no muestra usuarios individuales, correos, IP ni
        recorridos personales. ·{" "}
        <Link href="/admin" className="nx-action !inline">Volver a administración</Link>
      </p>
    </section>
  );
}

/* ═══════════════════════════ PIEZAS ═══════════════════════════ */

/**
 * Un bloque del snapshot.
 *
 * Recibe el `Block<T>` entero, no los datos: así el fallo de una sección se pinta como
 * fallo de esa sección y no puede tumbar la página. El tipo obliga a contemplarlo.
 */
function Bloque<T>({
  titulo, nota, b, children,
}: {
  titulo: string;
  nota?: string;
  b: Block<T>;
  children: (data: T) => React.ReactNode;
}) {
  return (
    <Plate className="p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <SectionTitle as="h2">{titulo}</SectionTitle>
        {nota && <span className="nx-label !normal-case !tracking-normal">{nota}</span>}
      </div>
      {b.ok ? children(b.data) : (
        <Recessed depth="sm" className="flex items-center gap-2.5 p-4">
          <Badge tone="warn" dot>No disponible</Badge>
          <span className="text-[13px] text-ink-muted">
            {b.error}. El resto de la consola sigue funcionando.
          </span>
        </Recessed>
      )}
    </Plate>
  );
}

/** Tiempo relativo corto, para «Último éxito · hace 2 min». Sin fecha, «nunca». */
function hace(iso: string | null): string {
  if (!iso) return "nunca";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "ahora";
  if (ms < 60_000) return "hace <1 min";
  if (ms < 3_600_000) return `hace ${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `hace ${Math.round(ms / 3_600_000)} h`;
  return `hace ${Math.round(ms / 86_400_000)} d`;
}

/**
 * Salud del pipeline esports (Fase 24.6). Cuatro cifras y un estado; nada más. Un pipeline que
 * nunca ha corrido no es un error: es un pipeline apagado, y se dice así.
 */
function EsportsSync({ h }: { h: EsportsSyncHealth }) {
  const never = !h.lastAttemptAt;
  const tone = never ? "muted" : h.lastStatus === "error" ? "bad" : h.consecutiveFailures > 0 ? "warn" : "ok";
  const label = never ? "Sin ejecuciones" : h.lastStatus === "error" ? "Último intento con error" : "Operativo";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={tone} dot>{label}</Badge>
        {h.lastResult && (
          <span className="text-[12px] text-ink-faint">
            {h.lastResult.mode} · {h.lastResult.dryRun ? "dry run" : "escritura"} · {h.lastResult.runId}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Readout size="md" label="Último éxito" value={hace(h.lastSuccessAt)} />
        <Readout size="md" label="Duración" value={h.lastDurationMs == null ? "—" : `${(h.lastDurationMs / 1000).toFixed(1)} s`} />
        <Readout size="md" label="Eventos actualizados" value={h.lastResult ? h.lastResult.eventsChanged : "—"} />
        <Readout
          size="md"
          label="Fallos consecutivos"
          value={h.consecutiveFailures}
          tone={h.consecutiveFailures > 0 ? "var(--nx-bad)" : undefined}
        />
      </div>
      {h.lastError && (
        <Recessed depth="sm" className="p-3 text-[13px] text-ink-muted">
          {h.lastError}
        </Recessed>
      )}
      {h.nextDueAt && (
        <p className="text-[12px] text-ink-faint">Siguiente prevista: {new Date(h.nextDueAt).toLocaleString()}</p>
      )}
    </div>
  );
}

/**
 * Una cifra del estado.
 *
 * `cobertura` es lo que distingue «cero» de «no lo sé». Sin esa distinción, una consola
 * recién instalada parecería un producto muerto.
 */
function Cifra({
  label, valor, hay, cobertura, tono,
}: {
  label: string;
  valor: number | undefined;
  hay: boolean;
  cobertura: boolean;
  tono?: string;
}) {
  if (!hay) return <Readout size="md" label={label} value="—" tone="var(--nx-warn)" />;
  if (!cobertura) {
    return (
      <div className="flex min-w-0 flex-col">
        <span className="nx-label truncate">{label}</span>
        <span className="font-display text-[15px] font-bold uppercase tracking-wide text-ink-faint">
          Sin cobertura
        </span>
      </div>
    );
  }
  return <Readout size="md" label={label} value={valor ?? 0} tone={tono} />;
}

/** Un vacío se dice con palabras. Un 0 grande se lee como un dato, y no lo es. */
function Vacio({ texto }: { texto: string }) {
  return (
    <Recessed depth="sm" className="p-5 text-center">
      <p className="font-display text-[13px] font-bold uppercase tracking-[0.12em] text-ink-faint">
        Sin datos
      </p>
      <p className="mt-1 text-[13px] text-ink-muted">{texto}</p>
    </Recessed>
  );
}

const NOMBRES: Record<string, string> = {
  user_created: "Registrados",
  ftue_started: "Primera sesión",
  welcome_pack_opened: "Abrió un sobre",
  first_card: "Primera carta",
  deck_created: "Creó un mazo",
  duel_started: "Empezó un duelo",
  duel_completed: "Terminó un duelo",
};

const etiquetaVentana = (w: WindowKey) =>
  w === "24h" ? "últimas 24 h" : w === "7d" ? "últimos 7 días" : "últimos 30 días";

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
