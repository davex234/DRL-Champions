"use client";

/**
 * LAUNCHER — CONFIGURACIÓN.
 *
 * Cinco secciones: General, Launcher, Descargas, Interfaz y Cliente. Todo lo que se toca aquí
 * SE APLICA de verdad: la intensidad de efectos mueve el parallax y las partículas del hero, el
 * límite de velocidad recorta el ancho de banda del gestor de descargas y el cupo de descargas
 * simultáneas manda las demás a la cola. No hay un solo interruptor decorativo.
 *
 * La sección Cliente conserva íntegro lo que ya existía en el launcher anterior: canal,
 * comprobación de actualizaciones, verificación de archivos y reparación.
 */
import { motion } from "framer-motion";
import { CHANNELS, channelInfo, formatBytes, type Channel } from "@/platform";
import { DISKS, MOTION_LABEL, THEME_LABEL, type LauncherSettings, type MotionLevel, type ThemeId } from "@/launcher";
import { cn } from "@/lib/format";
import type { UpdaterApi } from "../useUpdater";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Plate } from "@/components/ui/Surface";
import { Segmented } from "@/components/ui/Segmented";
import { Slider, Toggle } from "./primitives";
import { ns, td, tdIn } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("launcher");

export function SettingsView({
  settings, onChange, onReset, onResetLibrary, up, version, motionScale,
}: {
  settings: LauncherSettings;
  onChange: (patch: Partial<LauncherSettings>) => void;
  onReset: () => void;
  onResetLibrary: () => void;
  up: UpdaterApi;
  version: string;
  motionScale: number;
}) {
  useLocale();
  const updateAvailable = up.state.phase === "available";

  return (
    <motion.div
      initial={motionScale > 0 ? { opacity: 0, y: 14 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto max-w-[880px] space-y-7 pb-4"
    >
      <header>
        <h1 className="font-display text-[34px] font-black uppercase leading-none tracking-tight text-white">
          {t("Config")}<span className="text-drl">{t("uración")}</span>
        </h1>
        <p className="mt-1.5 text-[13px] text-white/45">{t("Ajustes del cliente. Se guardan al instante en este equipo.")}</p>
      </header>

      {/* ── General ── */}
      <section>
        <SectionTitle>{t("General")}</SectionTitle>
        <Plate className="divide-y divide-white/[0.05]">
          <Toggle
            label={t("Iniciar con el sistema")}
            hint={t("El cliente arranca minimizado al encender el equipo.")}
            checked={settings.autoStart}
            onChange={(v) => onChange({ autoStart: v })}
          />
          <Toggle
            label={t("Minimizar al cerrar")}
            hint={t("La ventana se va a la bandeja en lugar de cerrarse.")}
            checked={settings.minimizeToTray}
            onChange={(v) => onChange({ minimizeToTray: v })}
          />
          <Row label={t("Idioma")} hint={t("Idioma de la interfaz del cliente.")}>
            <Segmented
              value={settings.language}
              onChange={(v) => onChange({ language: v })}
              options={[
                { value: "es", label: t("Español") },
                { value: "en", label: t("English") },
              ]}
            />
          </Row>
        </Plate>
      </section>

      {/* ── Launcher ── */}
      <section>
        <SectionTitle>{t("Launcher")}</SectionTitle>
        <Plate className="divide-y divide-white/[0.05]">
          <Row label={t("Animaciones")} hint={t("Afecta al parallax del hero, a las transiciones y a las partículas.")}>
            <Segmented
              value={settings.animations}
              onChange={(v: MotionLevel) => onChange({ animations: v })}
              options={[
                { value: "full", label: tdIn("launcher", MOTION_LABEL.full) },
                { value: "reduced", label: tdIn("launcher", MOTION_LABEL.reduced) },
                { value: "off", label: tdIn("launcher", MOTION_LABEL.off) },
              ]}
            />
          </Row>
          <Toggle
            label={t("Aceleración gráfica")}
            hint={t("Desactívala si el cliente va a tirones: apaga desenfoques y capas pesadas.")}
            checked={settings.hardwareAcceleration}
            onChange={(v) => onChange({ hardwareAcceleration: v })}
          />
          <Toggle
            label={t("Notificaciones")}
            hint={t("Avisos de descarga terminada, novedades y actualizaciones.")}
            checked={settings.notifications}
            onChange={(v) => onChange({ notifications: v })}
          />
        </Plate>
      </section>

      {/* ── Descargas ── */}
      <section>
        <SectionTitle>{t("Descargas")}</SectionTitle>
        <Plate className="divide-y divide-white/[0.05]">
          <Row label={t("Ubicación predeterminada")} hint={t("Se propone al instalar un título nuevo.")}>
            <select
              value={settings.installPath}
              onChange={(e) => onChange({ installPath: e.target.value })}
              className="nx-clip-sm bg-black/50 px-3 py-2 font-mono text-[12px] text-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-drl/60"
            >
              {DISKS.map((d) => (
                <option key={d.id} value={d.path}>
                  {d.path} · {formatBytes(d.freeBytes)} {t("libres")}
                </option>
              ))}
            </select>
          </Row>
          <Slider
            label={t("Límite de velocidad")}
            value={settings.speedLimitMbps}
            min={0}
            max={100}
            step={5}
            onChange={(v) => onChange({ speedLimitMbps: v })}
            format={(v) => (v === 0 ? t("Sin límite") : `${v} MB/s`)}
          />
          <Toggle
            label={t("Descargas en segundo plano")}
            hint={t("Siguen bajando aunque el cliente esté minimizado.")}
            checked={settings.backgroundDownloads}
            onChange={(v) => onChange({ backgroundDownloads: v })}
          />
          <Row label={t("Descargas simultáneas")} hint={t("Las que excedan el cupo esperan en cola.")}>
            <Segmented
              value={String(settings.concurrentDownloads)}
              onChange={(v) => onChange({ concurrentDownloads: Number(v) })}
              options={[
                { value: "1", label: "1" },
                { value: "2", label: "2" },
                { value: "3", label: "3" },
              ]}
            />
          </Row>
        </Plate>
      </section>

      {/* ── Interfaz ── */}
      <section>
        <SectionTitle>{t("Interfaz")}</SectionTitle>
        <Plate className="divide-y divide-white/[0.05]">
          <Row label={t("Tema")} hint={t("Color del lienzo del cliente.")}>
            <Segmented
              value={settings.theme}
              onChange={(v: ThemeId) => onChange({ theme: v })}
              options={[
                { value: "midnight", label: THEME_LABEL.midnight },
                { value: "carbon", label: THEME_LABEL.carbon },
                { value: "abyss", label: THEME_LABEL.abyss },
              ]}
            />
          </Row>
          <Slider
            label={t("Intensidad de efectos")}
            value={settings.effectIntensity}
            min={0}
            max={100}
            step={5}
            onChange={(v) => onChange({ effectIntensity: v })}
            format={(v) => `${v} %`}
          />
        </Plate>
      </section>

      {/* ── Cliente (actualizador real) ── */}
      <section>
        <SectionTitle>{t("Cliente")}</SectionTitle>
        <Plate className="divide-y divide-white/[0.05]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <div>
              <p className="text-[13px] font-semibold text-white/85">{t("Versión instalada")}</p>
              <p className="mt-0.5 text-caption text-white/40">
                {t("Canal")} {td(channelInfo(up.channel).label)} · {up.state.phase === "error" ? t("última comprobación fallida") : t("al día")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="nx-readout text-[16px] text-white">v{td(version)}</span>
              {updateAvailable ? (
                <Badge dot tone="warn">{t("Actualización disponible")}</Badge>
              ) : (
                <Badge dot tone="ok">{t("Actualizado")}</Badge>
              )}
            </div>
          </div>

          <Row label={t("Canal de actualización")} hint={t("Estable recibe menos cambios; las ramas de prueba, antes.")}>
            <Segmented
              value={up.channel}
              onChange={(c) => void up.changeChannel(c as Channel)}
              options={CHANNELS.map((c) => ({ value: c.id, label: c.label }))}
            />
          </Row>

          <Toggle
            label={t("Buscar actualizaciones al iniciar")}
            checked={up.prefs.checkOnStart}
            onChange={(v) => void up.setPrefs({ checkOnStart: v })}
          />
          <Toggle
            label={t("Descargar automáticamente")}
            checked={up.prefs.autoDownload}
            onChange={(v) => void up.setPrefs({ autoDownload: v })}
          />
          <Toggle
            label={t("Instalar y reiniciar automáticamente")}
            hint={t("Aplica la actualización sin preguntar cuando termina la descarga.")}
            checked={up.prefs.autoInstall}
            onChange={(v) => void up.setPrefs({ autoInstall: v, autoRestart: v })}
          />

          <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
            <NxButton size="md" variant={updateAvailable ? "primary" : "secondary"} accent={updateAvailable ? "gold" : "primary"} onClick={() => void up.check()} disabled={up.busy}>
              {t("Buscar actualizaciones")}
            </NxButton>
            <NxButton size="md" variant="secondary" onClick={() => void up.verify()} disabled={up.busy}>
              {t("Verificar archivos")}
            </NxButton>
            <NxButton size="md" variant="secondary" onClick={() => void up.repair()} disabled={up.busy}>
              {t("Reparar")}
            </NxButton>
            {updateAvailable && (
              <NxButton size="md" variant="primary" onClick={() => void up.start()} disabled={up.busy}>
                {t("Actualizar cliente")}
              </NxButton>
            )}
          </div>

          {up.verifyReport && (
            <p className={cn("px-4 py-3 text-[12px]", up.verifyReport.ok ? "text-ok" : "text-bad")}>
              {up.verifyReport.checked === 0
                ? t("Verificación no disponible aquí (solo en el cliente de escritorio con manifiesto).")
                : up.verifyReport.ok
                  ? t("✓ {checked} archivos verificados — todo correcto.", { checked: up.verifyReport.checked })
                  : t("✗ {length} faltan y {length2} están corruptos. Pulsa Reparar.", { length: up.verifyReport.missing.length, length2: up.verifyReport.corrupt.length })}
            </p>
          )}
        </Plate>
      </section>

      {/* ── Zona de restablecimiento ── */}
      <section>
        <SectionTitle>{t("Restablecer")}</SectionTitle>
        <Plate className="flex flex-wrap items-center gap-3 p-4">
          <p className="min-w-[220px] flex-1 text-[12px] text-white/45">
            {t("Devuelve los ajustes o la biblioteca a su estado inicial. No afecta al cliente instalado.")}
          </p>
          <NxButton size="md" variant="secondary" onClick={onReset}>
            {t("Ajustes por defecto")}
          </NxButton>
          <NxButton size="md" variant="danger" onClick={onResetLibrary}>
            {t("Vaciar biblioteca")}
          </NxButton>
        </Plate>
      </section>
    </motion.div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  useLocale();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-white/85">{td(label)}</p>
        {hint && <p className="mt-0.5 text-caption text-white/40">{td(hint)}</p>}
      </div>
      {children}
    </div>
  );
}
