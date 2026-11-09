"use client";
// "Instalar Mesa" banner. Android/Chrome: the native prompt behind a primary button. iOS Safari (no
// beforeinstallprompt): a two-step written guide. Hidden when installed (standalone) and for 14 days after a dismiss.
import { BrandMark } from "@/components/line/Line";
import { Btn } from "@/components/ui/primitives";
import { dismissInstall, promptInstall, useInstall } from "./useInstall";

export function ShareGlyph() {
  return (
    <svg width="16" height="18" viewBox="0 0 16 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: "-3px" }}>
      <path d="M8 11V2M4.8 4.8L8 1.6l3.2 3.2" />
      <path d="M4.5 7.5H3.2A1.2 1.2 0 0 0 2 8.7v6.1A1.2 1.2 0 0 0 3.2 16h9.6a1.2 1.2 0 0 0 1.2-1.2V8.7a1.2 1.2 0 0 0-1.2-1.2h-1.3" />
    </svg>
  );
}

export function InstallPrompt() {
  const { offer } = useInstall();
  if (!offer) return null;
  return (
    <aside className="ins" role="region" aria-label="Instalar Mesa">
      <div className="ins-head">
        <BrandMark size={34} />
        <div className="ins-copy">
          <b>Instalar Mesa</b>
          {offer === "prompt" ? (
            <p>Ábrela desde tu pantalla de inicio, a pantalla completa y sin la barra del navegador.</p>
          ) : (
            <p>
              Toca <ShareGlyph /> <b>Compartir</b> y luego <b>Agregar a inicio</b>.
            </p>
          )}
        </div>
      </div>
      <div className="ins-actions">
        {offer === "prompt" ? (
          <Btn variant="primary" size="phone" className="ins-go" onClick={() => void promptInstall()}>
            Instalar
          </Btn>
        ) : null}
        <Btn size="phone" className="ins-no" onClick={dismissInstall}>
          {offer === "prompt" ? "Ahora no" : "Entendido"}
        </Btn>
      </div>
    </aside>
  );
}
