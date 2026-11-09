// What leaves the PC for a push service (Google, Mozilla, Apple) is minimal: a title made of the kind of thing and
// its ref, where a tap goes, and a tag that dedupes on the device. No ticket or salida titles, no message text, no
// repo names. The service worker adds a fixed Spanish body line.
export interface PushPayload {
  title: string;
  /** Same-origin path a tap opens. */
  url: string;
  /** Replaces an earlier notification with the same tag on the device. */
  tag: string;
}

export const ticketTitle = (ref: string, review: boolean) => `${review ? "Review lista" : "Te espera"} · ${ref}`;
export const salidaTitle = (ticketRef: string | null) => `Por firmar · ${ticketRef ?? "salida"}`;
export const approvalTitle = (agent: string) => `Permiso pendiente · ${agent}`;

/** The test push of "Probar aviso". */
export const TEST_PAYLOAD: PushPayload = { title: "Aviso de prueba · Mesa", url: "/telefono", tag: "mesa-test" };

export const encodePayload = (p: PushPayload): string => JSON.stringify({ title: p.title, url: p.url, tag: p.tag });
