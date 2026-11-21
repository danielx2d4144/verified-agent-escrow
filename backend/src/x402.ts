/**
 * x402-style payment flow — HONEST LABELLING, read this first.
 *
 * What x402 is (verified, general standard): HTTP 402 Payment Required.
 * Client calls without payment -> server answers 402 with price, asset,
 * recipient -> client signs a payment and retries with the payment header
 * -> a facilitator verifies and settles on-chain -> server releases the
 * resource and returns a receipt (PAYMENT-RESPONSE header).
 *
 * What is NOT verified for Concordium (RESEARCH.md §5): any official
 * Concordium x402 facilitator endpoint, supported assets, or scheme on
 * testnet. No such URL was found in the public docs searched on 21 Nov 2026.
 *
 * So this file implements the x402 SHAPE only: a real 402 challenge
 * document (scheme `exact`, the x402 standard scheme; asset = test CCD
 * in microCCD, because v1 settles in test CCD — there is a testnet PLT
 * stablecoin, EURQ, live on testnet per Concordium, but no PLT token ID
 * or faucet for it was verified, so it is NOT named as the settlement
 * asset here), and settlement via the escrow contract, not via a
 * facilitator. `verifyPaymentProof()` does NOT fake a verification: it
 * returns `verified: false` with the reason, because there is no
 * facilitator to verify against. The receipt for a payment in v1 is the
 * escrow's `EscrowCreated` event / testnet transaction hash once the
 * contract is deployed — not a PAYMENT-RESPONSE header.
 *
 * Labelled "x402-style" everywhere (code, docs, demo, submission) until
 * a real facilitator is confirmed at office hours or from Workshop 3
 * materials. Do NOT present it to judges as a live Concordium
 * facilitator integration.
 *
 * TODO (after a facilitator is confirmed):
 *  - replace the challenge below with the facilitator's real
 *    PaymentRequired document (scheme, network, asset, amount, payTo)
 *  - verify the signed payment with the facilitator before releasing
 *  - return the real settlement receipt in PAYMENT-RESPONSE
 */

export type X402Challenge = {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    network: string;
    amount: string;
    asset: string;
    payTo: string;
    /** Honest label: this is the x402 shape, not a facilitator settlement. */
    settlement: string;
  }>;
};

export function buildChallenge(args: {
  amountMicroCcd: number;
  payTo: string;
}): X402Challenge {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        // x402 network id for Concordium testnet — UNVERIFIED. The
        // network is named in plain text rather than inventing a CAIP id.
        network: "concordium-testnet",
        amount: String(args.amountMicroCcd),
        asset: "test CCD (microCCD) — v1 settles in test CCD, not a PLT",
        payTo: args.payTo,
        settlement:
          "x402-style: no verified Concordium x402 facilitator exists yet. " +
          "Pay by funding the escrow contract (create_escrow); the receipt " +
          "is the EscrowCreated event / testnet transaction hash.",
      },
    ],
  };
}

export type PaymentProofCheck = {
  verified: boolean;
  reason: string;
};

/**
 * There is no facilitator to verify a payment header against, so this
 * always returns verified: false with the reason. Callers must NOT
 * treat a non-empty X-PAYMENT header as proof of payment.
 */
export function verifyPaymentProof(_proof: string): PaymentProofCheck {
  return {
    verified: false,
    reason:
      "No verified Concordium x402 facilitator endpoint exists to check " +
      "this proof against (RESEARCH.md §5). In v1, payment is proven by " +
      "the escrow funding transaction on testnet, not by a payment header.",
  };
}
