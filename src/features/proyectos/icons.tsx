// Small icons of the Proyectos mock (.impeccable/mocks/screens/proyectos.html): checks, reviews and tags are told by
// icon and text, never by a status colour. currentColor only.
import type { Icon } from "./model";

const P = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function PjIcon({ name }: { name: Icon }) {
  switch (name) {
    case "check":
      return (
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" {...P} strokeWidth={1.8}>
          <path d="M2.5 7.5l3 3 6-7" />
        </svg>
      );
    case "stop":
      return (
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" {...P} strokeWidth={1.8}>
          <circle cx="7" cy="7" r="5.2" />
          <path d="M4.4 7h5.2" />
        </svg>
      );
    case "eye":
      return (
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" {...P} strokeWidth={1.6}>
          <path d="M1.5 7s2-4 5.5-4 5.5 4 5.5 4-2 4-5.5 4-5.5-4-5.5-4z" />
          <circle cx="7" cy="7" r="1.6" />
        </svg>
      );
    case "mine":
      return (
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" {...P} strokeWidth={1.6}>
          <circle cx="7" cy="5" r="2.4" />
          <path d="M2.5 12.5c.8-2.2 2.5-3.3 4.5-3.3s3.7 1.1 4.5 3.3" />
        </svg>
      );
    case "ckok":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" {...P} strokeWidth={1.6}>
          <path d="M2 6.5l2.5 2.5L10 3" />
        </svg>
      );
    case "ckbad":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" {...P} strokeWidth={1.7}>
          <path d="M3 3l6 6M9 3L3 9" />
        </svg>
      );
    case "ckrun":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" {...P} strokeWidth={1.6} strokeDasharray="1.5 2.2">
          <circle cx="6" cy="6" r="4.4" />
        </svg>
      );
    case "conf":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" {...P} strokeWidth={1.6}>
          <path d="M2 3h3l2 6h3M2 9h3l2-6h3" />
        </svg>
      );
    case "none":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" {...P} strokeWidth={1.6}>
          <path d="M3 6h6" />
        </svg>
      );
  }
}

export const ExtIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" {...P} strokeWidth={1.6}>
    <path d="M8 2h4v4M12 2L6.5 7.5M10 8.5V12H2V4h3.5" />
  </svg>
);

export const IssueIcon = () => (
  <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <circle cx="6" cy="6" r="4.6" />
    <circle cx="6" cy="6" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

/** Interchange ring: an issue with PRs in two repos. */
export const RingIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5" fill="var(--gnd)" stroke="var(--ink)" strokeWidth={2.6} />
  </svg>
);

export const DotIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="4.5" fill="var(--raise)" stroke="var(--ink)" strokeWidth={1.6} />
  </svg>
);

export const TrainIcon = () => (
  <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true" {...P} strokeWidth={1.6} className="pj-train-ic">
    <path d="M1 7h20M15 2l5 5-5 5" />
  </svg>
);

export const BackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" {...P} strokeWidth={1.8}>
    <path d="M10 3L5 8l5 5" />
  </svg>
);
