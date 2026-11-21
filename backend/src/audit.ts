/**
 * Audit log — every verification check, mirrored with the on-chain
 * escrow events. This is the EU AI Act record-keeping half of the
 * project: who was verified, when, and what the result was.
 *
 * v1: append-only JSON lines to stdout / a local file. The on-chain
 * source of truth is the escrow contract's events (EscrowCreated /
 * EscrowReleased / EscrowRefunded); this log is the human-readable
 * mirror, and it must never contradict the chain. A production version
 * would index contract events from the testnet node and serve them
 * from there — TODO, stretch goal.
 */
import type { VerificationResult } from "./verify.js";

export type AuditEntry = {
  at: string;
  dealId: string;
  event: string;
  badge?: string;
  verification?: VerificationResult;
  txHash?: string;
  detail: string;
};

const entries: AuditEntry[] = [];

export function audit(entry: Omit<AuditEntry, "at">): AuditEntry {
  const full: AuditEntry = { ...entry, at: new Date().toISOString() };
  entries.push(full);
  console.log(JSON.stringify(full));
  return full;
}

export function auditVerification(
  dealId: string,
  event: string,
  verification: VerificationResult,
  detail: string,
): AuditEntry {
  return audit({
    dealId,
    event,
    badge: verification.badge,
    verification,
    detail,
  });
}

export function getAuditLog(): AuditEntry[] {
  return [...entries];
}

/**
 * Test-only helper: empty the in-memory audit log so tests can assert
 * on exactly the entries one flow produced. The server never calls this.
 */
export function clearAuditLog(): void {
  entries.length = 0;
}
