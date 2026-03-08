import { Context, Next } from "hono";
import { Env } from "./types";

/** Constant-time string comparison */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const env = c.env;
  const basicEnabled = !!env.VIEW_USERNAME && !!env.VIEW_PASSWORD;
  const apiKeyEnabled = !!env.BACKEND_API_KEY;

  // No auth configured → public
  if (!basicEnabled && !apiKeyEnabled) {
    return next();
  }

  // Check API key
  const apiKey = c.req.header("X-API-Key");
  if (apiKeyEnabled && apiKey && timingSafeEqual(apiKey, env.BACKEND_API_KEY)) {
    return next();
  }

  // Check Basic Auth
  const authHeader = c.req.header("Authorization");
  if (basicEnabled && authHeader?.startsWith("Basic ")) {
    const decoded = atob(authHeader.slice(6));
    const colonIdx = decoded.indexOf(":");
    if (colonIdx > 0) {
      const username = decoded.slice(0, colonIdx);
      const password = decoded.slice(colonIdx + 1);
      if (timingSafeEqual(username, env.VIEW_USERNAME) && timingSafeEqual(password, env.VIEW_PASSWORD)) {
        return next();
      }
    }
  }

  return c.json({ detail: "Authentication required" }, 401);
}
