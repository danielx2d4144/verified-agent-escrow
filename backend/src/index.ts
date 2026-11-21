/**
 * Verified Agent Escrow — backend entry point (Fastify).
 *
 * Deal flow, end to end (all steps audit-logged; see audit.ts):
 *   POST /deals              verify seller badge -> create escrow (funded)
 *   POST /deals/:id/deliver  re-verify badge -> release, or refund if revoked
 *   POST /deals/:id/refund   refund (badge revoked / expired / other)
 *   GET  /deals/:id          one deal, with its contract call + settlement state
 *   GET  /deals/:id/audit    the audit trail for one deal
 *   GET  /quote              x402-style: 402 challenge (see x402.ts — honest
 *                            labelling: no verified Concordium facilitator)
 *
 * Settlement mode: `ESCROW_MODE=local` (default) runs the deal state
 * machine in memory and records the exact contract call that will be
 * made on-chain, with `settledOnChain: false` — no chain call is made
 * and none is claimed. See escrow.ts. The badge check is real: it calls
 * the hosted REST badge-check endpoint, verified on testnet 21 Nov 2026
 * (see verify.ts). Never cache a badge pass across delivery — deliver
 * always re-verifies, and a failed re-check refunds instead of releasing.
 */
import Fastify from "fastify";
import { verifySellerBadge } from "./verify.js";
import { deals, DealError } from "./escrow.js";
import { getAuditLog } from "./audit.js";
import { openDeal, deliverDeal, refundDeal } from "./dealflow.js";
import { buildChallenge, verifyPaymentProof } from "./x402.js";

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT ?? 3000);
const ARBITER = process.env.ARBITER_ACCOUNT ?? "";
const ESCROW_PAY_TO =
  process.env.ESCROW_CONTRACT_INDEX ??
  "TODO: set ESCROW_CONTRACT_INDEX after deploy (BUILD_PLAN.md Step 2)";

app.get("/health", async () => ({
  ok: true,
  network: process.env.CONCORDIUM_NETWORK ?? "testnet",
  escrowMode: process.env.ESCROW_MODE ?? "local",
  escrowContractIndex: process.env.ESCROW_CONTRACT_INDEX ?? null,
}));

app.get("/deals", async () => ({ deals: deals.list() }));

app.get("/deals/:id", async (req, reply) => {
  const id = Number((req.params as { id: string }).id);
  try {
    return deals.get(id);
  } catch (err) {
    if (err instanceof DealError) return reply.status(404).send({ error: err.message });
    throw err;
  }
});

app.post("/deals", async (req, reply) => {
  const body = req.body as {
    buyer?: string;
    seller?: string;
    sellerBadge?: string;
    amountMicroCcd?: number;
    deadlineMs?: number;
  };
  if (!body?.sellerBadge || !body?.seller || !body?.buyer) {
    return reply
      .status(400)
      .send({ error: "buyer, seller and sellerBadge are required" });
  }
  if (!body.amountMicroCcd || body.amountMicroCcd <= 0) {
    return reply.status(400).send({ error: "amountMicroCcd must be > 0" });
  }

  // Gate 1: badge must verify BEFORE any money moves (see dealflow.ts).
  const verification = await verifySellerBadge(body.sellerBadge);
  try {
    const result = openDeal(deals, verification, {
      buyer: body.buyer,
      seller: body.seller,
      sellerBadge: body.sellerBadge,
      amountMicroCcd: body.amountMicroCcd,
      deadlineMs: body.deadlineMs ?? Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    if (!result.ok) {
      return reply.status(403).send({ error: "seller not verified", verification });
    }
    return reply.status(201).send({ deal: result.deal, verification });
  } catch (err) {
    if (err instanceof DealError)
      return reply.status(err.httpStatus).send({ error: err.message });
    throw err;
  }
});

app.post("/deals/:id/deliver", async (req, reply) => {
  const id = Number((req.params as { id: string }).id);
  const body = (req.body ?? {}) as { buyer?: string; sellerBadge?: string };
  let deal;
  try {
    deal = deals.get(id);
  } catch (err) {
    if (err instanceof DealError) return reply.status(404).send({ error: err.message });
    throw err;
  }
  if (deal.state !== "Funded") {
    return reply.status(409).send({ error: `deal ${id} is ${deal.state}`, deal });
  }
  const caller = body.buyer ?? deal.buyer;
  if (caller !== deal.buyer) {
    return reply.status(403).send({ error: "only the buyer can confirm delivery" });
  }

  // Gate 2: re-verify at delivery — a badge valid at deal time may have
  // been revoked since. Never reuse the first check. (see dealflow.ts)
  const verification = await verifySellerBadge(body.sellerBadge ?? deal.sellerBadge);
  try {
    const result = deliverDeal(
      deals,
      verification,
      id,
      caller,
      ARBITER || undefined,
    );
    return reply.send({ outcome: result.outcome, deal: result.deal, verification });
  } catch (err) {
    if (err instanceof DealError)
      return reply.status(err.httpStatus).send({ error: err.message });
    throw err;
  }
});

app.post("/deals/:id/refund", async (req, reply) => {
  const id = Number((req.params as { id: string }).id);
  const body = (req.body ?? {}) as { buyer?: string; reason?: string };
  let deal;
  try {
    deal = deals.get(id);
  } catch (err) {
    if (err instanceof DealError) return reply.status(404).send({ error: err.message });
    throw err;
  }
  if (deal.state !== "Funded") {
    return reply.status(409).send({ error: `deal ${id} is ${deal.state}`, deal });
  }
  const caller = body.buyer ?? deal.buyer;
  const reason = body.reason ?? "other";
  try {
    const refunded = refundDeal(deals, id, caller, reason, ARBITER || undefined);
    return reply.send({ outcome: "refunded", deal: refunded });
  } catch (err) {
    if (err instanceof DealError)
      return reply.status(err.httpStatus).send({ error: err.message });
    throw err;
  }
});

app.get("/deals/:id/audit", async (req) => {
  const { id } = req.params as { id: string };
  return { dealId: id, entries: getAuditLog().filter((e) => e.dealId === id) };
});

app.get("/quote", async (req, reply) => {
  // x402-style: no payment header -> 402 with the challenge. A payment
  // header is NOT accepted as proof here — there is no verified
  // Concordium facilitator to check it against (see x402.ts).
  const payment = req.headers["x-payment"];
  const challenge = buildChallenge({
    amountMicroCcd: Number(process.env.DEMO_AMOUNT_MICROCCD ?? 1_000_000),
    payTo: ESCROW_PAY_TO,
  });
  if (payment) {
    const check = verifyPaymentProof(String(payment));
    return reply.status(402).send({ challenge, paymentCheck: check });
  }
  return reply.status(402).send(challenge);
});

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
