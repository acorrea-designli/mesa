// Who may say "decided by Andrés". Only the UI routes approve / read-config / deny decide as him
// (src/app/api/approvals/[id]/...); the raw /decision route is for the hook's own actor and refuses
// any actor that names him, however it is spelled.

/** True when an actor string names Andrés (case, accents and an email or a handle around it do not matter). */
export function claimsAndres(actor: string): boolean {
  const a = actor
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
  return /andres|acorrea|correa/.test(a);
}
