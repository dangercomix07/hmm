import { mkdir, open, readFile, readdir, link, unlink, lstat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ActionIdentity, ActionLedger, ActionRecord, ActionState, ReconciliationResult } from "../../ports/action-ledger.js";
import { actionIdFor, digest } from "../approval/action-identity.js";
const hex = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const transitions: Record<ActionState, ActionState[]> = {
  RESERVED: ["DISPATCHING", "FAILED_SAFE", "UNCERTAIN"], DISPATCHING: ["SENT", "UNCERTAIN"],
  SENT: [], UNCERTAIN: [], CONFIRMED: [], FAILED_SAFE: [],
};
function identity(a: ActionIdentity): void {
  if (!hex(a.actionId) || !hex(a.sourceKey) || !hex(a.planDigest) || actionIdFor(a.sourceKey) !== a.actionId) throw new Error("ActionId mismatch or invalid identity");
}
async function syncDirectory(path: string): Promise<void> {
  // Windows does not expose portable directory fsync. See documented power-loss limitation.
  if (process.platform === "win32") return;
  const fd = await open(path, "r"); try { await fd.sync(); } finally { await fd.close(); }
}
async function publish(path: string, name: string, value: unknown): Promise<void> {
  const temporary = join(path, `.tmp-${randomUUID()}`);
  const fd = await open(temporary, "wx", 0o600);
  try { await fd.writeFile(JSON.stringify(value)); await fd.sync(); } finally { await fd.close(); }
  try { await link(temporary, join(path, name)); await syncDirectory(path); }
  finally { await unlink(temporary).catch(() => {}); }
}
/** Append-only, atomic no-overwrite journal. Requires a local filesystem with atomic mkdir/link.
 * Leftover reservations and partial writes fail closed; no age-based unlocking or retry. */
export class LocalActionLedger implements ActionLedger {
  constructor(private readonly directory = ".hmm/actions") {}
  private async root(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(this.directory)).isDirectory()) throw new Error("Invalid ledger directory");
  }
  async executionStatus(actionId: string, sourceKey: string): Promise<ActionState | "LEGACY_OR_INCOMPLETE" | undefined> {
    if (!hex(sourceKey) || actionIdFor(sourceKey) !== actionId) throw new Error("ActionId mismatch");
    const current = await this.get(actionId);
    if (current) return current.state;
    // Any legacy/partial sentinel blocks. Do not interpret, migrate or reset it.
    try { await lstat(join(this.directory, `${sourceKey}.json`)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("Unreadable execution reservation; no send.");
    }
    return "LEGACY_OR_INCOMPLETE";
  }
  async reserve(action: ActionIdentity): Promise<ActionRecord> {
    action = { actionId: action.actionId, sourceKey: action.sourceKey, planDigest: action.planDigest };
    identity(action); await this.root();
    // Exclusive legacy sentinel interlocks with 4B, including old ATTEMPTING/SENT records.
    // Never overwrite, import as safe, or silently discard an existing record.
    const file = await open(join(this.directory, `${action.sourceKey}.json`), "wx", 0o600).catch(() => { throw new Error("Execution record exists or cannot be reserved; reconcile manually. No send."); });
    try { await file.writeFile(JSON.stringify({ version: 2, actionId: action.actionId, status: "LEDGER_RESERVED" })); await file.sync(); }
    finally { await file.close(); }
    await syncDirectory(this.directory);
    const path = join(this.directory, action.actionId);
    await mkdir(path, { mode: 0o700 }); await syncDirectory(this.directory);
    const record: ActionRecord = { actionId: action.actionId, sourceKey: action.sourceKey, planDigest: action.planDigest, state: "RESERVED", revision: 0, updatedAt: new Date().toISOString() };
    await publish(path, "0.json", { record, checksum: digest(record) }); return record;
  }
  async get(actionId: string): Promise<ActionRecord | undefined> {
    if (!hex(actionId)) throw new Error("Invalid ActionId");
    const path = join(this.directory, actionId);
    let names: string[];
    try { names = await readdir(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("Unreadable ledger");
    }
    if (!(await lstat(path)).isDirectory()) throw new Error("Invalid ledger directory");
    const files = names.filter(n => !n.startsWith(".tmp-"));
    if (!files.length || files.some(n => !/^\d+\.json$/.test(n))) throw new Error("Corrupted ledger journal");
    files.sort((a, b) => parseInt(a) - parseInt(b));
    let previous: ActionRecord | undefined;
    for (let i = 0; i < files.length; i++) {
      if (files[i] !== `${i}.json`) throw new Error("Corrupted ledger sequence");
      const file = join(path, files[i]!);
      if (!(await lstat(file)).isFile()) throw new Error("Invalid ledger file");
      const envelope = JSON.parse(await readFile(file, "utf8")) as { record: ActionRecord; checksum: string };
      const r = envelope.record;
      identity(r);
      if (envelope.checksum !== digest(r) || r.actionId !== actionId || r.revision !== i || !Number.isFinite(Date.parse(r.updatedAt)) || !Object.hasOwn(transitions, r.state)) throw new Error("Corrupted ledger record");
      if (!previous && r.state !== "RESERVED") throw new Error("Invalid initial ledger state");
      if (previous) {
        if (r.sourceKey !== previous.sourceKey || r.planDigest !== previous.planDigest) throw new Error("Ledger identity changed");
        const reconciled = ["SENT", "UNCERTAIN"].includes(previous.state) && ["CONFIRMED", "FAILED_SAFE"].includes(r.state) && hex(r.evidenceDigest) && !(previous.state === "SENT" && r.state === "FAILED_SAFE");
        if (!transitions[previous.state].includes(r.state) && !reconciled) throw new Error("Illegal ledger transition");
      }
      if (r.state === "SENT" && (!r.receipt || !/^[A-Za-z0-9_-]+$/.test(r.receipt.messageId) || !/^[A-Za-z0-9_-]+$/.test(r.receipt.threadId))) throw new Error("Invalid send receipt");
      previous = r;
    }
    const sentinel = JSON.parse(await readFile(join(this.directory, `${previous!.sourceKey}.json`), "utf8"));
    if (sentinel.version !== 2 || sentinel.actionId !== actionId || sentinel.status !== "LEDGER_RESERVED") throw new Error("Missing or corrupted ledger reservation");
    return previous;
  }
  private async append(record: ActionRecord, state: ActionState, extra: Partial<ActionRecord> = {}): Promise<ActionRecord> {
    const current = await this.get(record.actionId);
    if (!current || digest(current) !== digest(record)) throw new Error("Stale or mismatched ledger state");
    const next = { ...current, ...extra, state, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    // Only one competing transition can publish this revision. No overwrite/rename race.
    await publish(join(this.directory, record.actionId), `${next.revision}.json`, { record: next, checksum: digest(next) });
    return next;
  }
  async transition(record: ActionRecord, state: ActionState, receipt?: ActionRecord["receipt"]): Promise<ActionRecord> {
    if (!transitions[record.state]?.includes(state)) throw new Error("Illegal ledger transition");
    if (state === "SENT" && (!receipt || !/^[A-Za-z0-9_-]+$/.test(receipt.messageId) || !/^[A-Za-z0-9_-]+$/.test(receipt.threadId))) throw new Error("Invalid send receipt");
    return this.append(record, state, state === "SENT" ? { receipt: { messageId: receipt!.messageId, threadId: receipt!.threadId } } : {});
  }
  async reconcile(record: ActionRecord, evidence: ReconciliationResult): Promise<ActionRecord> {
    if (!["SENT", "UNCERTAIN"].includes(record.state)) throw new Error("State cannot be reconciled");
    if (evidence.outcome === "NOT_CONFIRMED" || evidence.outcome === "STILL_UNKNOWN") {
      const current = await this.get(record.actionId);
      if (!current || digest(current) !== digest(record)) throw new Error("Stale ledger state");
      return current;
    }
    if (!["CONFIRMED", "NO_EXTERNAL_EFFECT"].includes(evidence.outcome)) throw new Error("Invalid reconciliation outcome");
    if (!("evidenceDigest" in evidence) || !hex(evidence.evidenceDigest)) throw new Error("Reconciliation requires external evidence digest");
    if (evidence.outcome === "NO_EXTERNAL_EFFECT" && record.state === "SENT") throw new Error("Send receipt already establishes an external effect");
    return this.append(record, evidence.outcome === "CONFIRMED" ? "CONFIRMED" : "FAILED_SAFE", { evidenceDigest: evidence.evidenceDigest });
  }
}
