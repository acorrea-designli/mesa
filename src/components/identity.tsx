"use client";
// The board owner's identity for client components. The root layout reads it on the server (src/lib/config/identity.ts)
// and hands it down; a tree rendered without the provider (tests) gets the original owner's values.
import { createContext, useContext, type ReactNode } from "react";
import { CANONICAL } from "@/lib/config/identity";

export interface ClientIdentity {
  ghUser: string;
  sessionsDir: string;
  ownerName: string;
}

const Ctx = createContext<ClientIdentity>({ ghUser: CANONICAL.ghUser, sessionsDir: CANONICAL.sessionsDir, ownerName: CANONICAL.ownerName });

export function IdentityProvider({ value, children }: { value: ClientIdentity; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useIdentity = (): ClientIdentity => useContext(Ctx);
