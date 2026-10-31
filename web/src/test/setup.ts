import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Serve /data/* from web/public so pages load the real exported bundles. (Under
// jsdom import.meta.url isn't a file: URL, so resolve from the vitest root.)
const PUBLIC = resolve(process.cwd(), "public") + "/";

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/^\/+/, "");
  try {
    return new Response(readFileSync(PUBLIC + path, "utf8"), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}) as typeof fetch;

window.scrollTo = (() => {}) as typeof window.scrollTo;

afterEach(() => cleanup());
