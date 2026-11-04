// Sandbox rules for the send side of a salida. Pure: the caller passes the environment.
//
// In sandbox nothing leaves the board, so the lead reports a send as simulated
// (`mesa salida sent <id> --simulated`) and Mesa records a fake permalink
// `sandbox://<source>/<id>`. In live a simulated send is refused, so a real send always
// carries the real permalink. A salida copied from live that was really sent can be neither
// deleted nor restored from the sandbox: that would ask the lead to touch the real source.

import type { SalidaEvent } from "./salida-machine";
import type { Salida } from "./types";

export const SIMULATED_SCHEME = "sandbox://";

export const simulatedPermalink = (s: Pick<Salida, "id" | "source">) => `${SIMULATED_SCHEME}${s.source}/${s.id}`;

/** A send recorded in sandbox: the message never left Mesa ("Simulado · no salió"). */
export const isSimulated = (s: { permalink: string | null }) => Boolean(s.permalink?.startsWith(SIMULATED_SCHEME));

/** A salida event as the API takes it: `sent` may carry `simulated`. */
export type SalidaEventInput = SalidaEvent | { type: "sent"; permalink?: string; simulated?: boolean };

/** `code` is the API error code: `sandbox` (refused in sandbox) or `not_sandbox` (refused in live). */
export type SendGate = { ok: true; event: SalidaEvent } | { ok: false; code: "sandbox" | "not_sandbox"; error: string };

const SOURCE_SIDE = new Set<SalidaEvent["type"]>(["request_delete", "deleted", "request_restore", "restored"]);

export function gateSalidaEvent(sandbox: boolean, s: Pick<Salida, "id" | "source" | "permalink">, ev: SalidaEventInput): SendGate {
  if (ev.type === "sent") {
    const simulated = "simulated" in ev && ev.simulated === true;
    if (sandbox && !simulated) {
      return { ok: false, code: "sandbox", error: "sandbox: nothing leaves this board; report the send as simulated (`mesa salida sent <id> --simulated`)" };
    }
    if (!sandbox && simulated) {
      return { ok: false, code: "not_sandbox", error: "simulated sends exist only in the sandbox (MESA_ENV=sandbox); report the real permalink" };
    }
    return { ok: true, event: sandbox ? { type: "sent", permalink: simulatedPermalink(s) } : { type: "sent", permalink: ev.permalink } };
  }
  if (sandbox && SOURCE_SIDE.has(ev.type) && !isSimulated(s)) {
    return { ok: false, code: "sandbox", error: "sandbox: this salida was really sent from the live board; delete or restore it there, not from the sandbox" };
  }
  return { ok: true, event: ev as SalidaEvent };
}
