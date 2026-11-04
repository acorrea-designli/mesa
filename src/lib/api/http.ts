import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { NotFoundError, TransitionError } from "../db/util";
import { publishRequest } from "../live/bus";
import { repos, type Repos } from "../repo";

export type Ctx<P extends Record<string, string> = Record<string, string>> = { params: Promise<P> };

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function error(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/**
 * Wrap a route handler: gives it the repositories, runs the time-driven sweep
 * first (so state is fresh on every request), and maps domain errors to HTTP.
 */
export function route<P extends Record<string, string>>(
  fn: (req: Request, r: Repos, params: P) => Promise<Response> | Response,
) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      const r = repos();
      r.sweep();
      const res = await fn(req, r, (await ctx.params) ?? ({} as P));
      publishRequest(req, res.status); // live updates for /api/stream
      return res;
    } catch (err) {
      if (err instanceof ZodError) return error(400, "invalid_request", "invalid request body", err.issues);
      // Match by name too: each route bundle has its own copy of these classes, and the shared
      // repos singleton may have been created by another bundle, so instanceof can miss.
      if (err instanceof NotFoundError || (err as Error)?.name === "NotFoundError") return error(404, "not_found", (err as Error).message);
      if (err instanceof TransitionError || (err as Error)?.name === "TransitionError") return error(409, "invalid_transition", (err as Error).message);
      if (err instanceof SyntaxError) return error(400, "invalid_json", err.message);
      console.error(err);
      return error(500, "internal", err instanceof Error ? err.message : "internal error");
    }
  };
}

export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const text = await req.text();
  return schema.parse(text ? JSON.parse(text) : {});
}

export function query(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}
