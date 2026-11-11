// What leaves the PC for a push service (Google, Mozilla, Apple) is minimal: a title made of the kind of thing and
// its ref, where a tap goes, and a tag that dedupes on the device. No ticket or salida titles, no message text, no
// repo names. The service worker adds a fixed Spanish body line.
//
// The ONE exception (t112, Andrés's decision 6C): a meeting reminder ("Reunión en 10 min · 15:00") carries the
// meeting's title as `body`, and its `url` may be a Google Meet link; every other push keeps the rule above.
export interface PushPayload {
  title: string;
  /** A same-origin path a tap opens (a meeting reminder may carry a https://meet.google.com/ link instead). */
  url: string;
  /** Meeting reminders only: the meeting's title. Absent for every other push (the worker shows its fixed line). */
  body?: string;
  /** Replaces an earlier notification with the same tag on the device. */
  tag: string;
}

export const ticketTitle = (ref: string, review: boolean) => `${review ? "Review lista" : "Te espera"} · ${ref}`;
export const salidaTitle = (ticketRef: string | null) => `Por firmar · ${ticketRef ?? "salida"}`;
export const approvalTitle = (agent: string) => `Permiso pendiente · ${agent}`;

/** The test push of "Probar aviso". */
export const TEST_PAYLOAD: PushPayload = { title: "Aviso de prueba · Mesa", url: "/telefono", tag: "mesa-test" };

export const encodePayload = (p: PushPayload): string => JSON.stringify(p.body ? { title: p.title, url: p.url, tag: p.tag, body: p.body } : { title: p.title, url: p.url, tag: p.tag });
