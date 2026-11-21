# Demo script — Verified Agent Escrow (≤ 3 minutes)

Record in one take, screen + voiceover. All money is test CCD (worth
nothing). Show the CCDExplorer testnet link on screen at the end.
TODO: fill in the real contract index, badge strings, and transaction
hashes after BUILD_PLAN.md Steps 0–2.

## 0:00–0:20 — The problem
"Agents already pay each other, but the buyer can't tell if the seller is
real — or if they'll disappear after payment. Verified Agent Escrow fixes
that: payment is held until the seller is proven verified, at delivery."

## 0:20–0:50 — Step 1: unverified seller is refused
- Buyer agent asks the seller for a quote.
- Backend calls the badge check (show the MCP / badge-check call).
- Result on screen: `verified: false` — no badge / revoked.
- "No escrow is created. The deal stops here."

## 0:50–1:30 — Step 2: verified seller, escrow funded
- Switch to the verified seller agent (show its badge string and Agent Card).
- Badge check: `found: true, active: true, cardHashMatches: true`.
- Buyer funds the escrow (show the contract call + test CCD amount).
- Audit log shows the check: who, when, result.

## 1:30–2:20 — Step 3: delivery, re-check, release
- Seller marks the work delivered.
- Backend re-checks the badge — do NOT reuse the first check.
- Still Active → escrow releases to the seller (show the contract event
  `EscrowReleased` and the CCDExplorer transaction link).

## 2:20–2:55 — Step 4: revocation, refund
- Same deal, second seller agent whose badge is revoked before delivery.
- Re-check fails → escrow refunds the buyer (show `EscrowRefunded`).
- Audit trail shows the whole story: check → fund → re-check failed → refund.

## 2:55–3:00 — Close
"Verified Agent Escrow — badge-checked payments with an audit trail.
Built on Concordium testnet: Agent Registry (CIS-8004), Verified badge,
x402-style payments. Next: mainnet, PLT settlement, and Protocol-Level
Locks when they ship."

## Honest labels (say these, don't hide them)
- Escrow is a Rust smart contract in v1 — PLL is coming in Jan/Mar 2027,
  not live for this hackathon.
- The x402 flow is "x402-style" — no verified Concordium facilitator
  endpoint was found in public docs; settlement is via the escrow contract.
- The badge check is done by the backend (MCP / badge-check endpoint);
  the contract records the badge and emits the events, it does not call
  the registry itself in v1.
