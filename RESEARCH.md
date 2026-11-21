# Research — Verified Agent Escrow

Researched 21 Nov 2026 from public sources only. No Encode Club sign-in, no
GitHub write, no submission was made. Citations are the exact URLs returned by
search / page fetch at the time; if a link has moved, re-check the docs index
at https://docs.concordium.com/ first.

## 1. The hackathon brief — what judges look for

Source: https://www.concordium.com/article/concordium-trusted-agents-hackathon-encode-club

- Free six-week online programme, 2 Nov – 9 Dec 2026. Build window 19 Nov –
  9 Dec, on testnet. Checkpoint 1 (project, team, idea) 22 Nov; submissions
  close 9 Dec 23:59 UTC; judging 10–11 Dec.
- "Take an agent you already run … and make it accountable: it should prove
  that a verified human stands behind it, pay and get paid on its own, and
  keep a record of what it did. At the centre is the Verified by Concordium
  badge."
- Five starting points (not fixed tracks): (1) add badge + ERC-8004 + x402 to
  an agent you already run; (2) agents check each other's badge over MCP/A2A
  before dealing; (3) gate a service on a proven attribute, e.g. age, without
  storing personal data; (4) agents pay each other for data/APIs/work, with
  sponsored fees; (5) audit trails supporting EU AI Act record keeping.
- Judging: "Encode and Concordium look at how deeply a project uses Concordium
  identity, the Agent Registry and agent payments, whether it has a believable
  route to mainnet and real users, whether the core flow works end to end, and
  whether it solves a real problem." Test tokens are free, so transaction
  counts play no part.
- Submission needs: description, public code repository, demo video up to
  3 minutes, a CCDExplorer link, and a short plan for going live.
- "Grants go to projects with real usage rather than the best pitch, and a
  credible path to production here is what puts a team in view" (75M CCD
  grants programme). Prizes: 1M CCD each for 1st/2nd/3rd (per Encode Club
  programme page, as previously recorded).

## 2. Agent Registry — CIS-8004 / CIS-8

Sources:
- https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/index.html
- https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/concordium-badge.html
- https://www.concordium.com/article/the-agent-registry-explained
- https://eips.ethereum.org/EIPS/eip-8004 (ERC-8004, draft)

Findings, verified:
- CIS-8004 is the core agent registry. Each registered agent is minted as a
  non-fungible CIS-2 token. The token stores a pointer to an off-chain Agent
  Card whose integrity is protected by an on-chain SHA-256 hash, plus an
  extensible key-value metadata store (e.g. the agent's payment wallet).
- CIS-8 is the cross-chain key registry: a cryptographically-proven binding
  between a Concordium native account and an external public key (Ethereum,
  Solana, …). CIS-8 entries can be attached to CIS-8004 agents as an
  `external_reference`.
- CIS-8004 is compatible with ERC-8004. ERC-8004 has three registries
  (Identity / Reputation / Validation); its Identity Registry is an ERC-721
  whose `tokenURI` points to a registration file. Concordium's difference:
  registration is tied to an identity-verified owner account.
- Mainnet contracts (verified on the docs index page):
  - CIS-8004 Agent Registry `<10082, 0>`, module
    `ba03e95330de2ad70cb8551d132bc7afe291b22068172a44e3a00dc09b63855f`
  - CIS-8 External Key Registry `<10081, 0>`, module
    `08f71acbd16cdaca1e4184dbbc59b773ffc8f93c76fe2e56bfbd50bfcbee9d1d`
- **Testnet contracts — VERIFIED 21 Nov 2026** from the Agent Registry
  DApp's own config, fetched live:
  `https://agent-registry.concordium.com/config.js`
  (`window.AGENT_REGISTRY_UI_CONFIG.networks.testnet`):
  - CIS-8004 Agent Registry **`<12802, 0>`**
  - CIS-8 External Key Registry **`<12801, 0>`**
  - Testnet genesis hash
    `4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796`
    → CAIP-2 chain id `ccd:4221332d34e1694168c2a0c0b3fd0f27`
    (first 32 hex chars of the genesis hash).
  - Sponsor service: `https://registry-sponsor-service.concordium.com/sponsor`
- **Agent Registry DApp URLs — verified 21 Nov 2026:**
  - Mainnet: `https://agent-registry.concordium.com/` (also the target of
    `https://www.concordium.com/register-your-agent`, HTTP 301).
  - Testnet: `https://testnet-agent-registry.concordium.com/dashboard`
    (from the DApp config's `networkRedirects.testnet`).
  - Registration is via the DApp / MCP server; the DApp config confirms
    the testnet registry it talks to is `<12802, 0>`.
- An agent gets a W3C DID (`did:ccd`) anchored on Concordium, tied to a
  Concordium account anchored to a verified human/business.
- Registration: "a few clicks" via the Agent Registry DApp / MCP server;
  "free for Concordium-native wallets" / "free of charge" per Concordium —
  registration is sponsored, so the developer never acquires CCD for it
  (see §5).

## 3. Verified by Concordium badge — how verification actually works

Source: https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/concordium-badge.html

Verified steps (this is the checklist the backend's `verify.ts` implements):
1. Parse the Base58Check badge string into `(contract, token_id)`.
   MCP tool: `parse_token_address`. Encoding helpers in `@concordium/web-sdk`:
   `tokenAddressToBase58` / `tokenAddressFromBase58`.
2. Confirm the contract implements CIS-8004 and is a registry the app trusts.
   Official mainnet registry is `<10082, 0>`.
3. Resolve on-chain with CIS-8004 `agent_of(token_id)` — returns owner
   account, agent wallet, status, `agent_uri`, `metadata_hash`. Require
   `status = "Active"`. MCP tools: `agent_by_token_address` / `agent_of`.
4. Check card integrity: fetch the Agent Card at `agent_uri`, SHA-256 its
   canonical bytes, require equality with on-chain `metadata_hash`.
   MCP tool: `verify_agent_card`.
5. (Optional) Confirm an external key bound via CIS-8.
- A passing check proves: registered, currently active, owned by an
  accountable Concordium account, and the published card is exactly the one
  committed on-chain.
- Badge forms: short Base58Check, e.g. `Mf22soLh1NuZYFgBK8iSs`; canonical
  CAIP-19, e.g. `ccd:9dd9ca4d19e9393877d2c44b70f89acb/cis-2:Mf22soLh1NuZYFgBK8iSs`
  (mainnet genesis prefix `9dd9ca4d19e9393877d2c44b70f89acb` — **do not reuse
  this prefix on testnet; testnet CAIP-2 chain id is
  `ccd:4221332d34e1694168c2a0c0b3fd0f27`, from the testnet genesis hash
  `4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796`,
  verified from the DApp config 21 Nov 2026**).
- Badge in an Agent Card: an A2A extension in `capabilities.extensions`,
  URI `https://docs.concordium.com/a2a-extensions/concordium-badge/v1`,
  with `params.tokenAddress`, `params.owner.account` (CAIP-10),
  `params.contracts.{cis8004, cis8}` (CAIP-10), `params.verify`, and an
  optional `params.verification` block (`service`, `verifyUrl`, `mcp`, `docs`).
  Also an ERC-8004 `registrations` entry: `{"agentId": <token id as number>,
  "agentRegistry": "ccd:<genesis>:<index>.<subindex>"}`.
- Hosted resolver (official, example values in the docs — the example badge
  `Mf22soLh1NuZYFgBK8iSs` is a real mainnet example, NOT Daniel's agent):
  - REST: `GET https://agent-registry-mcp.concordium.com/v1/badge-check/<badge>`
    (the docs also show `/v1/check-badge/<badge>`,
    `/v1/get-badge-JSON/<badge>`, and
    `/v1/build-set-agent-uri/<badge>?metadata_hash_hex=…&sender=…`)
  - MCP: `https://agent-registry-mcp.concordium.com/mcp`, tools including
    `parse_token_address`, `token_address`, `agent_by_token_address`,
    `agent_of`, `verify_agent_card`, `get_badge_json`, `build_agent_card`,
    `build_agent_badge`.
  - **VERIFIED on testnet 21 Nov 2026, live probes:** the same
    `/v1/badge-check/<badge>` endpoint works on testnet with **no query
    parameter** — the network is resolved from the badge itself. `?network=testnet`
    is accepted and echoed as `queried_network`, but is redundant; for a
    mainnet badge queried with it, the response warns it was verified
    against mainnet. Testnet token 0 badge `JyP9TtQC3HCNrTYR3sc2T` →
    `network: "testnet"`, `expected.contracts: {cis8004: "12802,0",
    cis8: "12801,0"}`, `on_chain_agent_found: true`,
    `status_active: true`, but `badge_valid: false` because that old test
    agent's card URL 404s and its on-chain metadata_hash no longer
    matches. Testnet token 8 badge `JyP9U3A3VVBoVTSm7QdSw` → card fetched
    (HTTP 200) but on-chain `metadata_hash_hex: null` and card badge
    malformed, so also `badge_valid: false`. A fully valid testnet badge
    needs a properly registered agent with an anchored card hash —
    Daniel's own agents, once registered via the testnet DApp.
  - **NOT verified:** the hosted MCP server's live behaviour. An MCP
    `initialize` probe on 21 Nov 2026 returned no response, and that
    probe run hit a timed-out approval and was not retried — do not
    retry it unless the user asks. REST is the v1 badge-check path, and
    the backend's `verifyBadgeMcp()` throws rather than falling back.

## 4. Agent Card / ERC-8004 registration file

Sources: badge docs (§3), https://eips.ethereum.org/EIPS/eip-8004

- ERC-8004 registration-v1 document: `type`
  `https://eips.ethereum.org/EIPS/eip-8004#registration-v1`, `name`,
  `description`, `image`, `services[]` (A2A / MCP endpoints + versions),
  `x402Support`, `active`, `registrations[]`.
- Concordium's Agent Card is the combined document satisfying both ERC-8004
  and A2A at once (per badge docs). `examples/agent-card.json` in this repo
  follows that shape, with placeholders.
- The card is hosted at `agent_uri` (e.g. `https://…/.well-known/agent-card.json`),
  and its SHA-256 is pinned on-chain via `setAgentURI`. Between hosting and
  pinning, card and hash disagree — host at a new versioned URL and pass
  `agent_uri` + `metadata_hash_hex` in one transaction (per docs).

## 5. x402, Protocol-Level Tokens, sponsored transactions, PLL

Sources:
- https://www.concordium.com/article/concordium-trusted-agents-hackathon-encode-club
- https://www.concordium.com/agent-to-agent-settlement
- https://www.concordium.com/roadmap
- https://www.concordium.com/article/sponsored-transactions-who-pays-the-fee
- https://www.concordium.com/solution/stablecoin-issuer

Verified:
- x402 is the HTTP 402 pay-per-call standard: client calls without payment →
  server answers HTTP 402 with price/asset/recipient → client signs a payment
  and retries with the payment header → a facilitator verifies and settles
  on-chain → server releases the resource. (General x402 flow; Concordium
  articles confirm x402 "handles payments between agents, with fees
  sponsored so users never hold tokens".)
- Protocol-Level Tokens (PLTs): tokens issued natively at the protocol layer,
  not in smart contracts. Stablecoins on Concordium run as PLTs.
- Sponsored transactions (Protocol 10, Mar 2026): the account that sends a
  transaction is separated from the account that pays for it. A facilitator
  can act as sponsor, so an agent holding a stablecoin can pay without ever
  holding CCD. Agent Registry registration runs on sponsored transactions
  and is free for the developer.
- Protocol-Level Locks (PLL): protocol-enforced escrow — funds stay in the
  principal's custody, ring-fenced to pre-defined destinations, released only
  when conditions are met. **BUT: PLL is NOT available for this hackathon.**
  Concordium's settlement page says "Protocol-Level Locks are coming soon",
  and its roadmap lists "Protocol Level Locks: Simple — Jan 2027" and
  "Enhanced — Mar 2027". The escrow in this project must therefore be a
  smart contract in v1. Do not claim PLL in the submission, demo, or README
  as if it were live.

UNVERIFIED — do not invent:
- **No official Concordium x402 facilitator endpoint was found** in the
  public docs searched. There is no verified URL, scheme, or asset list for
  a Concordium-hosted x402 facilitator on testnet. The backend in this repo
  therefore implements the x402 *shape* (402 challenge → signed payment →
  retry → receipt) with settlement via the escrow contract in test CCD, and
  flags a real facilitator integration as a TODO to confirm at office hours
  (Tue/Fri 15:00 UTC, 24 Nov – 8 Dec) or from Workshop 3 materials.
- **Testnet PLT stablecoin — exists, but no usable token ID verified.**
  EURQ, a MiCA-licensed euro stablecoin from Quantoz Payments, is live on
  Concordium testnet, with mainnet targeted December 2026 (Concordium CEO
  video 30 Oct 2026; KuCoin article). **No PLT token ID, faucet, or usage
  details for EURQ on testnet were verified** — v1 still settles in test
  CCD; PLT settlement stays a stretch goal.
- Sponsored-transaction integration details for this project's own backend
  (CIS-3) were not verified beyond the general mechanism. The Concordium
  dApp examples repo has a `sponsoredTransactions` example — see §6.

## 6. Smart contracts, testnet, faucet, explorer

Sources:
- https://docs.concordium.com/en/mainnet/tutorials/setup-env.html
- https://docs.concordium.com/en/mainnet/docs/resources/exchangeOnBoarding.html
- https://github.com/concordium/concordium-rust-smart-contracts/blob/HEAD/examples/README.md
- https://github.com/Concordium/concordium-dapp-examples/blob/main/README.md?raw=true

Verified:
- Smart contracts are written in Rust, compiled to Wasm, with
  `cargo-concordium` (`cargo install --locked cargo-concordium`,
  `rustup target add wasm32v1-none`, `cargo concordium init`,
  `cargo concordium test`, `cargo concordium build`). `concordium-std`
  is the contract library. Example contracts (not production-safe):
  auction, piggy-bank, voting, cis2-multi, sponsoredTransactions, etc.
  dApp examples include `sponsoredTransactions`,
  `sponsoredTransactionsAuction`, `piggybank`, `wCCD`, `trackAndTrace`.
- Public testnet node: `grpc.testnet.concordium.com`, port `20000`
  (gRPC v2 / gRPC-web, TLS). No identity verification needed on testnet.
- Testnet CCD faucet (verified in docs):
  `curl -X PUT https://wallet-proxy.testnet.concordium.com/v0/testnetGTUDrop/<YOUR_ACCOUNT_ADDRESS>`
  — one drop per account (per docs).
- Wallet: Concordium Wallet for Web (Chrome/Brave/Edge/Opera), testnet
  identity from the testnet identity provider.
- CCDExplorer: open-source explorer at `ccdexplorer.io` (GitHub:
  https://github.com/ccdexplorer). Mainnet explorer base is
  `https://ccdexplorer.io/mainnet` (from a Rust SDK doc page).
  **Testnet homepage verified 21 Nov 2026:** `https://ccdexplorer.io/testnet`
  returns HTTP 200. CCDScan, the docs-linked explorer, is at
  `https://ccdscan.io/` (HTTP 200, has a Mainnet/Testnet selector).
  **UNVERIFIED:** deep-link URL patterns for a contract/tx page —
  `https://ccdscan.io/testnet/contract/12802`,
  `https://ccdexplorer.io/testnet/contract/12802` and
  `.../testnet/contract/12802-0` all returned 404 on 21 Nov 2026. Do not
  put a guessed deep link in the submission; confirm the pattern from the
  explorer site after deploy.

## 7. Third-party helper — AgentGate (NOT a Concordium official service)

Sources:
- https://medium.com/@cryptomoneymakr/verify-an-ai-agent-before-it-pays-your-api-x402-mcp-488346e9b9b1
- https://dev.to/cryptomoneymakr/verifying-an-ai-agents-identity-before-paying-it-registries-agent-cards-and-their-limits-18gg

- AgentGate (`concordium-agentgate` on npm, MIT) wraps the three badge
  checks (`found`, `active`, `cardHashMatches`) into one call / one MCP
  tool `check_agent`, plus Express middleware. Its hosted preview is
  `https://agentgate.agentgate.workers.dev/v1/check-agent/preview?id=<badge>`
  (free, 20 req/min/IP; add `&network=testnet` for test registries, per
  that write-up).
- This is a **third-party** tool, not Concordium's, and it reads the
  Concordium registry only. It is useful as a reference implementation and
  a cross-check, not as a dependency to trust blindly. The scaffold's
  backend implements the checks directly against Concordium's MCP/REST
  endpoints instead, and can cross-check against AgentGate during testing.
- Note the same write-up's warning: a registry check proves the badge is
  registered/active/card-matched; it does **not** prove the caller in front
  of you controls the badge. For the demo, the seller agent presents its
  badge and the escrow contract / backend records the badge that was
  checked — possession proof (e.g. a signature from the agent wallet) is
  listed as a hardening step in `BUILD_PLAN.md`, not claimed as done.

## 8. What is still UNVERIFIED (complete list)

**Resolved 21 Nov 2026 (see §2, §3, §6):** testnet CIS-8004 `<12802, 0>`,
testnet CIS-8 `<12801, 0>`, testnet genesis hash, badge-check on testnet
(no parameter needed), testnet CCDExplorer homepage
(`https://ccdexplorer.io/testnet`), testnet Agent Registry DApp URL
(`https://testnet-agent-registry.concordium.com/dashboard`), and the
agent indexer working on testnet (1102 Active testnet agents).

Still open:
6. Any official Concordium x402 facilitator endpoint, supported assets, or
   scheme on testnet.
7. Any testnet PLT (stablecoin) token ID / faucet / usage details — EURQ
   exists on testnet (see §5), but no token ID was verified.
9. Whether Checkpoint 2's "Slides" and "Live Demo" fields are mandatory.
10. Whether the escrow contract can (or should) call CIS-8004 `agent_of`
    directly on-chain, and the exact cross-contract call shape for that.
11. How Checkpoint 1 is internally marked complete on Encode Club (no
    explicit status is shown on the dashboard — previously verified).
13. The hosted MCP server's live behaviour (`initialize` probe returned no
    response 21 Nov 2026).
14. Explorer deep-link URL pattern for a contract / transaction page (both
    guessed patterns returned 404).

First build step for each: try it with `curl` / the DApp on testnet with a
real testnet badge, or ask at Encode Club office hours (Tue/Fri 15:00 UTC,
24 Nov – 8 Dec). Do not guess any of these into code or the submission.
