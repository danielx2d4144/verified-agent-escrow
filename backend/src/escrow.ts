/**
 * Escrow deal flow — backend side.
 *
 * Two modes, and the code is honest about which one it is in:
 *
 *  - "local" (default, and the mode this repo runs in today): deals are
 *    held in an in-memory store and the state machine is enforced here
 *    (Funded -> Released | Refunded, no double-release, no refund after
 *    release, only the buyer / arbiter may settle). Each deal records the
 *    EXACT contract call that will be made on-chain (`contractCall`),
 *    but `txHash` is undefined and `settledOnChain` is false — no chain
 *    call has happened. This makes the full deal flow runnable and
 *    demoable locally without pretending a testnet transaction exists.
 *
 *  - "testnet": once the contract is deployed (BUILD_PLAN.md Step 2),
 *    `createEscrow` / `confirmDelivery` / `refundEscrow` must call
 *    `create_escrow` / `confirm_delivery` / `refund` on the deployed
 *    instance via concordium-client or the Concordium Node.js SDK, using
 *    the contract index from .env (`ESCROW_CONTRACT_INDEX`), and fill in
 *    `txHash` + `settledOnChain: true` from the real transaction.
 *    That wiring is still TODO — the functions throw a specific error
 *    naming it if `ESCROW_MODE=testnet` is set before it exists.
 *
 * The backend is the only caller of confirm_delivery / refund in v1, and
 * it only calls them AFTER verifySellerBadge() has passed (release) or
 * failed/expired (refund). That ordering is the whole security model —
 * see README.md.
 */

export type EscrowState = "Funded" | "Released" | "Refunded";

export type ContractCall = {
  function: "create_escrow" | "confirm_delivery" | "refund";
  contractIndex?: number;
  contractSubindex?: number;
  /** JSON-encoded parameter for the contract call. */
  parameter: Record<string, unknown>;
  /** Amount attached to the call, in microCCD (create_escrow only). */
  amountMicroCcd?: number;
};

export type Deal = {
  id: number;
  buyer: string;
  seller: string;
  sellerBadge: string;
  amountMicroCcd: number;
  deadlineMs: number;
  state: EscrowState;
  contractCall: ContractCall;
  /** Undefined until a real testnet transaction settles this deal. */
  txHash?: string;
  settledOnChain: boolean;
  createdAt: string;
};

export class DealError extends Error {
  /** HTTP status the route handlers use for this error (400 by default). */
  readonly httpStatus: number;

  constructor(message: string, httpStatus = 400) {
    super(message);
    this.name = "DealError";
    this.httpStatus = httpStatus;
  }
}

const contractIndex = process.env.ESCROW_CONTRACT_INDEX
  ? Number(process.env.ESCROW_CONTRACT_INDEX)
  : undefined;
const contractSubindex = Number(process.env.ESCROW_CONTRACT_SUBINDEX ?? 0);

/** Throws if anyone flips the backend to testnet mode before the SDK wiring exists. */
function requireLocalMode(): void {
  if ((process.env.ESCROW_MODE ?? "local") === "testnet") {
    throw new DealError(
      "ESCROW_MODE=testnet is set, but the on-chain SDK wiring is not " +
        "implemented yet (BUILD_PLAN.md Step 2/3). Set ESCROW_MODE=local " +
        "to run the demo flow, or wire the concordium-client / Node.js SDK " +
        "call first. No testnet transaction has been sent.",
    );
  }
}

export class DealStore {
  private deals = new Map<number, Deal>();
  private nextId = 0;

  create(args: {
    buyer: string;
    seller: string;
    sellerBadge: string;
    amountMicroCcd: number;
    deadlineMs: number;
  }): Deal {
    requireLocalMode();
    if (!args.amountMicroCcd || args.amountMicroCcd <= 0) {
      throw new DealError("amountMicroCcd must be > 0", 400);
    }
    if (args.deadlineMs <= Date.now()) {
      throw new DealError("deadlineMs must be in the future", 400);
    }
    const id = this.nextId++;
    const deal: Deal = {
      id,
      buyer: args.buyer,
      seller: args.seller,
      sellerBadge: args.sellerBadge,
      amountMicroCcd: args.amountMicroCcd,
      deadlineMs: args.deadlineMs,
      state: "Funded",
      contractCall: {
        function: "create_escrow",
        contractIndex,
        contractSubindex,
        parameter: {
          seller: args.seller,
          seller_badge: args.sellerBadge,
          deadline_ms: args.deadlineMs,
        },
        amountMicroCcd: args.amountMicroCcd,
      },
      settledOnChain: false,
      createdAt: new Date().toISOString(),
    };
    this.deals.set(id, deal);
    return deal;
  }

  get(id: number): Deal {
    const deal = this.deals.get(id);
    if (!deal) throw new DealError(`no deal with id ${id}`, 404);
    return deal;
  }

  list(): Deal[] {
    return [...this.deals.values()];
  }

  /** Release to the seller. Only from Funded, only by the buyer. */
  confirmDelivery(id: number, caller: string): Deal {
    requireLocalMode();
    const deal = this.get(id);
    if (deal.state !== "Funded") {
      throw new DealError(`deal ${id} is ${deal.state}, cannot release`, 409);
    }
    if (caller !== deal.buyer) {
      throw new DealError("only the buyer can confirm delivery", 403);
    }
    deal.state = "Released";
    deal.contractCall = {
      function: "confirm_delivery",
      contractIndex,
      contractSubindex,
      parameter: { id },
    };
    return deal;
  }

  /** Refund to the buyer. Only from Funded, only by the buyer or arbiter. */
  refund(id: number, caller: string, reason: string, arbiter?: string): Deal {
    requireLocalMode();
    const deal = this.get(id);
    if (deal.state !== "Funded") {
      throw new DealError(`deal ${id} is ${deal.state}, cannot refund`, 409);
    }
    if (caller !== deal.buyer && (!arbiter || caller !== arbiter)) {
      throw new DealError("only the buyer or arbiter can refund", 403);
    }
    deal.state = "Refunded";
    deal.contractCall = {
      function: "refund",
      contractIndex,
      contractSubindex,
      parameter: { id, reason },
    };
    return deal;
  }
}

/** The store the HTTP routes use. In-memory by design in v1 (see audit.ts). */
export const deals = new DealStore();

/**
 * Backwards-compatible wrappers kept for the route handlers' naming.
 * These are the functions the deal flow calls; they delegate to the store.
 */
export function createEscrow(args: {
  buyer: string;
  seller: string;
  sellerBadge: string;
  amountMicroCcd: number;
  deadlineMs: number;
}): Deal {
  return deals.create(args);
}

export function confirmDelivery(escrowId: number, caller: string): Deal {
  return deals.confirmDelivery(escrowId, caller);
}

export function refundEscrow(
  escrowId: number,
  caller: string,
  reason: string,
  arbiter?: string,
): Deal {
  return deals.refund(escrowId, caller, reason, arbiter);
}
