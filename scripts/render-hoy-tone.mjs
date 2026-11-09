// Renders the Hoy sound (src/features/notify/hoyTone.ts, the same parameters the tab plays with WebAudio) to
// public/sounds/mesa-hoy.wav, so the phone can use it as the sound of Mesa's notifications. Deterministic: running
// it again writes the same bytes. Run `pnpm tone:render` after changing hoyTone.ts (a test fails when the file is stale).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeWav, HOY_SAMPLE_RATE, renderHoy } from "../src/features/notify/hoyTone.ts";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../public/sounds/mesa-hoy.wav");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodeWav(renderHoy(HOY_SAMPLE_RATE), HOY_SAMPLE_RATE));
console.log(`wrote ${out}`);
