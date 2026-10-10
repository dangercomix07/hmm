/** Loaded by npm test in every test worker. Only loopback TCP is permitted (OAuth callback tests).
 * Mock transports still work; accidental real Gmail/Jev/other outbound connections fail immediately. */
import { Socket } from "node:net";
const original = Socket.prototype.connect;
Object.defineProperty(Socket.prototype, "connect", { configurable: true, writable: true, value: function(this: Socket, ...args: unknown[]) {
  // Node's internal normalized overload is [options, callback].
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = first && typeof first === "object" ? first as { host?: string; path?: string } : undefined;
  const host = options?.host ?? (typeof args[1] === "string" ? args[1] : "localhost");
  if (options?.path || typeof first === "string" || !["127.0.0.1", "::1", "localhost"].includes(host)) throw new Error("Offline test guard refused outbound connection");
  return Reflect.apply(original, this, args);
} });
