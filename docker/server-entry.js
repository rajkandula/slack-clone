/**
 * Entrypoint wrapper around Next's standalone server.
 *
 * A container platform stops a container by sending SIGTERM and waiting (up to
 * 15 minutes on some) before SIGKILL. Next's own shutdown handler closes the listener but then waits
 * for in-flight requests to finish — and WASP's SSE streams ARE in-flight
 * requests that never finish on their own. Without this, every rollout would
 * hang for the full 15 minutes.
 *
 * Exiting early is safe: the browser reconnects automatically after 3s
 * (see the `es.onerror` handler in src/hooks/useChatSync.ts).
 */
const GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS || 5000);
let shuttingDown = false;

function onTerm(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[wasp] ${signal} received; forcing exit in ${GRACE_MS}ms`);
  // unref() so this timer alone never keeps the process alive — the open SSE
  // responses do that, and they are exactly what we are cutting short.
  setTimeout(() => process.exit(0), GRACE_MS).unref();
}

process.on("SIGTERM", () => onTerm("SIGTERM"));
process.on("SIGINT", () => onTerm("SIGINT"));

require("./server.js");
