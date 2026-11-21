# Verified Agent Escrow

**Concordium Trusted Agents Hackathon — Encode Club**
Final submission: **Wed 9 Dec 2026, 23:59 UTC** (Checkpoint 2 closes Thu 10 Dec 00:59 WAT).
Checkpoint 1 project on Encode Club: **Verified Agent Escrow** (renamed from NoctAgent Credit, 21 Nov 2026).

> A buyer agent pays a seller agent, but the payment sits in escrow on Concordium
> testnet and only releases if the seller still carries the Verified by Concordium
> badge when the work is delivered. If the badge is revoked, the payment refunds.
> Every check — who was verified, when, and what the result was — is logged
> on-chain, so there's a full audit trail.

Status: **building — 21 Nov 2026.** Research done, testnet details resolved
from public sources (see `RESEARCH.md` §2/§3/§6). Rust contract rewritten
with the official piggy-bank APIs and `concordium-std` 11 — **`cargo
concordium build` passes** (27,472 B module, 968 B schema; wasm at
`contracts/escrow/target/concordium/wasm32v1-none/release/verified_agent_escrow.wasm`).
Tests, all run 21 Nov 2026: **contract 9/9 wasm unit tests + 6/6 integration
tests pass** (`cargo concordium test --out concordium-out/module.wasm.v1`);
**backend 13/13 tests pass** (`npm test` in `backend/`, deal-flow core in
`dealflow.ts`); `npm run demo` passes all 4 steps and the live server
smoke test was re-run after the backend refactor (real testnet badge whose
card is gone was correctly refused, 403, no escrow created). **Nothing here
is deployed, submitted, or published — no contract address or CCDExplorer
link exists yet. Deployment is blocked until Daniel creates a Concordium
Wallet for Web, a testnet identity + account, and registers test agents**
(see `BUILD_PLAN.md` Step 2).

## Why this fits this hackathon

Concordium's brief asks for an agent that can do three things: prove a verified
human stands behind it, pay and get paid on its own, and keep a record of what
it did — with the Verified by Concordium badge at the centre. Judging looks at
how deeply a project uses Concordium identity, the Agent Registry and agent
payments, whether the core flow works end to end, whether it solves a real
problem, and whether it has a believable route to mainnet and real users.

Verified Agent Escrow hits all three, in one demoable flow:

| Pillar | How this project does it |
| --- | --- |
| Prove a verified human | Seller's badge is checked in the Agent Registry (CIS-8004) before a deal, and checked again at delivery |
| Pay and get paid | Buyer funds an escrow; release/refund is settled on Concordium testnet (CCD in v1; x402-style HTTP 402 flow in the backend — see `RESEARCH.md` for what is/isn't verified about a Concordium x402 facilitator) |
| Keep a record | Every verification check is emitted as an on-chain escrow event and mirrored in an audit log, supporting EU AI Act record-keeping |

## Demo (under 3 minutes)

1. **Unverified seller is refused.** Buyer agent asks for a quote; the seller has
   no badge / a revoked badge. The backend returns `verified: false` and no
   escrow is created.
2. **Verified seller gets paid into escrow.** Badge checks out (`found`, `active`,
   card hash matches). Buyer funds the escrow in test CCD. The audit log shows
   the check.
3. **Delivery, re-check, release.** Seller marks delivery. The backend re-checks
   the badge. Still active → escrow releases to the seller.
4. **Revocation, refund.** Same deal, but the badge is revoked before delivery →
   escrow refunds the buyer, and the audit trail shows why.

All money is **test CCD from the faucet — worth nothing, no real money, no
hardware needed**. The "agents" are software (scripts / a small API), not
physical devices.

## Architecture

```
Buyer agent ──► Backend (Fastify / TypeScript)
                    │  1. verify seller badge
                    │     ├─ REST badge-check (VERIFIED on testnet 21 Nov 2026)
                    │     │  GET https://agent-registry-mcp.concordium.com/v1/badge-check/<badge>
                    │     │  no query parameter — network resolved from the badge
                    │     │  (testnet registry <12802, 0>); returns found / active /
                    │     │  card-hash-match / issues. See RESEARCH.md §3.
                    │     └─ Hosted MCP server (live behaviour NOT verified —
                    │        initialize probe returned no response; see RESEARCH.md)
                    │        https://agent-registry-mcp.concordium.com/mcp
                    │  2. create / release / refund escrow
                    ▼
              Escrow contract (Rust, concordium-std 11)
              on Concordium testnet
                    │  emits EscrowCreated / Released / Refunded
                    │  events — the on-chain audit trail
                    ▼
              CCDExplorer (testnet) — homepage https://ccdexplorer.io/testnet
              verified; contract/tx deep-link pattern UNVERIFIED (guessed
              patterns 404) — confirm from the explorer site after deploy
```

Design decision, made deliberately: **the badge check happens off-chain in
the backend in v1, not inside the escrow contract.** The contract only trusts
calls from the buyer (release) / an arbiter (refund) after the backend has
verified the badge. An in-contract CIS-8004 `agent_of` call is a stretch goal —
it was not verified in public docs during research, and it is not needed for
the demo. See `RESEARCH.md` § Unverified.

Likewise, **escrow is a Rust smart contract in v1, NOT Protocol-Level Locks
(PLL).** PLL is Concordium's future protocol-level escrow, but its own pages
say it is "coming soon" and its roadmap lists PLL Simple for Jan 2027 and
Enhanced for Mar 2027 — after this hackathon's 9 Dec deadline. Do not claim
PLL in the submission. See `RESEARCH.md`.

## Repo layout

```
README.md            — this file
BUILD_PLAN.md        — ordered build plan, dependencies, risks, to 9 Dec
RESEARCH.md          — what was found, with source URLs, and what is unverified
contracts/escrow/    — Rust escrow contract (concordium-std 11, piggy-bank APIs;
                       compile pending cargo-concordium — see BUILD_PLAN.md)
backend/             — Fastify/TypeScript backend: badge verify (REST, live on
                       testnet), deal flow (verify → escrow → re-verify →
                       release/refund), x402-style 402 flow, audit log.
                       Local mode runs now; `npm run demo` scripts the 4 demo
                       steps against a labelled stubbed check.
examples/
  agent-card.json    — example Agent Card with the Concordium badge extension
                       (placeholders — badge/tokenAddress are null until
                       the seller agent is actually registered)
demo/
  DEMO_SCRIPT.md     — shot-by-shot 3-minute demo script
```

## How to run (what actually works now, 21 Nov 2026)

```bash
# 1. Contract — Rust 1.100.0 + cargo-concordium 5.0.0 (both installed).
#    NOTE: on this VM, always set TMPDIR under $HOME first — /tmp is a
#    512 MB tmpfs and a full build fails there (see BUILD_PLAN.md).
export TMPDIR="$HOME/cargo-tmp/tmp"
cd contracts/escrow
cargo concordium build    # ✅ passes — 27,472 B module, schema 968 B
cargo concordium test --out concordium-out/module.wasm.v1
                        # ✅ 9/9 wasm unit tests + 6/6 integration tests pass
# deploy to testnet with concordium-client — TODO: fill in module ref + contract index
# (blocked: needs Daniel's Concordium Wallet + testnet account — see BUILD_PLAN.md Step 2)
# wasm: target/concordium/wasm32v1-none/release/verified_agent_escrow.wasm

# 2. Backend — runs now (Node + TypeScript, no chain needed)
cd backend
cp .env.example .env   # verified testnet values are in .env.example;
                       # ESCROW_CONTRACT_INDEX still empty until deploy
npm install
npm run dev            # Fastify on :3000 — POST /deals, /deals/:id/deliver,
                       # /deals/:id/refund, GET /deals/:id/audit, GET /quote (402)

# 3. Demo flow (local, verification stubbed and labelled as such)
npm run demo   # 4 steps: refused unverified seller, escrow funded,
               # release on delivery, refund on revocation — settledOnChain: false

# 4. Live smoke test (real testnet badge-check, no chain, no escrow created)
# POST /deals with badge JyP9TtQC3HCNrTYR3sc2T (testnet token 0, card gone)
# → 403 "seller not verified", verification found=true active=true
#   cardHashMatches=false. See BUILD_PLAN.md progress log.
```

## Concordium components used (planned)

- **Agent Registry — CIS-8004.** Each registered agent is minted as a
  non-fungible CIS-2 token; the token stores a pointer to an off-chain Agent
  Card whose integrity is protected by an on-chain SHA-256 hash. Mainnet
  registry is contract `<10082, 0>`; **testnet registry is `<12802, 0>`**
  (verified from the DApp config 21 Nov 2026 — see `RESEARCH.md` §2).
  Testnet DApp: `https://testnet-agent-registry.concordium.com/dashboard`.
- **CIS-8 External Key Registry.** Binds a Concordium account to an external
  key (Ethereum, Solana, …). Mainnet `<10081, 0>`; **testnet `<12801, 0>`**
  (verified 21 Nov 2026).
- **Verified by Concordium badge.** The badge string is the agent's CIS-8004
  NFT token address (short Base58Check form, e.g. `Mf22so…`, or canonical
  CAIP-19 form). Verification = parse badge → `agent_of(token_id)` →
  require `status = "Active"` → fetch Agent Card at `agent_uri` → SHA-256
  must equal on-chain `metadata_hash`.
- **Hosted MCP Server** — `https://agent-registry-mcp.concordium.com/mcp`
- **x402** — HTTP 402 pay-per-call flow in the backend (Concordium facilitator
  endpoint NOT verified — see `RESEARCH.md`).
- **Protocol-Level Tokens (PLT)** — stretch goal only; v1 settles in test CCD.
- **Sponsored transactions (Protocol 10 / CIS-3)** — stretch goal only;
  registration itself is free/sponsored on the registry, per Concordium.

## Submission checklist (Checkpoint 2, due 9 Dec 23:59 UTC)

- [ ] Description (this README, shortened — the Encode Club description is already live)
- [ ] Public code repository — TODO: create a public repo for this scaffold, do NOT reuse the private NoctFinance main repo
- [ ] Demo video, up to 3 minutes
- [ ] CCDExplorer link (testnet) — TODO after deploy
- [ ] Concordium components used — list above
- [ ] Path to mainnet — see `BUILD_PLAN.md`
- [ ] Slides / Live Demo — listed as Checkpoint 2 fields on Encode Club; whether mandatory is unverified

## What is NOT in this scaffold

- No private keys, no wallet, no real CCD, no mainnet deployment.
- No NoctFinance code. NoctFinance's main repo is private and is not a
  dependency of this project.
- No claim that any contract, badge, or endpoint in here is live. Everything
  that could not be verified from public sources is marked `TODO` / `UNVERIFIED`
  in `RESEARCH.md`.
