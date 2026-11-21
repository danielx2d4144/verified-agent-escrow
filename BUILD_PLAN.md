# Build plan — Verified Agent Escrow

Solo builder, Daniel. Deadline: **Wed 9 Dec 2026, 23:59 UTC** (Checkpoint 2).
Today is 21 Nov 2026. Build window is open. Also in Daniel's week:
CS 1111 Unit 2 (Assignment + Self-Quiz) due Wed 25 Nov 11:55 PM — plan
Concordium work around that; see Step 0.

## Progress log — 21 Nov 2026 (this session)

- **Step 0 — testnet details: RESOLVED from public docs / live probes.**
  Testnet CIS-8004 `<12802, 0>`, CIS-8 `<12801, 0>`, genesis hash
  `4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796`
  (CAIP-2 `ccd:4221332d34e1694168c2a0c0b3fd0f27`) — all from the Agent
  Registry DApp config `https://agent-registry.concordium.com/config.js`.
  Testnet DApp: `https://testnet-agent-registry.concordium.com/dashboard`.
  Badge-check REST verified live on testnet (no `?network=` needed; testnet
  token 0 and token 8 badges both correctly return `badge_valid: false`
  for real reasons — card gone / hash null). Indexer verified (1102 Active
  testnet agents). CCDScan + CCDExplorer testnet homepages verified (HTTP
  200); contract/tx deep-link patterns NOT verified (guessed patterns 404).
  EURQ PLT exists on testnet but no token ID / faucet verified — v1 stays
  CCD. MCP live behaviour NOT verified (`initialize` probe returned no
  response). All recorded in `RESEARCH.md` §2/§3/§5/§6/§8.
- **Rust toolchain installed:** rustc/cargo 1.100.0, `wasm32v1-none`
  target added. `cargo-concordium` 5.0.0 installed — see next bullet.
- **cargo-concordium 5.0.0 INSTALLED 21 Nov 2026** (after a 27-min retry
  build). First attempt failed on a full 512 MB /tmp ("error writing to
  /tmp/cc*.s: No space left on device"); retry used
  `TMPDIR=$HOME/cargo-tmp/tmp` and
  `CARGO_BUILD_BUILD_DIR=$HOME/cargo-tmp/cargo-install` (build dir now
  under $HOME, 1.4 GB). **Lesson for this VM: never build Rust/C++ in
  /tmp — always set TMPDIR under $HOME.** No prebuilt binary exists;
  `cargo install --locked cargo-concordium` is the official install path.
- **Contract (Step 1): rewritten, builds clean** — see lib.rs header.
  `cargo concordium build` succeeds: 27,472 B module, 968 B schema
  (init + event + `create_escrow` / `confirm_delivery` / `refund` /
  `view`), wasm at
  `contracts/escrow/target/concordium/wasm32v1-none/release/verified_agent_escrow.wasm`,
  SHA-256 `7843711fb7fa51d0d9515f9865b3aec3be487f2fde614eb94e5762a95afd8a52`.
  `cargo concordium test --out concordium-out/module.wasm.v1` passes
  **9/9 wasm unit tests + 6/6 integration tests** (21 Nov 2026).
  Key fix found by the build: `Cargo.toml` default features must stay
  EMPTY — `cargo concordium build` does not disable them, and a
  default-on `std` breaks the wasm build with 86 errors (verified).
  `cargo check --target wasm32v1-none --no-default-features` and host
  `cargo check` also pass, zero warnings. Lesson from the tests: the
  wasm test host does **not** support `invoke_transfer`, so release/
  refund state transitions were extracted into pure `Escrow::release()` /
  `Escrow::refund()` methods (tested directly); the `#[receive]`
  wrappers only transfer + log the event. `WasmModule` is not
  re-exported by `concordium-smart-contract-testing`, so the integration
  test (`tests/escrow.rs`) infers the module type instead of naming it.
  **Still open:** deploy (Step 2, needs Daniel).
- **Backend (Step 3): wired end-to-end in local mode** — `verify.ts`
  (real REST badge-check, no `?network=`), `escrow.ts` (local DealStore +
  honest testnet-mode error), `x402.ts` (real 402 challenge; payment proof
  never accepted), `audit.ts` (JSON audit log, verification events),
  `index.ts` (Fastify: `POST /deals`, `/deals/:id/deliver`,
  `/deals/:id/refund`, `GET /deals/:id`, `/deals/:id/audit`, `GET /quote`
  → 402), `demo.ts` (labelled local smoke script, verification stubbed
  only there). `npx tsc --noEmit` clean, `npm run demo` passes all 4 steps,
  live server smoke test passed: real testnet badge (token 0, card gone)
  → 403 refused, no escrow created. `.env.example` updated with the
  verified testnet values.
  **Backend tests — done 21 Nov 2026: 13/13 pass** (`npm test` in
  `backend/`; `dealflow.ts` is the testable deal-flow core, handlers in
  `index.ts` delegate to it). Covered: verify-before-deal (verified opens
  a Funded escrow, unverified refused with no escrow), re-verify at
  delivery (verified releases, revoked refunds with reason
  `badge_revoked`), 409/403 error statuses, audit-log order with the
  verification attached, `parseVerificationResponse` (all checks pass /
  hash mismatch / inactive / registry mismatch), and fail-safe on an
  unreachable badge-check endpoint. Two fixes along the way: `DealError`
  now carries `httpStatus` (404/409/403/400), and the unreachable-endpoint
  test must run first with a dynamic import — `verify.ts` reads
  `BADGE_CHECK_URL` at module load, so a static import loads it before
  any test can override the URL. Live smoke test re-run after the
  `index.ts` refactor (21 Nov 2026): `/quote` → 402, unknown deal → 404,
  bad badge → 403 with real testnet verification.
- **Still needs Daniel himself (cannot be done in the workspace):**
  Concordium Wallet for Web, testnet identity + account, test CCD from the
  faucet, register three test agents (buyer, good seller, revocable seller)
  via the testnet DApp, record their badge strings. Then deploy (Step 2).

## Step 0 — Set up, and close the known unknowns (21–23 Nov)

- [x] Install Rust + `cargo-concordium` + `concordium-client`, per
  https://docs.concordium.com/en/mainnet/tutorials/setup-env.html
  (`rustup target add wasm32v1-none`, `cargo install --locked cargo-concordium`).
  Rust 1.100.0 + `wasm32v1-none` installed 21 Nov 2026; `cargo-concordium`
  **5.0.0 installed 21 Nov 2026** (27-min build; first attempt failed on a
  full /tmp — see progress log). `concordium-client` still to install.
- [ ] Concordium Wallet for Web, testnet identity + account. **Needs Daniel.**
- [ ] Get test CCD:
  `curl -X PUT https://wallet-proxy.testnet.concordium.com/v0/testnetGTUDrop/<ACCOUNT>`
  **Needs Daniel's account.**
- [ ] Register three test agents (buyer, good seller, revocable seller) in
  the Agent Registry on testnet, via the testnet DApp
  `https://testnet-agent-registry.concordium.com/dashboard`. Record all
  badge strings. **Needs Daniel.** (Two-agent minimum; three so the
  revocation demo leaves the good seller usable.)
- [x] Verify the badge-check path with curl against a real testnet badge:
  REST works with no parameter (see progress log above). MCP live
  behaviour still unverified — do not retry the probe unless Daniel asks.
- [x] Finish Workshop 2 (18% watched) — all 5 lectures completed 21 Nov 2026
  (5/5, "On Track!"). Checkpoint 1 due Mon 23 Nov 00:59 WAT; no explicit
  complete status is shown on the dashboard — do not claim it is marked complete.

## Step 1 — Escrow contract, local tests only (23–26 Nov)

- [x] `contracts/escrow/`: implement `create_escrow`, `confirm_delivery`,
  `refund`, `view` from the skeleton in this repo. Keep the v1 trust model:
  only the buyer can call `confirm_delivery` (release), only the buyer or a
  designated arbiter can call `refund`, and only before release.
  **Done 21 Nov 2026** — rewritten with the piggy-bank APIs
  (`ctx.sender()` / `matches_account`, `invoke_transfer`, `self_balance`,
  `enable_logger` + `logger.log(&Event::…)?`), `concordium-std` 11.
  Deadline stored, not enforced on-chain in v1 (backend enforces expiry).
  `cargo concordium build` passes (27,472 B module) — see progress log.
- [x] `cargo concordium test` — unit tests for: create → release pays seller;
  create → refund pays buyer; release twice fails; refund after release
  fails; non-buyer cannot release; expired escrow can be refunded.
  **Done 21 Nov 2026 — 9/9 wasm unit tests pass** in
  `contracts/escrow/src/lib.rs` under `#[concordium_cfg_test]` /
  `#[concordium_test]` (concordium-std 11), covering create/view/error
  paths plus the six cases above and zero-amount / contract-sender
  creates. **Plus 6/6 integration tests pass** in
  `contracts/escrow/tests/escrow.rs` (dev-dependency
  `concordium-smart-contract-testing = "5"`; run with
  `cargo concordium test --out concordium-out/module.wasm.v1`), which
  deploy the real wasm module in a simulated chain and check balances
  and transfer traces, not just state. Fixes found by writing them: the
  wasm test host does not support `invoke_transfer` (pure
  `Escrow::release()` / `Escrow::refund()` extracted — see progress log),
  and `WasmModule` is not re-exported by the testing crate (type
  inferred in `setup()`).
- [ ] Do NOT add an in-contract registry call in v1 (unverified — see
  RESEARCH.md #10). The contract records the seller badge string as data
  and emits it in events; the backend does the verification.
- [ ] Risk: Concordium contract API details (e.g. `Amount`, transfer calls)
  differ from the skeleton's assumptions. Mitigation: build against the
  `counter` / `piggy-bank` tutorials first; copy their exact patterns.

## Step 2 — Deploy to testnet, get the CCDExplorer link (26–28 Nov)

- [ ] `cargo concordium build`, deploy with `concordium-client` to testnet,
  initialise one escrow instance, run one create → release on-chain.
  **Needs Daniel:** a funded testnet account (wallet + identity + faucet)
  to deploy from. After deploy, confirm the explorer deep-link pattern
  from the explorer site itself (guessed `/testnet/contract/<index>`
  patterns returned 404 on 21 Nov 2026).
- [ ] Record: module reference, contract index/subindex, instance address,
  transaction hashes, and the CCDExplorer (testnet) link. Fill them into
  `README.md` and `.env.example`. Testnet explorer homepage verified:
  `https://ccdexplorer.io/testnet` (HTTP 200, 21 Nov 2026).

## Step 3 — Backend: badge verify + escrow API + audit log (28 Nov – 2 Dec)

- [x] `backend/`: implement `verify.ts` against the MCP server (or the REST
  endpoint, whichever Step 0 proved works on testnet). Return
  `{ found, active, cardHashMatches, verified, owner, agentUri }`.
  Cache nothing that would hide a revocation — re-check at delivery time.
  **Done 21 Nov 2026 — REST, which Step 0 proved works on testnet.**
  `verify.ts` calls the REST endpoint with no `?network=` parameter and
  returns a safe false-verdict on HTTP error. `verifyBadgeMcp()` throws
  (MCP live behaviour unverified). `npx tsc --noEmit` clean.
- [x] Implement the deal flow: `POST /deals` (verify seller → create escrow),
  `POST /deals/:id/deliver` (re-verify badge → release), `POST /deals/:id/refund`
  (re-verify → refund if revoked/expired). Every step appends to the audit
  log and mirrors the contract event.
  **Done 21 Nov 2026 in local mode** (`ESCROW_MODE=local`, default):
  in-memory DealStore enforces Funded → Released | Refunded, no
  double-release, no refund after release, only buyer releases,
  only buyer/arbiter refunds. Each deal records the exact contract call
  that *would* be made, with `settledOnChain: false`. `ESCROW_MODE=testnet`
  throws a specific error naming the missing SDK wiring — no chain call is
  faked. Live smoke test passed (real testnet badge refused, 403).
  **Still open:** wire `ESCROW_MODE=testnet` to the real contract once
  Step 2 deploys (needs `@concordium/node-sdk` + a funded account).
- [x] x402-style flow: `GET /quote` returns HTTP 402 with price/asset/
  recipient when unpaid, accepts the payment proof on retry, returns a
  `PAYMENT-RESPONSE`-style receipt. Label it "x402-style" in code and docs
  until a real Concordium facilitator is confirmed (RESEARCH.md §5).
  **Done 21 Nov 2026, with one honest correction:** `GET /quote` returns
  the 402 challenge, but `verifyPaymentProof()` **never accepts a payment
  header as proof** (no verified facilitator to check it against) — it
  returns `{verified: false, reason: …}`. The v1 receipt is the escrow
  funding transaction / EscrowCreated event once deployed. Fix this
  properly only when a real facilitator endpoint is verified (office
  hours Tue/Fri 15:00 UTC, 24 Nov – 8 Dec).
- [x] Backend tests: `backend/src/dealflow.test.ts` — verify-before-deal,
  re-verify at delivery, refund on revocation, audit log entries.
  **Done 21 Nov 2026 — 13/13 pass** (`npm test`). Deal-flow core
  extracted into `dealflow.ts` so tests run without network; handlers in
  `index.ts` delegate to it and preserve the HTTP statuses (see progress
  log). Live smoke test re-run after the refactor: `/quote` → 402,
  unknown deal → 404, bad badge → 403 with real testnet verification.
- [ ] Agent Cards: host `examples/agent-card.json` (filled in with the real
  testnet badges) at `/.well-known/agent-card.json` and pin the SHA-256
  on-chain via `setAgentURI` (see badge docs). **Needs Daniel's test
  agents (Step 0) first.**
- [x] Risk: the hosted MCP/REST endpoint behaves differently on testnet.
  Mitigation: cross-check with AgentGate's preview endpoint
  (`…/v1/check-agent/preview?id=<badge>&network=testnet`) during testing;
  do not ship AgentGate as a dependency. **Resolved for REST** — verified
  live on testnet 21 Nov 2026 (see progress log). MCP still unverified.

## Step 4 — Demo + submission pack (3–7 Dec)

- [ ] End-to-end demo script (`demo/DEMO_SCRIPT.md`): the 4 steps in the
  README — refused unverified seller, escrow funded, release on delivery,
  refund on revocation. Record it in one take, ≤ 3 minutes.
- [ ] Public code repo: create a **new public repo** for this project
  (do NOT reuse the private NoctFinance main repo, and do NOT make any
  private repo public). Push this scaffold + the built contract + backend.
  Add a short README at the repo root pointing at this README.
  **Ready 21 Nov 2026:** local git repo initialised in the scaffold
  folder with a clean `.gitignore` (no secrets/keys/.env present) and an
  initial commit — **not pushed anywhere yet**. Pushing to GitHub needs
  Daniel (new public repo creation + his go-ahead).
- [ ] Slides (if mandatory — unverified) + path-to-production note:
  mainnet = same contract + registry on mainnet (`<10082,0>`), real
  identity verification, PLT settlement, PLL when it ships (Jan/Mar 2027),
  sponsored transactions so users never hold CCD.
- [ ] Submit on Encode Club well before the deadline — the platform locks
  at 9 Dec 23:59 UTC. Submit early; do not leave it to the last evening.

## Step 5 — Buffer (8–9 Dec)

- [ ] Re-run the full demo from a clean checkout. Fix only what breaks the
  demo. No new features in the buffer.
- [ ] Final check: description, public repo, demo video, CCDExplorer link,
  components used, path to mainnet — all five, plus Slides/Live Demo if
  they turn out to be required.

## Dependencies

- Rust toolchain + `cargo-concordium` + `concordium-client`
- Concordium Wallet for Web (testnet) + test CCD from the faucet
- Node.js 20+ + TypeScript + Fastify (backend) — matches Daniel's existing stack
- Two registered testnet agents (buyer + seller) with badges
- A place to host the Agent Cards (any static host / the backend itself)

## Risks (ranked)

1. **Testnet registry / MCP details differ from mainnet docs** — largely
   resolved 21 Nov 2026: testnet registry `<12802, 0>`, CIS-8 `<12801, 0>`,
   genesis hash, REST badge-check, indexer, and DApp URL are all verified.
   **Still open:** MCP live behaviour and explorer deep-link patterns.
2. **No verified Concordium x402 facilitator** — the "pay and get paid"
   pillar is then demonstrated as an x402-style flow + on-chain escrow, not
   a live facilitator settlement. Say so honestly in the submission; do not
   fake a facilitator.
3. **PLL is not live** — escrow is a smart contract, with the honeypot caveat
   Concordium itself warns about. Mitigation: keep the contract minimal,
   audited-by-reading, and say in the submission that PLL replaces it on
   mainnet.
4. **Time** — CS 1111 Unit 2 (due 25 Nov) and the 5 Encode Club lectures
   compete for the same week. Mitigation: Step 0–1 are small; the demo is
   4 steps, not a full product.
5. **Badge revocation in the demo** — revoking a real testnet badge on camera
   needs a second seller agent, so the "good" demo agent stays usable.
   Register three test agents (buyer, good seller, revocable seller).

## Path to mainnet (for the submission)

Same contract and backend, with: mainnet registry `<10082,0>` / CIS-8
`<10081,0>`; real Concordium ID verification for owners; settlement in a
PLT stablecoin instead of CCD; sponsored transactions so end users never
hold CCD; PLL (Simple Jan 2027 / Enhanced Mar 2027) replacing the smart
contract escrow; and an audit-trail export for EU AI Act Article 12
record-keeping. Real users: marketplaces / API sellers who want to sell to
agents without taking payment risk from an unverified counterparty.
