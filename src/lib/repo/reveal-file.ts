// "Abrir carpeta" (t87): show a file in the machine's file manager with the file selected. Server only, launched by
// the local-only route /api/salidas/:id/files/:index/folder with a path that route already validated.
import { spawn } from "node:child_process";
import path from "node:path";

export interface RevealCommand {
  cmd: string;
  args: string[];
  /** Windows: the command line is passed as written (Explorer's `/select,"path"` does not survive Node's own quoting). */
  verbatim: boolean;
}

/** The command that shows `file` selected in its folder; pure, so it is tested for every platform. */
export function revealCommand(platform: NodeJS.Platform, file: string): RevealCommand {
  if (platform === "win32") {
    // A Windows file name cannot hold a double quote, so a quote here means a crafted path: never build a command from it.
    if (file.includes('"')) throw new Error("refusing a path with a double quote");
    return { cmd: "explorer.exe", args: [`/select,"${path.win32.normalize(file)}"`], verbatim: true };
  }
  if (platform === "darwin") return { cmd: "open", args: ["-R", file], verbatim: false };
  return { cmd: "xdg-open", args: [path.dirname(file)], verbatim: false };
}

/** Launches the file manager and returns without waiting (Explorer exits 1 even when it worked). */
export function revealFile(file: string, platform: NodeJS.Platform = process.platform): void {
  const c = revealCommand(platform, file);
  const child = spawn(c.cmd, c.args, { detached: true, stdio: "ignore", windowsHide: false, windowsVerbatimArguments: c.verbatim });
  child.on("error", () => {});
  child.unref();
}
