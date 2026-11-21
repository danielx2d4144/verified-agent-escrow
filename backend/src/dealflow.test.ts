/**
 * Backend tests — deal flow (verify-before-deal, re-verify at
 * delivery, refund on revocation, audit log).
 *
 * Run with: `npm test`  (tsx --test src/*.test.ts)
 *
 * No network is touched: the deal-flow functions take a
 * `VerificationResult` as an argument, so tests inject verified /
 * revoked / card-gone verdicts directly. The only test that calls
 * the network is the last one, `verifyBadgeRest` against an
 * unreachable endpoint, which must fail safe (verified: false) —
 * it dynamically imports `verify.ts` after pointing
 * `BADGE_CHECK_URL` at a closed port, because the URL is read at
 * module load time.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DealStore, DealError } from "./escrow.js";
import { openDeal, deliverDeal, refundDeal } from "./dealflow.js";
import { getAuditLog, clearAuditLog } from "./audit.js";
import type { VerificationResult } from "./verify.js";

const BUYER = "4DDvjwdcLmTy1Ar9FCKKPMiABrS261TvyXJGr4n4ypuuogXeFF";
const SELLER = "3qZhwAJxBsehm9cZt27sZk8PmNjrsxo9wqgfmhrWj2UtF7RxX1";
const ARBITER = "3kBx2h5Y2veb4hZgAJWPrr8RyQESKm5TjzF3ti1QQ4VSYLwK1G";
const BADGE = "JyP9U3A3VVBoVTSm7QdSw";
const REVOKED_BADGE = "JyP9TtQC3HCNrTYR3sc2T";

function mockVerification(badge: string, verified: boolean): VerificationResult {
  return {
    badge,
    found: verified,
    active: verified,
    cardHashMatches: verified,
    verified,
    owner: verified ? SELLER : undefined,
    agentUri: verified ? "https://example.invalid/.well-known/agent-card.json" : undefined,
    checkedAt: new Date().toISOString(),
    network: "test-mock",
    issues: verified ? [] : ["MOCK: seller badge did not verify"],
  };
}

function args() {
  return {
    buyer: BUYER,
    seller: SELLER,
    sellerBadge: BADGE,
    amountMicroCcd: 1_000_000,
    deadlineMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
}

beforeEach(() => {
  clearAuditLog();
});

// Runs FIRST: it sets BADGE_CHECK_URL before verify.ts is ever
// imported, because the URL is read at module load time.
test("verifyBadgeRest fails safe when the endpoint is unreachable", async () => {
  process.env.BADGE_CHECK_URL = "http://127.0.0.1:9/v1/badge-check";
  const { verifyBadgeRest } = await import("./verify.js");
  const result = await verifyBadgeRest(BADGE);
  assert.equal(result.verified, false);
  assert.equal(result.found, false);
  assert.ok(result.issues.some((i) => i.includes("unreachable")));
});

test("verify-before-deal: verified seller opens a Funded escrow, audit-logged", () => {
  const store = new DealStore();
  const result = openDeal(store, mockVerification(BADGE, true), args());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.deal.state, "Funded");
  assert.equal(result.deal.contractCall.function, "create_escrow");
  assert.equal(result.deal.settledOnChain, false);
  assert.equal(result.deal.txHash, undefined);
  const events = getAuditLog().map((e) => e.event);
  assert.deepEqual(events, ["badge-check-before-deal", "escrow-created"]);
  assert.equal(getAuditLog()[0].verification?.verified, true);
});

test("verify-before-deal: unverified seller is refused, no escrow is created", () => {
  const store = new DealStore();
  const result = openDeal(store, mockVerification(REVOKED_BADGE, false), {
    ...args(),
    sellerBadge: REVOKED_BADGE,
  });
  assert.equal(result.ok, false);
  assert.equal(store.list().length, 0);
  const events = getAuditLog().map((e) => e.event);
  assert.deepEqual(events, [
    "badge-check-before-deal",
    "deal-refused-unverified-seller",
  ]);
});

test("re-verify at delivery: verified re-check releases to the seller", () => {
  const store = new DealStore();
  const opened = openDeal(store, mockVerification(BADGE, true), args());
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const result = deliverDeal(
    store,
    mockVerification(BADGE, true),
    opened.deal.id,
    BUYER,
  );
  assert.equal(result.outcome, "released");
  assert.equal(result.deal.state, "Released");
  assert.equal(result.deal.contractCall.function, "confirm_delivery");
  const events = getAuditLog()
    .filter((e) => e.dealId === String(opened.deal.id))
    .map((e) => e.event);
  assert.deepEqual(events, [
    "escrow-created",
    "badge-recheck-at-delivery",
    "escrow-released",
  ]);
});

test("re-verify at delivery: revoked badge refunds the buyer instead of releasing", () => {
  const store = new DealStore();
  const opened = openDeal(store, mockVerification(BADGE, true), args());
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const result = deliverDeal(
    store,
    mockVerification(BADGE, false),
    opened.deal.id,
    BUYER,
  );
  assert.equal(result.outcome, "refunded");
  assert.equal(result.deal.state, "Refunded");
  assert.equal(result.deal.contractCall.function, "refund");
  assert.deepEqual(
    (result.deal.contractCall.parameter as { reason: string }).reason,
    "badge_revoked",
  );
  const events = getAuditLog()
    .filter((e) => e.dealId === String(opened.deal.id))
    .map((e) => e.event);
  assert.deepEqual(events, [
    "escrow-created",
    "badge-recheck-at-delivery",
    "escrow-refunded-badge-revoked",
  ]);
});

test("deliver twice fails with 409; refund after release fails with 409", () => {
  const store = new DealStore();
  const opened = openDeal(store, mockVerification(BADGE, true), args());
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  deliverDeal(store, mockVerification(BADGE, true), opened.deal.id, BUYER);
  assert.throws(
    () => deliverDeal(store, mockVerification(BADGE, true), opened.deal.id, BUYER),
    (err: unknown) => err instanceof DealError && err.httpStatus === 409,
  );
  assert.throws(
    () => refundDeal(store, opened.deal.id, BUYER, "badge_revoked"),
    (err: unknown) => err instanceof DealError && err.httpStatus === 409,
  );
  assert.equal(store.get(opened.deal.id).state, "Released");
});

test("deliver by a non-buyer fails with 403 and the deal stays Funded", () => {
  const store = new DealStore();
  const opened = openDeal(store, mockVerification(BADGE, true), args());
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  assert.throws(
    () =>
      deliverDeal(store, mockVerification(BADGE, true), opened.deal.id, SELLER),
    (err: unknown) => err instanceof DealError && err.httpStatus === 403,
  );
  assert.equal(store.get(opened.deal.id).state, "Funded");
});

test("refund by the arbiter succeeds; refund by a stranger fails with 403", () => {
  const store = new DealStore();
  const opened = openDeal(store, mockVerification(BADGE, true), args());
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  assert.throws(
    () => refundDeal(store, opened.deal.id, SELLER, "other", ARBITER),
    (err: unknown) => err instanceof DealError && err.httpStatus === 403,
  );
  const refunded = refundDeal(store, opened.deal.id, ARBITER, "other", ARBITER);
  assert.equal(refunded.state, "Refunded");
  const events = getAuditLog()
    .filter((e) => e.dealId === String(opened.deal.id))
    .map((e) => e.event);
  assert.deepEqual(events, ["escrow-created", "escrow-refunded"]);
});

test("audit log records the full deal flow in order, with the verification attached", () => {
  const store = new DealStore();
  const opened = openDeal(store, mockVerification(BADGE, true), args());
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  deliverDeal(store, mockVerification(BADGE, true), opened.deal.id, BUYER);
  const entries = getAuditLog().filter((e) => e.dealId === String(opened.deal.id));
  assert.deepEqual(
    entries.map((e) => e.event),
    ["escrow-created", "badge-recheck-at-delivery", "escrow-released"],
  );
  assert.equal(entries[1].verification?.badge, BADGE);
  assert.equal(entries[1].verification?.verified, true);
  // Every entry carries a timestamp and the deal id.
  for (const e of entries) {
    assert.ok(e.at.length > 0);
    assert.equal(e.dealId, String(opened.deal.id));
  }
});

test("parseVerificationResponse: all three checks pass -> verified", async () => {
  const { parseVerificationResponse } = await import("./verify.js");
  const result = parseVerificationResponse(
    BADGE,
    {
      checks: {
        on_chain_agent_found: true,
        status_active: true,
        hash_matches_on_chain: true,
      },
      expected: { contracts: { cis8004: "12802,0", cis8: "12801,0" } },
      network: "testnet",
      issues: [],
    } as never,
    "2026-11-21T00:00:00.000Z",
  );
  assert.equal(result.verified, true);
  assert.equal(result.found, true);
  assert.equal(result.active, true);
  assert.equal(result.cardHashMatches, true);
});

test("parseVerificationResponse: card gone (hash mismatch) -> not verified", async () => {
  const { parseVerificationResponse } = await import("./verify.js");
  // The shape of the real testnet token 0 badge, probed 21 Nov 2026:
  // found and active, but the card URL 404s so the hash does not match.
  const result = parseVerificationResponse(
    REVOKED_BADGE,
    {
      checks: {
        on_chain_agent_found: true,
        status_active: true,
        hash_matches_on_chain: false,
      },
      expected: { contracts: { cis8004: "12802,0", cis8: "12801,0" } },
      network: "testnet",
      issues: [{ severity: "error", field: "card", message: "card URL 404" }],
    } as never,
    "2026-11-21T00:00:00.000Z",
  );
  assert.equal(result.verified, false);
  assert.equal(result.found, true);
  assert.equal(result.active, true);
  assert.equal(result.cardHashMatches, false);
});

test("parseVerificationResponse: revoked badge (inactive) -> not verified", async () => {
  const { parseVerificationResponse } = await import("./verify.js");
  const result = parseVerificationResponse(
    BADGE,
    {
      checks: {
        on_chain_agent_found: true,
        status_active: false,
        hash_matches_on_chain: true,
      },
      expected: { contracts: { cis8004: "12802,0", cis8: "12801,0" } },
      network: "testnet",
      issues: [],
    } as never,
    "2026-11-21T00:00:00.000Z",
  );
  assert.equal(result.verified, false);
  assert.equal(result.active, false);
});

test("parseVerificationResponse: registry mismatch (mainnet badge on testnet) -> not verified", async () => {
  const { parseVerificationResponse } = await import("./verify.js");
  const result = parseVerificationResponse(
    BADGE,
    {
      checks: {
        on_chain_agent_found: true,
        status_active: true,
        hash_matches_on_chain: true,
      },
      expected: { contracts: { cis8004: "10082,0", cis8: "10081,0" } },
      network: "mainnet",
      issues: [],
    } as never,
    "2026-11-21T00:00:00.000Z",
  );
  assert.equal(result.verified, false);
  assert.ok(result.issues.some((i) => i.includes("registry mismatch")));
});
