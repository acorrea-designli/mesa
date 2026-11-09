"use client";
// The phone's switch for Web Push: a card on /telefono ("Avisos en este teléfono") and a row in the "Ajustes" sheet.
// States come from state.ts: on, off, blocked (with the browser's unblock steps), unsupported (iOS: install first),
// no keys on the PC. "Probar aviso" pushes a test to this device only.
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { Btn } from "@/components/ui/primitives";
import { browserLabel, detectBrowser, type Browser } from "@/features/phone/install";
import { pushCopy, TEST_COPY, type PushState } from "./state";
import { disablePush, enablePush, refreshPush, testPush, usePush } from "./usePush";

const noop = () => () => undefined;
const useBrowser = (): Browser => useSyncExternalStore(noop, () => detectBrowser(navigator.userAgent), () => "other");

export function PushCard() {
  const { snap, state } = usePush();
  const browser = useBrowser();
  // Opening the screen reads the facts again (the permission may have changed in the browser's settings).
  useEffect(() => void refreshPush(), []);
  const copy = pushCopy(state, browser);
  return (
    <section className="tel-card tel-push" aria-labelledby="tel-push">
      <h2 id="tel-push">Avisos en este teléfono</h2>
      <p>Mesa te avisa aunque la app esté cerrada cuando algo te espera, llega algo nuevo a Hoy, hay una salida por firmar o un permiso pendiente.</p>
      <p className="tel-push-state" role="status" data-state={state}>
        {copy.status}
      </p>
      {copy.hint ? <p className="tel-note">{copy.hint}</p> : null}
      {state === "blocked" ? (
        <p className="tel-note">
          Navegador detectado: <b>{browserLabel(browser)}</b>.
        </p>
      ) : null}
      {snap.message ? (
        <p className="tel-err" role="alert">
          {snap.message}
        </p>
      ) : null}
      {snap.testResult ? (
        <p className="tel-note" role="status">
          {TEST_COPY[snap.testResult]}
        </p>
      ) : null}
      <div className="tel-actions tel-push-actions">
        {copy.action === "enable" ? (
          <Btn variant="primary" disabled={snap.busy} onClick={() => void enablePush()}>
            Activar avisos
          </Btn>
        ) : null}
        {copy.action === "disable" ? (
          <>
            <Btn disabled={snap.busy} onClick={() => void testPush()}>
              Probar aviso
            </Btn>
            <Btn disabled={snap.busy} onClick={() => void disablePush()}>
              Apagar avisos
            </Btn>
          </>
        ) : null}
        {state === "blocked" ? (
          <Btn disabled={snap.busy} onClick={() => void refreshPush()}>
            Ya lo permití
          </Btn>
        ) : null}
      </div>
      {state === "on" ? <ToneSteps /> : null}
    </section>
  );
}

/** The Hoy tone as a file, and how to make Android ring with it (Web Push cannot choose a sound). */
function ToneSteps() {
  return (
    <div className="tel-tone">
      <p className="tel-note">Android suena con el tono que tú elijas para Mesa. El de Hoy es largo y propio:</p>
      <ol className="tel-steps">
        <li>
          <a className="btn" href="/sounds/mesa-hoy.wav" download="mesa-hoy.wav">
            Descargar tono
          </a>
        </li>
        <li>Ajustes de Android, Notificaciones, Mesa (o Opera), Sonido: elige <code>mesa-hoy</code>.</li>
        <li>Toca «Probar aviso» para oírlo.</li>
      </ol>
    </div>
  );
}

const ROW: Partial<Record<PushState, string>> = {
  on: "Avisos activos",
  off: "Activar avisos",
  blocked: "Avisos bloqueados · cómo permitirlos",
  ios_install: "Avisos · instala Mesa primero",
  unsupported: "Avisos no disponibles aquí",
  no_keys: "Avisos · faltan claves en la PC",
  no_worker: "Avisos · recarga la página",
  server_error: "Avisos · sin conexión con la PC",
};

/**
 * The "Ajustes" row (phone). It replaces the desktop browser-notification toggle there, which cannot work on a phone:
 * on and off toggle in place, every other state opens /telefono, where the steps are written out.
 */
export function PushRow({ className, onOpen }: { className?: string; onOpen: () => void }) {
  const { snap, state } = usePush();
  if (state === "loading") return null;
  const label = ROW[state] ?? "Avisos";
  if (state === "on" || state === "off") {
    return (
      <button
        type="button"
        className={className}
        aria-pressed={state === "on"}
        disabled={snap.busy}
        title={state === "on" ? "Toca para apagar los avisos en este teléfono" : undefined}
        onClick={() => void (state === "on" ? disablePush() : enablePush())}
      >
        {label}
      </button>
    );
  }
  return (
    <Link
      href="/telefono"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        onOpen();
      }}
    >
      {label}
    </Link>
  );
}
