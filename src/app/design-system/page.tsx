"use client";

/**
 * SHOWCASE DEL DESIGN SYSTEM — **temporal, de la Fase 3.**
 *
 * Existe para una cosa: poder VER las primitivas juntas y comprobar que hablan el mismo idioma
 * antes de llevarlas a ninguna pantalla. No es producto — no está enlazada desde el menú, no
 * consume datos y no cuenta una historia. Si al cerrar el Global Design Pass no ha demostrado
 * utilidad permanente como referencia del equipo, se borra.
 *
 * Enseña exactamente lo que pide §32: superficies, geometría, botones, tipografía, readouts,
 * estados y movimiento. Nada más.
 */
import { useState } from "react";
import { NxButton, type NxButtonVariant } from "@/components/ui/NxButton";
import { Stage, Plate, Recessed, Rail, Medallion } from "@/components/ui/Surface";
import { Readout } from "@/components/ui/Readout";
import { CHAMFER, READOUT, DEPTH, LAYER, DENSITY } from "@/design/tokens";

const VARIANTES: NxButtonVariant[] = ["primary", "secondary", "tertiary", "ghost", "danger", "icon"];

function Bloque({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <Rail label={title} className="mb-4" />
      {note && <p className="mb-4 max-w-2xl text-sm text-ink-muted">{note}</p>}
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  const [pulsado, setPulsado] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold">Sistema de diseño NEXUS</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">
        Fase 3. Fundaciones y primitivas, sin pantallas. Lo que aquí se ve es lo que todas las
        pantallas deberían poder construir sin inventar un estilo nuevo.
      </p>

      <div className="mt-8">
        <Bloque
          title="Superficies"
          note="Cinco papeles y ninguno más. El lienzo no es un componente: lo pinta el armazón."
        >
          <Stage tone="primary" grid className="p-6">
            <p className="nx-label mb-3">Escenario</p>
            <div className="flex flex-wrap gap-4">
              <Plate className="w-56 p-4">
                <p className="nx-label mb-2">Placa</p>
                <Recessed className="p-3">
                  <p className="text-xs text-ink-secondary">Hundida</p>
                </Recessed>
              </Plate>
              <Plate tone="cyan" className="w-56 p-4">
                <p className="nx-label mb-2">Placa · tinte</p>
                <div className="flex gap-2">
                  <Medallion tone="cyan" size={40}><span className="nx-readout text-sm">12</span></Medallion>
                  <Medallion tone="gold" size={40}><span className="nx-readout text-sm">7</span></Medallion>
                  <Medallion tone="success" size={40}><span className="nx-readout text-sm">3</span></Medallion>
                </div>
              </Plate>
            </div>
          </Stage>
        </Bloque>

        <Bloque
          title="Geometría"
          note="El chaflán por rol, no por tamaño. Ni un valor existente cambia: `stage` y `control` son los de siempre."
        >
          <div className="flex flex-wrap gap-4">
            {(Object.entries(CHAMFER) as [string, string][]).map(([rol, v]) => (
              <div key={rol} className="flex flex-col items-center gap-1">
                <div
                  className="nx-clip h-20 w-20 border border-edge-strong bg-surface-raised"
                  style={{ ["--nx-chamfer" as string]: v }}
                />
                <span className="nx-label">{rol}</span>
                <span className="text-[10px] text-ink-faint">{v}</span>
              </div>
            ))}
          </div>
        </Bloque>

        <Bloque
          title="Botones"
          note="Una familia, seis papeles. Misma geometría en los seis; lo que cambia es el peso, y el peso es semántico. Una acción primaria por pantalla."
        >
          <div className="space-y-4">
            {(["lg", "md", "sm"] as const).map((size) => (
              <div key={size} className="flex flex-wrap items-center gap-3">
                <span className="nx-label w-8">{size}</span>
                {VARIANTES.map((v) => (
                  <NxButton
                    key={v}
                    variant={v}
                    size={size}
                    onClick={() => setPulsado(`${v}/${size}`)}
                  >
                    {v === "icon" ? <Glifo /> : v}
                  </NxButton>
                ))}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <span className="nx-label w-8">off</span>
              {VARIANTES.map((v) => (
                <NxButton key={v} variant={v} disabled>
                  {v === "icon" ? <Glifo /> : v}
                </NxButton>
              ))}
            </div>
            <p className="text-xs text-ink-faint">
              Último pulsado: <span className="text-ink-secondary">{pulsado ?? "—"}</span>
              {" · "}Tabula para ver el foco: es un anillo de dos tonos, no un `outline` borrado.
            </p>
          </div>
        </Bloque>

        <Bloque
          title="Cifras"
          note="OVR, créditos, XP, puntos, rango, marcador y serial son el mismo dato. Cinco pasos, y se reconocen sin color."
        >
          <Plate className="flex flex-wrap items-end gap-8 p-5">
            {(Object.keys(READOUT) as (keyof typeof READOUT)[]).map((s) => (
              <Readout key={s} size={s} label={s} value="1.284" unit={s === "md" ? "pts" : undefined} />
            ))}
          </Plate>
          <div className="mt-3 flex flex-wrap gap-8">
            <Readout size="lg" label="OVR" value="92" tone="var(--nx-gold, #ffd35c)" />
            <Readout size="lg" label="Créditos" value="6.000" />
            <Readout size="lg" label="Marcador" value="6–5" align="center" />
          </div>
        </Bloque>

        <Bloque
          title="Tipografía"
          note="Cinco papeles. `label` es el conector de todo el HUD; `readout` es la cifra."
        >
          <Plate className="space-y-3 p-5">
            <p className="font-display text-4xl font-bold">Display · titular de sección</p>
            <p className="font-display text-xl font-bold">Heading · bloque</p>
            <p className="text-sm text-ink-secondary">Body · el texto que se lee en frases, a 14 px y con altura 1,55.</p>
            <p className="nx-label">Label · versalitas anchas</p>
            <p className="nx-readout text-2xl">1234567890 · readout tabular</p>
          </Plate>
        </Bloque>

        <Bloque title="Profundidad y capas" note="Sombra semántica y una jerarquía de z-index con nombre, en vez de una subasta de números.">
          <div className="flex flex-wrap gap-4">
            {(Object.entries(DEPTH) as [string, string][]).map(([n, v]) => (
              <div key={n} className="flex flex-col items-center gap-1">
                <div className="h-16 w-24 bg-surface-raised" style={{ boxShadow: v }} />
                <span className="nx-label">{n}</span>
              </div>
            ))}
          </div>
          <Recessed className="mt-4 p-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
              {(Object.entries(LAYER) as [string, number][]).map(([n, v]) => (
                <span key={n}><span className="text-ink-secondary">{n}</span> {v}</span>
              ))}
            </div>
          </Recessed>
        </Bloque>

        <Bloque title="Densidad" note="Dos ritmos de la misma estética: donde se juega y donde se administra. Cambia el aire y el tamaño del dato, nunca la geometría ni el color.">
          <div className="flex flex-wrap gap-4">
            {(Object.entries(DENSITY) as [string, { gap: string; pad: string; readout: string }][]).map(([modo, d]) => (
              <Plate key={modo} style={{ padding: d.pad }} className="min-w-[240px]">
                <p className="nx-label mb-2">{modo}</p>
                <div className="flex" style={{ gap: d.gap }}>
                  <Readout size={modo === "gameplay" ? "lg" : "sm"} label="XP" value="1.000" />
                  <Readout size={modo === "gameplay" ? "lg" : "sm"} label="Pts" value="620" />
                </div>
              </Plate>
            ))}
          </div>
        </Bloque>
      </div>
    </div>
  );
}

/** Glifo de ejemplo para el botón de icono: trazo, rejilla de 24, ángulos de la casa. */
function Glifo() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path d="M4 12h16M12 4v16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
