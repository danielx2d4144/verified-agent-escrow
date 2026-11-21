/**
 * Deal flow — the testable core of the backend.
 *
 * The HTTP routes in `index.ts` used to implement these gates inline;
 * they now delegate here, so the same code the server runs is what the
 * tests in `dealflow.test.ts` exercise. The flow takes a
 * `VerificationResult` as an argument instead of calling the network
 * itself, so tests can inject a verified / revoked / card-gone verdict
 * without touching the live badge-check endpoint. The server passes
 * the real `verifySellerBadge()` result in.
 *
 * Gates, in order — this is the whole security model:
 *   1. verify-before-deal: an unverified seller is refused, no escrow
 *      is created, and the refusal is audit-logged.
 *   2. re-verify at delivery: a badge valid at deal time may have been
 *      revoked since — never reuse the first check. A failed re-check
 *      refunds the buyer instead of releasing.
 *   3. release only from Funded, only by the buyer; refund only from
 *      Funded, only by the buyer or arbiter. Every step is audit-logged
 *      with the verification that justified it.
 *
 * Settlement mode is unchanged from `escrow.ts`: local mode records
 * the exact contract call that *will* be made on-chain with
 * `settledOnChain: false`; testnet mode throws until the SDK wiring
 * exists. No chain call is made or claimed here.
 */
import { Deal, DealError, DealStore } from "./escrow.js";
import { audit, auditVerification } from "./audit.js";
import type { VerificationResult } from "./verify.js";

export type OpenDealArgs = {
  buyer: string;
  seller: string;
  sellerBadge: string;
  amountMicroCcd: number;
  deadlineMs: number;
};

export type OpenDealResult =
  | { ok: true; deal: Deal; verification: VerificationResult }
  | { ok: false; verification: VerificationResult };

/** Gate 1 — verify before any money moves. */
export function openDeal(
  store: DealStore,
  verification: VerificationResult,
  args: OpenDealArgs,
): OpenDealResult {
  auditVerification(
    "new",
    "badge-check-before-deal",
    verification,
    "seller badge checked before escrow creation",
  );
  if (!verification.verified) {
    audit({
      dealId: "new",
      event: "deal-refused-unverified-seller",
      badge: args.sellerBadge,
      detail: "no escrow created: seller badge did not verify",
    });
    return { ok: false, verification };
  }
  const deal = store.create(args);
  audit({
    dealId: String(deal.id),
    event: "escrow-created",
    badge: args.sellerBadge,
    verification,
    detail: `escrow ${deal.id} funded in local mode (settledOnChain: false — see escrow.ts)`,
  });
  return { ok: true, deal, verification };
}

export type DeliverResult =
  | { outcome: "released"; deal: Deal; verification: VerificationResult }
  | { outcome: "refunded"; deal: Deal; verification: VerificationResult };

/**
 * Gate 2 — re-verify at delivery, then release or refund.
 * Throws `DealError` (409) if the deal is not Funded, or (403) if the
 * caller is not the buyer — the same statuses the routes return.
 */
export function deliverDeal(
  store: DealStore,
  verification: VerificationResult,
  id: number,
  caller: string,
  arbiter?: string,
): DeliverResult {
  const deal = store.get(id);
  if (deal.state !== "Funded") {
    throw new DealError(`deal ${id} is ${deal.state}, cannot release`, 409);
  }
  if (caller !== deal.buyer) {
    throw new DealError("only the buyer can confirm delivery", 403);
  }
  auditVerification(
    String(id),
    "badge-recheck-at-delivery",
    verification,
    "seller badge re-checked before release",
  );
  if (!verification.verified) {
    // Revoked (or card broken) since the deal was funded: refund,
    // do NOT release.
    const refunded = store.refund(id, caller, "badge_revoked", arbiter);
    audit({
      dealId: String(id),
      event: "escrow-refunded-badge-revoked",
      badge: deal.sellerBadge,
      verification,
      detail:
        "badge no longer verified at delivery — refunded buyer instead of releasing",
    });
    return { outcome: "refunded", deal: refunded, verification };
  }
  const released = store.confirmDelivery(id, caller);
  audit({
    dealId: String(id),
    event: "escrow-released",
    badge: deal.sellerBadge,
    verification,
    detail: "badge re-checked Active at delivery — released to seller",
  });
  return { outcome: "released", deal: released, verification };
}

/**
 * Refund a Funded deal (badge revoked / expired / other).
 * Throws `DealError` (409) if not Funded, or (403) if the caller is
 * neither the buyer nor the arbiter.
 */
export function refundDeal(
  store: DealStore,
  id: number,
  caller: string,
  reason: string,
  arbiter?: string,
): Deal {
  const deal = store.get(id);
  if (deal.state !== "Funded") {
    throw new DealError(`deal ${id} is ${deal.state}, cannot refund`, 409);
  }
  const refunded = store.refund(id, caller, reason, arbiter);
  audit({
    dealId: String(id),
    event: "escrow-refunded",
    badge: deal.sellerBadge,
    detail: `refund requested (reason: ${reason})`,
  });
  return refunded;
}
