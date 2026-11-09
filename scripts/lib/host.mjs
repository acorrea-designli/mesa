/** The address the board binds to: loopback unless MESA_HOST says otherwise. */
export const DEFAULT_HOST = "127.0.0.1";

export function pickHost(env) {
  return env.MESA_HOST?.trim() || DEFAULT_HOST;
}

/** True when the host keeps the port off the network. */
export function isLoopbackBind(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}
