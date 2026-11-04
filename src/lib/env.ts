// The one place that reads MESA_ENV. "live" (the default) is Andrés's real board; "sandbox" is a dummy
// copy where the server never writes outward: no GitHub worker or Project sync, no sweeper wake, and
// salida sends are simulated (`mesa salida sent --simulated`). docs/SANDBOX.md.

export type MesaEnv = "live" | "sandbox";

export function mesaEnv(env: NodeJS.ProcessEnv = process.env): MesaEnv {
  return env.MESA_ENV?.trim().toLowerCase() === "sandbox" ? "sandbox" : "live";
}

export function isSandbox(env: NodeJS.ProcessEnv = process.env): boolean {
  return mesaEnv(env) === "sandbox";
}

/** The refusal every outward-facing server path returns in sandbox (HTTP 409, code `sandbox`). */
export const SANDBOX_REFUSAL = "sandbox: nothing leaves this board (MESA_ENV=sandbox)";
