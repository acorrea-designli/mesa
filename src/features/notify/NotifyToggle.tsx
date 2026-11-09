"use client";
import { toggleNotify, useNotifyState } from "./prefs";

const BLOCKED_HINT = "Permite las notificaciones de Mesa en la configuración del sitio de tu navegador.";

/** Rail control (desktop): opt in to browser notifications. Hidden when the browser has no Notification API. */
export function NotifyToggle({ className }: { className?: string }) {
  const state = useNotifyState();
  if (state === "unsupported") return null;
  if (state === "denied") {
    return (
      <button type="button" className={className} aria-disabled="true" title={BLOCKED_HINT}>
        Avisos bloqueados
      </button>
    );
  }
  const on = state === "on";
  return (
    <button
      type="button"
      className={className}
      aria-pressed={on}
      title={on ? "Clic para apagar los avisos en este navegador" : undefined}
      onClick={() => void toggleNotify(state)}
    >
      {on ? "Avisos activos" : "Activar avisos"}
    </button>
  );
}
