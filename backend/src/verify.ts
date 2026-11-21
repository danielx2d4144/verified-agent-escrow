/**
 * Badge verification — the core trust check.
 *
 * Implements the 5 steps from the Concordium badge docs
 * (https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/concordium-badge.html):
 *   1. parse badge string -> (contract, token_id)
 *   2. confirm the contract implements CIS-8004 and is trusted
 *   3. CIS-8004 `agent_of(token_id)` -> owner, agent wallet, status,
 *      agent_uri, metadata_hash; require status == "Active"
 *   4. fetch Agent Card at agent_uri, SHA-256 it, require == metadata_hash
 *   5. (optional) confirm an external key via CIS-8
 *
 * v1 uses the hosted REST badge-check endpoint, which runs those steps
 * server-side and returns a JSON verdict.
 *
 * VERIFIED on testnet, 21 Nov 2026 (live probes, not docs alone):
 * - `GET https://agent-registry-mcp.concordium.com/v1/badge-check/<badge>`
 *   works with NO query parameter: the network is resolved from the badge
 *   itself (docs: "the network is resolved from the badge"). Adding
 *   `?network=testnet` is accepted and echoed as `queried_network`, but
 *   is redundant — the response for a testnet badge is identical with or
 *   without it, and for a mainnet badge queried with `?network=testnet`
 *   it warns "this is a `mainnet` badge; you queried `testnet` — verified
 *   against `mainnet`".
 * - Testnet registry contracts, from the DApp config
 *   (https://agent-registry.concordium.com/config.js):
 *   CIS-8004 `<12802, 0>`, CIS-8 `<12801, 0>`, testnet genesis hash
 *   `4221332d34e1694168c2a0c0b3fd0f273809612cb13d000d5c2e00e85f50f796`
 *   (CAIP-2 chain id `ccd:4221332d34e1694168c2a0c0b3fd0f27`).
 *   The badge-check response's `expected.contracts` for a testnet badge
 *   is `{cis8004: "12802,0", cis8: "12801,0"}` — this code requires it.
 * - Response shape verified live (testnet token 0, badge
 *   `JyP9TtQC3HCNrTYR3sc2T`): `on_chain_agent_found: true`,
 *   `status_active: true`, owner `3dt3UMPz…`, `network: "testnet"`,
 *   but `badge_valid: false` because that old test agent's card URL
 *   404s and its on-chain `metadata_hash` no longer matches — the
 *   endpoint correctly fails a badge whose card is gone. A badge is
 *   only `verified` here when found && active && card-hash-matches.
 * - The hosted MCP server (`https://agent-registry-mcp.concordium.com/mcp`)
 *   is NOT verified by a live probe in this repo: an MCP `initialize`
 *   probe on 21 Nov 2026 returned no response (that probe run also hit a
 *   timed-out approval and was not retried). The MCP tools are listed in
 *   the badge docs (`parse_token_address`, `agent_by_token_address`,
 *   `agent_of`, `verify_agent_card`), but until a live MCP call succeeds,
 *   REST is the v1 path and MCP is a fallback TODO. Do not claim MCP
 *   works until it is probed again.
 */

export type VerificationResult = {
  badge: string;
  found: boolean;
  active: boolean;
  cardHashMatches: boolean;
  verified: boolean;
  owner?: string;
  agentUri?: string;
  checkedAt: string;
  network?: string;
  issues: string[];
};

const BADGE_CHECK_URL =
  process.env.BADGE_CHECK_URL ??
  "https://agent-registry-mcp.concordium.com/v1/badge-check";

/** Expected registry contracts for the configured network. */
export function expectedContracts(): { cis8004: string; cis8: string } {
  const network = process.env.CONCORDIUM_NETWORK ?? "testnet";
  if (network === "mainnet") return { cis8004: "10082,0", cis8: "10081,0" };
  // testnet — verified from the Agent Registry DApp config, 21 Nov 2026.
  return { cis8004: "12802,0", cis8: "12801,0" };
}

type BadgeCheckResponse = {
  token_id?: number;
  token_address?: string;
  agent_uri?: string;
  http_status?: number;
  card_sha256?: string;
  on_chain?: {
    owner_account?: string;
    status?: string;
    agent_uri?: string;
    metadata_hash_hex?: string | null;
  };
  checks?: Record<string, unknown>;
  badge_valid?: boolean;
  issues?: Array<{ severity?: string; field?: string; message?: string }>;
  network?: string;
  queried_network?: string;
  expected?: { chain?: string; contracts?: { cis8004?: string; cis8?: string } };
};

/**
 * Map the live badge-check response to our verdict. Pure function, so it
 * is testable without a network call. `verified` requires all three:
 * found on-chain, status Active, and card SHA-256 == on-chain metadata_hash.
 * A badge whose card is gone or was never anchored fails `cardHashMatches`
 * and is NOT verified — that is the correct, safe outcome.
 */
export function parseVerificationResponse(
  badge: string,
  data: BadgeCheckResponse,
  checkedAt: string,
): VerificationResult {
  const checks = data.checks ?? {};
  const bool = (v: unknown): boolean => v === true;
  const found = bool(checks.on_chain_agent_found);
  const active = bool(checks.status_active);
  const cardHashMatches = bool(checks.hash_matches_on_chain);
  const issues: string[] = (data.issues ?? []).map(
    (i) => `${i.severity ?? "info"}:${i.field ?? "?"}: ${i.message ?? ""}`,
  );
  // Trust only the registry this project is configured for.
  const expected = expectedContracts();
  const got = data.expected?.contracts;
  if (got && got.cis8004 && got.cis8004 !== expected.cis8004) {
    issues.push(
      `registry mismatch: badge resolves against CIS-8004 ${got.cis8004}, expected ${expected.cis8004}`,
    );
  }
  const registryOk = !got?.cis8004 || got.cis8004 === expected.cis8004;
  return {
    badge,
    found,
    active,
    cardHashMatches,
    verified: found && active && cardHashMatches && registryOk,
    owner: data.on_chain?.owner_account,
    agentUri: data.on_chain?.agent_uri,
    checkedAt,
    network: data.network,
    issues,
  };
}

/**
 * Verify a badge via the hosted REST badge-check endpoint.
 * No `?network=` parameter: the network is resolved from the badge
 * (verified live, 21 Nov 2026). Do NOT add one.
 */
export async function verifyBadgeRest(badge: string): Promise<VerificationResult> {
  const checkedAt = new Date().toISOString();
  const url = `${BADGE_CHECK_URL}/${encodeURIComponent(badge)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    return {
      badge,
      found: false,
      active: false,
      cardHashMatches: false,
      verified: false,
      checkedAt,
      issues: [`badge-check endpoint unreachable: ${String(err)}`],
    };
  }
  if (!res.ok) {
    return {
      badge,
      found: false,
      active: false,
      cardHashMatches: false,
      verified: false,
      checkedAt,
      issues: [`badge-check endpoint returned HTTP ${res.status} for ${url}`],
    };
  }
  const data = (await res.json()) as BadgeCheckResponse;
  return parseVerificationResponse(badge, data, checkedAt);
}

/**
 * Verify a badge via the hosted MCP server.
 * UNVERIFIED (see header): a live MCP `initialize` probe on 21 Nov 2026
 * returned no response. This throws rather than silently falling back,
 * so no caller can mistake an unprobed path for a working one.
 * Tools (from the badge docs, not yet probed live):
 * `parse_token_address`, `agent_by_token_address`, `agent_of`,
 * `verify_agent_card`, `get_badge_json`.
 */
export async function verifyBadgeMcp(_badge: string): Promise<VerificationResult> {
  throw new Error(
    "MCP badge verification is not wired: the hosted MCP server at " +
      "https://agent-registry-mcp.concordium.com/mcp has not been verified " +
      "by a live probe in this repo (see verify.ts header). Use " +
      "verifyBadgeRest() — the REST badge-check endpoint, verified on " +
      "testnet 21 Nov 2026. Do not invent another endpoint.",
  );
}

/** The single gate the deal flow uses. Never cache a pass across delivery. */
export async function verifySellerBadge(badge: string): Promise<VerificationResult> {
  return verifyBadgeRest(badge);
}
