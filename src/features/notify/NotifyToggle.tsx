"use client";
import { testHoy } from "./chime";
import { toggleNotify, toggleSound, useNotifyState, useSoundBlocked, useSoundOn } from "./prefs";

const BLOCKED_SOUND_HINT = "Haz clic una vez en Mesa o permite la reproducción automática para este sitio";
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

/** "Probar sonido": plays the Hoy sound. The click is a user gesture, so it also unlocks audio for later notices. */
function TestSound({ className }: { className?: string }) {
  return (
    <button type="button" className={className} title="Suena el sonido de lo que llega a Hoy" onClick={() => void testHoy()}>
      Probar sonido
    </button>
  );
}

/** Rail control (desktop): the sound that goes with a notification, and "Probar sonido". Only while the avisos are on; default on. */
export function SoundToggle({ className }: { className?: string }) {
  const state = useNotifyState();
  const on = useSoundOn();
  const blocked = useSoundBlocked();
  if (state !== "on") return null;
  if (on && blocked) {
    return (
      <>
        <button type="button" className={className} aria-pressed title={BLOCKED_SOUND_HINT} onClick={toggleSound}>
          Sonido bloqueado
        </button>
        <TestSound className={className} />
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        className={className}
        aria-pressed={on}
        title={on ? "Clic para silenciar el sonido de los avisos" : "Clic para que los avisos suenen"}
        onClick={toggleSound}
      >
        {on ? "Sonido activo" : "Sonido apagado"}
      </button>
      <TestSound className={className} />
    </>
  );
}
