"use client";
// /telefono. On the PC (local request): link a phone with a QR that carries a one-time code, and install Mesa.
// Through the tunnel (token already set): the phone's own status and the install entry. The token itself is never
// shown, copied or put in a URL: the QR holds a link with a code that works once for 10 minutes (src/app/pair).
import { useEffect, useState } from "react";
import { LineStub } from "@/components/line/Line";
import { Btn } from "@/components/ui/primitives";
import { ShareGlyph } from "./InstallPrompt";
import { timeLeft } from "./pairing";
import { QrCode } from "./QrCode";
import { promptInstall, useInstall } from "./useInstall";

type Pairing = { url: string; code: string; expiresAt: string };

function InstallEntry() {
  const { ready, standalone, hasPrompt, platform } = useInstall();
  if (!ready) return null;
  if (standalone) return <p className="tel-note">Mesa ya está instalada en este dispositivo.</p>;
  if (hasPrompt) {
    return (
      <Btn size="sm" onClick={() => void promptInstall()}>
        Instalar
      </Btn>
    );
  }
  if (platform === "ios") {
    return (
      <p className="tel-note">
        Toca <ShareGlyph /> <b>Compartir</b> y luego <b>Agregar a inicio</b>.
      </p>
    );
  }
  return <p className="tel-note">Este navegador no ofrece instalar. En Chrome del Android o en Safari del iPhone sí aparece.</p>;
}

function Pair({ publicUrl }: { publicUrl: string | null }) {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!pairing) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [pairing]);

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pairing", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        setPairing(null);
        setError(body?.error?.code === "no_public_url" ? "Falta MESA_PUBLIC_URL en la PC." : "No pude generar el código. Intenta otra vez.");
        return;
      }
      setPairing((await res.json()) as Pairing);
      setNow(Date.now());
    } catch {
      setError("No pude generar el código. Intenta otra vez.");
    } finally {
      setBusy(false);
    }
  }

  const left = pairing ? timeLeft(pairing.expiresAt, now) : null;
  const expired = pairing !== null && left === null;

  return (
    <section className="tel-card" aria-labelledby="tel-pair">
      <h2 id="tel-pair">Primero vincula, luego instala</h2>
      <div className="tel-status">
        <LineStub source="ink" width={22} dotted={!publicUrl} />
        {publicUrl ? (
          <span>
            Túnel en <code>{publicUrl.replace("https://", "")}</code>
          </span>
        ) : (
          <span>Mesa no tiene dirección pública todavía.</span>
        )}
      </div>

      {!publicUrl ? (
        <ol className="tel-steps">
          <li>
            Pon la dirección del túnel en <code>MESA_PUBLIC_URL</code> (por ejemplo <code>https://mesa.tudominio.com</code>) y reinicia Mesa.
          </li>
          <li>
            Publica Mesa con <code>pnpm tunnel up</code>: el túnel de Cloudflare solo abre con tu login de Access.
          </li>
          <li>Vuelve aquí y genera el código.</li>
        </ol>
      ) : (
        <>
          {pairing && !expired ? (
            <div className="tel-qr-wrap">
              <QrCode text={pairing.url} label="Código QR para vincular el teléfono" />
              <div className="tel-qr-copy">
                <p>Escanéalo con la cámara del teléfono. Abre Mesa por el túnel y deja la sesión iniciada por 30 días.</p>
                <div className="tel-code">
                  <span className="tel-note">¿Ya instalaste la app? Escribe este código en ella:</span>
                  <b aria-label={`Código ${pairing.code.split("").join(" ")}`}>{pairing.code}</b>
                </div>
                <p className="tel-note">
                  Un solo uso · vence en <b>{left}</b>
                </p>
              </div>
            </div>
          ) : null}
          {expired ? <p className="tel-note">El código venció. Genera otro.</p> : null}
          <div className="tel-actions">
            <Btn variant="primary" disabled={busy} onClick={() => void mint()}>
              {pairing && !expired ? "Generar otro código" : "Generar código QR"}
            </Btn>
          </div>
          <p className="tel-note">
            Primero entras con tu correo en Cloudflare Access y luego vinculas con el QR o el código. El token de Mesa nunca aparece en pantalla ni en un enlace.
          </p>
        </>
      )}
      {error ? (
        <p className="tel-err" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function PhoneScreen({ local, publicUrl }: { local: boolean; publicUrl: string | null }) {
  return (
    <>
      <header className="screen-head">
        <h1>Teléfono</h1>
        <span>{local ? "Vincula tu teléfono y abre Mesa desde el túnel" : "Este teléfono está vinculado"}</span>
      </header>
      <div className="screen-body tel">
        {local ? (
          <Pair publicUrl={publicUrl} />
        ) : (
          <section className="tel-card">
            <h2>Vinculado</h2>
            <p>Estás usando Mesa por el túnel. Para vincular otro teléfono, genera un código en la pantalla Teléfono de tu PC.</p>
          </section>
        )}
        <section className="tel-card tel-install" aria-labelledby="tel-install">
          <h2 id="tel-install">Instalar</h2>
          <p>Primero vincula este teléfono, luego instala: Mesa se abre desde la pantalla de inicio, sin la barra del navegador. Si ya la instalaste, escribe el código corto dentro de la app.</p>
          <InstallEntry />
        </section>
      </div>
    </>
  );
}
