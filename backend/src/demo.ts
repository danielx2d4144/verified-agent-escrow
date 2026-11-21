/**
 * Demo runner — scripts the 4 demo steps end to end (see demo/DEMO_SCRIPT.md)
 * against the LOCAL deal store, without touching the network.
 *
 * LOCAL DEMO ONLY. The badge verification in this script is STUBBED with
 * explicit mock results, labelled as such — a stubbed check is not a real
 * badge check. The real flow is the HTTP server (src/index.ts), which
 * calls verifySellerBadge() against the live REST badge-check endpoint.
 * Run the real demo only after BUILD_PLAN.md Step 0 (real testnet badges)
 * and Step 2 (deployed contract).
 *
 * Usage: npm run demo
 */
import { DealStore } from "./escrow.js";
import { audit, auditVerification, getAuditLog } from "./audit.js";
import type { VerificationResult } from "./verify.js";

function mockVerification(
  badge: string,
  verified: boolean,
): VerificationResult {
  return {
    badge,
    found: verified,
    active: verified,
    cardHashMatches: verified,
    verified,
    owner: verified ? "3qZhwAJxBsehm9cZt27sZk8PmNjrsxo9wqgfmhrWj2UtF7RxX1" : undefined,
    agentUri: verified
      ? "https://example.invalid/.well-known/agent-card.json"
      : undefined,
    checkedAt: new Date().toISOString(),
    network: "local-demo-mock",
    issues: verified ? [] : ["MOCK: seller badge did not verify"],
  };
}

const store = new DealStore();
const BUYER = "4DDvjwdcLmTy1Ar9FCKKPMiABrS261TvyXJGr4n4ypuuogXeFF";
const SELLER = "3qZhwAJxBsehm9cZt27sZk8PmNjrsxo9wqgfmhrWj2UtF7RxX1";

console.log("Verified Agent Escrow — LOCAL demo runner (verification STUBBED)");
console.log("1. Unverified seller is refused (badge check fails, no escrow).");
const refused = mockVerification("JyP9TtQC3HCNrTYR3sc2T", false);
auditVerification("new", "badge-check-before-deal", refused, "MOCK check");
console.log("   -> verified:", refused.verified, "| no escrow created.");

console.log("2. Verified seller: badge passes, buyer funds escrow in test CCD.");
const ok = mockVerification("JyP9U3A3VVBoVTSm7QdSw", true);
auditVerification("new", "badge-check-before-deal", ok, "MOCK check");
const deal = store.create({
  buyer: BUYER,
  seller: SELLER,
  sellerBadge: "JyP9U3A3VVBoVTSm7QdSw",
  amountMicroCcd: 1_000_000,
  deadlineMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
});
audit({ dealId: String(deal.id), event: "escrow-created", badge: deal.sellerBadge, detail: "local demo deal funded (settledOnChain: false)" });
console.log("   -> deal", deal.id, "state:", deal.state, "| contract call:", deal.contractCall.function);

console.log("3. Delivery + badge re-check passes -> escrow releases to seller.");
const recheck = mockVerification(deal.sellerBadge, true);
auditVerification(String(deal.id), "badge-recheck-at-delivery", recheck, "MOCK re-check");
const released = store.confirmDelivery(deal.id, BUYER);
audit({ dealId: String(deal.id), event: "escrow-released", badge: deal.sellerBadge, detail: "MOCK: released to seller" });
console.log("   -> deal", released.id, "state:", released.state);

console.log("4. Revoked seller: badge re-check fails -> escrow refunds buyer.");
const deal2 = store.create({
  buyer: BUYER,
  seller: SELLER,
  sellerBadge: "JyP9TtQC3HCNrTYR3sc2T",
  amountMicroCcd: 1_000_000,
  deadlineMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
});
const revoked = mockVerification(deal2.sellerBadge, false);
auditVerification(String(deal2.id), "badge-recheck-at-delivery", revoked, "MOCK re-check");
const refunded = store.refund(deal2.id, BUYER, "badge_revoked");
audit({ dealId: String(deal2.id), event: "escrow-refunded-badge-revoked", badge: deal2.sellerBadge, detail: "MOCK: refunded buyer" });
console.log("   -> deal", refunded.id, "state:", refunded.state);

console.log("\nAudit trail entries:", getAuditLog().length);
for (const e of getAuditLog()) console.log("  -", e.at, e.dealId, e.event);
console.log("\nDone. Nothing here touched a chain: settledOnChain is false for every deal.");
