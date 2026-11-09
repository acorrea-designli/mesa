"use client";
// "Hay una versión nueva · Recargar": quiet, never reloads by itself (a reply being typed must survive).
import { Btn } from "@/components/ui/primitives";
import { postponeNewVersion, reloadForNewVersion, useVersion } from "./useVersion";

export function VersionBanner() {
  const { showBanner } = useVersion();
  if (!showBanner) return null;
  return (
    <div className="ver" role="status">
      <span className="ver-copy">Hay una versión nueva</span>
      <Btn size="sm" variant="primary" onClick={() => void reloadForNewVersion()}>
        Recargar
      </Btn>
      <Btn size="sm" onClick={postponeNewVersion}>
        Luego
      </Btn>
    </div>
  );
}
