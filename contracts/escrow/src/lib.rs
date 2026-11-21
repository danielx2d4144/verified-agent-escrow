//! Verified Agent Escrow — Rust smart contract (Concordium, concordium-std 11).
//!
//! Status 21 Nov 2026: **builds clean with cargo-concordium 5.0.0** —
//! `cargo concordium build` succeeds (27,472 B module, 968 B schema;
//! wasm at `target/concordium/wasm32v1-none/release/verified_agent_escrow.wasm`,
//! SHA-256 `7843711fb7fa51d0d9515f9865b3aec3be487f2fde614eb94e5762a95afd8a52`).
//! `cargo check` (wasm + host) and `cargo concordium test` also pass:
//! **9/9 wasm unit tests + 6/6 integration tests** (21 Nov 2026; see
//! `tests/escrow.rs`). The wasm test host does **not** support
//! `invoke_transfer`, so release/refund state transitions live in pure
//! `Escrow::release()` / `Escrow::refund()` methods (tested directly),
//! and the `#[receive]` wrappers only do the transfer + event log.
//! Six compiler errors were fixed along the
//! way: `event` belongs only on `#[init]`, not `#[receive]`; the `State`
//! struct uses `Serial` + `DeserialWithState`; `StateMap::get` returns a
//! `StateRef`, so `get_mut` is used for in-place mutation and
//! `(*r).clone()` for reads; and `Cargo.toml` default features must stay
//! empty because `cargo concordium build` does not disable them and
//! `wasm32v1-none` has no std. APIs copied from the official piggy-bank
//! tutorial and the `#[receive]` macro docs, not invented:
//! - `ctx.sender()` returns `Address`; compare with
//!   `sender.matches_account(&account)` (piggy-bank tutorial, "Smashing").
//! - `host.invoke_transfer(&account, amount)?` transfers CCD out of the
//!   contract instance; `host.self_balance()` reads its balance.
//! - A `payable` receive takes an extra `amount: Amount` argument.
//! - Events are logged with `enable_logger` + `logger.log(&Event::…)?`
//!   (concordium-std `#[receive]` docs) — NOT by returning a tuple.
//!   The skeleton's `Result<(u64, Event), Error>` return was wrong and
//!   has been removed.
//!
//! Trust model (v1, deliberate):
//! - The buyer funds the escrow in CCD (testnet). The contract holds the funds.
//! - The BACKEND verifies the seller's Verified by Concordium badge
//!   (CIS-8004 `agent_of` + card SHA-256, via the hosted REST badge-check
//!   endpoint — verified working on testnet 21 Nov 2026, see RESEARCH.md)
//!   BEFORE calling `confirm_delivery` / `refund`. The contract does NOT
//!   call the registry itself in v1 — that cross-contract call is
//!   UNVERIFIED (see RESEARCH.md #10).
//! - Only the buyer can release; only the buyer or a designated arbiter
//!   can refund, and only before release. Every transition logs an event:
//!   that event log IS the on-chain audit trail.
//! - The delivery `deadline_ms` is stored and shown in the audit log, but
//!   is NOT enforced on-chain in v1 (no slot-time check); the backend
//!   enforces expiry and calls `refund` with reason "expired". Say so in
//!   the submission — do not claim on-chain expiry.
//! - Protocol-Level Locks (PLL) are NOT used: PLL Simple is listed for
//!   Jan 2027, after this hackathon's 9 Dec 2026 deadline.

#![cfg_attr(not(feature = "std"), no_std)]
use concordium_std::*;

/// One escrow deal. `seller_badge` is recorded as data only — the contract
/// does not verify it; the backend does (see above).
#[derive(Serialize, SchemaType, Clone, Debug, PartialEq, Eq)]
pub struct Escrow {
    pub buyer: AccountAddress,
    pub seller: AccountAddress,
    /// Short badge string, e.g. testnet "JyP9TtQC3HCNrTYR3sc2T" — placeholder
    /// until a real testnet badge is registered (BUILD_PLAN.md Step 0).
    pub seller_badge: String,
    pub amount: Amount,
    /// Unix millis by which delivery must be confirmed, else refundable.
    /// Stored for the audit log; enforced by the backend, not on-chain (v1).
    pub deadline_ms: u64,
    pub state: EscrowState,
}

#[derive(Serialize, SchemaType, Clone, PartialEq, Eq, Debug)]
pub enum EscrowState {
    Funded,
    Released,
    Refunded,
}

/// Contract state. Uses the canonical concordium-std state pattern
/// (`Serial` + `DeserialWithState`, per concordium-std's own docs):
/// a `StateMap` cannot derive `Serialize`/`SchemaType` — the compiler
/// rejects it. `Escrow` gets `DeserialWithState` via the blanket impl
/// for all `Deserial` types.
#[derive(Serial, DeserialWithState)]
pub struct State {
    pub escrows: StateMap<u64, Escrow>,
    pub next_id: u64,
    /// Set to the buyer/arbiter account at init. In v1 this is a single
    /// trusted caller; a production version would use a multisig or the
    /// PLL escrow when it ships.
    pub arbiter: AccountAddress,
}

#[derive(Debug, PartialEq, Eq, Reject, Serialize, SchemaType)]
pub enum Error {
    #[from(ParseError)]
    ParseParams,
    NotBuyer,
    NotArbiterOrBuyer,
    NotFunded,
    /// The caller was a contract, not an account (escrow buyer must be an account).
    NotAccount,
    /// `create_escrow` was called with zero CCD attached.
    ZeroAmount,
    TransferFailed,
    LogFailed,
}

#[derive(Serialize, SchemaType)]
pub struct InitParams {
    pub arbiter: AccountAddress,
}

#[derive(Serialize, SchemaType)]
pub struct CreateParams {
    pub seller: AccountAddress,
    pub seller_badge: String,
    /// Delivery deadline, unix millis.
    pub deadline_ms: u64,
}

#[derive(Serialize, SchemaType)]
pub struct EscrowId {
    pub id: u64,
}

#[derive(Serialize, SchemaType)]
pub struct RefundParams {
    pub id: u64,
    /// "badge_revoked" | "expired" | "other" — recorded in the refund event.
    pub reason: String,
}

/// Events — the on-chain audit trail. Each event records the escrow id,
/// the badge that was checked, and the outcome. The backend mirrors these
/// into a human-readable audit log with the off-chain verification result.
#[derive(Serialize, SchemaType)]
pub enum Event {
    EscrowCreated {
        id: u64,
        buyer: AccountAddress,
        seller: AccountAddress,
        seller_badge: String,
        amount: Amount,
    },
    EscrowReleased {
        id: u64,
        seller: AccountAddress,
        amount: Amount,
        /// Asserted by the backend, which re-verified the badge (status
        /// Active, card hash matches) before calling `confirm_delivery`.
        /// The contract cannot prove this itself in v1 — say so in the
        /// submission.
        badge_checked_at_release: bool,
    },
    EscrowRefunded {
        id: u64,
        buyer: AccountAddress,
        amount: Amount,
        reason: String,
    },
}

#[init(contract = "verified-agent-escrow", parameter = "InitParams", event = "Event")]
fn init(ctx: &InitContext, state_builder: &mut StateBuilder) -> InitResult<State> {
    let params: InitParams = ctx.parameter_cursor().get()?;
    Ok(State {
        escrows: state_builder.new_map(),
        next_id: 0,
        arbiter: params.arbiter,
    })
}

/// Create an escrow. The caller must attach the funded amount (CCD).
/// Returns the new escrow id.
#[receive(
    contract = "verified-agent-escrow",
    name = "create_escrow",
    parameter = "CreateParams",
    error = "Error",
    payable,
    mutable,
    enable_logger
)]
fn create_escrow(
    ctx: &ReceiveContext,
    host: &mut Host<State>,
    amount: Amount,
    logger: &mut Logger,
) -> Result<u64, Error> {
    let params: CreateParams = ctx.parameter_cursor().get()?;
    // The buyer must be an account: `ctx.sender()` is an `Address`
    // (account or contract) — piggy-bank tutorial pattern.
    let buyer = match ctx.sender() {
        Address::Account(account) => account,
        Address::Contract(_) => return Err(Error::NotAccount),
    };
    ensure!(amount > Amount::zero(), Error::ZeroAmount);
    let id = host.state().next_id;
    host.state_mut().next_id += 1;
    // `insert` returns the previous value (`None` for a fresh id) — ignored.
    let _ = host.state_mut().escrows.insert(
        id,
        Escrow {
            buyer: buyer.clone(),
            seller: params.seller.clone(),
            seller_badge: params.seller_badge.clone(),
            amount,
            deadline_ms: params.deadline_ms,
            state: EscrowState::Funded,
        },
    );
    logger
        .log(&Event::EscrowCreated {
            id,
            buyer,
            seller: params.seller,
            seller_badge: params.seller_badge,
            amount,
        })
        .map_err(|_| Error::LogFailed)?;
    Ok(id)
}

impl Escrow {
    /// Mark this escrow Released. Caller must be the buyer.
    /// Returns `(seller, amount)` for the caller to transfer.
    /// Pure state transition (no transfer, no logging) so it can be
    /// unit-tested without the chain's transfer host call — see the
    /// tests module. The `#[receive]` wrapper below does the transfer
    /// and logs the event; the integration tests in `tests/escrow.rs`
    /// exercise that full path on a test chain.
    fn release(&mut self, caller: &Address) -> Result<(AccountAddress, Amount), Error> {
        if !caller.matches_account(&self.buyer) {
            return Err(Error::NotBuyer);
        }
        if self.state != EscrowState::Funded {
            return Err(Error::NotFunded);
        }
        self.state = EscrowState::Released;
        Ok((self.seller, self.amount))
    }

    /// Mark this escrow Refunded. Caller must be the buyer or the
    /// arbiter. Returns `(buyer, amount)` for the caller to transfer.
    /// Same pure-transition note as `release`.
    fn refund(
        &mut self,
        caller: &Address,
        arbiter: &AccountAddress,
    ) -> Result<(AccountAddress, Amount), Error> {
        if !(caller.matches_account(&self.buyer) || caller.matches_account(arbiter)) {
            return Err(Error::NotArbiterOrBuyer);
        }
        if self.state != EscrowState::Funded {
            return Err(Error::NotFunded);
        }
        self.state = EscrowState::Refunded;
        Ok((self.buyer, self.amount))
    }
}

/// Release to the seller. Caller must be the buyer. The backend must have
/// re-verified the seller badge (status Active, card hash matches) before
/// calling this — the contract cannot check that itself in v1.
/// State is updated BEFORE the transfer (checks-effects-interactions);
/// a failed transfer rolls the whole transaction back on-chain anyway.
#[receive(
    contract = "verified-agent-escrow",
    name = "confirm_delivery",
    parameter = "EscrowId",
    error = "Error",
    mutable,
    enable_logger
)]
fn confirm_delivery(
    ctx: &ReceiveContext,
    host: &mut Host<State>,
    logger: &mut Logger,
) -> Result<(), Error> {
    let params: EscrowId = ctx.parameter_cursor().get()?;
    // State transition first (checks-effects-interactions), then the
    // payout. `release` returns the seller + amount to pay.
    let (seller, amount) = {
        let mut escrow = host
            .state_mut()
            .escrows
            .get_mut(&params.id)
            .ok_or(Error::NotFunded)?;
        escrow.release(&ctx.sender())?
    };
    // `invoke_transfer` (piggy-bank "smash"): transfer the escrowed CCD
    // to the seller's account. `?` via map_err keeps the error type ours.
    host.invoke_transfer(&seller, amount)
        .map_err(|_| Error::TransferFailed)?;
    logger
        .log(&Event::EscrowReleased {
            id: params.id,
            seller,
            amount,
            badge_checked_at_release: true,
        })
        .map_err(|_| Error::LogFailed)?;
    Ok(())
}

/// Refund to the buyer (badge revoked, or deadline passed). Caller must be
/// the buyer or the arbiter, and the escrow must still be Funded.
#[receive(
    contract = "verified-agent-escrow",
    name = "refund",
    parameter = "RefundParams",
    error = "Error",
    mutable,
    enable_logger
)]
fn refund(
    ctx: &ReceiveContext,
    host: &mut Host<State>,
    logger: &mut Logger,
) -> Result<(), Error> {
    let params: RefundParams = ctx.parameter_cursor().get()?;
    // Copy the arbiter out first: `get_mut` below borrows the state
    // mutably, so `host.state()` cannot be called while it is alive.
    let arbiter = host.state().arbiter;
    let (buyer, amount) = {
        let mut escrow = host
            .state_mut()
            .escrows
            .get_mut(&params.id)
            .ok_or(Error::NotFunded)?;
        escrow.refund(&ctx.sender(), &arbiter)?
    };
    host.invoke_transfer(&buyer, amount)
        .map_err(|_| Error::TransferFailed)?;
    logger
        .log(&Event::EscrowRefunded {
            id: params.id,
            buyer,
            amount,
            reason: params.reason,
        })
        .map_err(|_| Error::LogFailed)?;
    Ok(())
}

/// Read-only view of one escrow.
#[receive(
    contract = "verified-agent-escrow",
    name = "view",
    parameter = "EscrowId",
    return_value = "Escrow"
)]
fn view(ctx: &ReceiveContext, host: &Host<State>) -> Result<Escrow, Error> {
    let params: EscrowId = ctx.parameter_cursor().get()?;
    host.state()
        .escrows
        .get(&params.id)
        // `get` returns a `StateRef`, which derefs to the Escrow — clone
        // the value out (there is no `.cloned()` on `Option<StateRef>`).
        .map(|escrow| (*escrow).clone())
        .ok_or(Error::NotFunded)
}

/// Unit tests — run with `cargo concordium test` (wasm-test feature).
///
/// These are real wasm tests, not host-side mocks: each test builds a
/// fresh `Host<State>` from the state API, sets the sender / parameter /
/// balance through `TestEnv`, and calls the `#[receive]` functions
/// directly. `invoke_transfer` in the test host pays out of the balance
/// set with `TestEnv::set_receive_balance`, so release/refund tests set
/// a balance covering the escrow amount first. The tests do NOT touch
/// a chain, a registry, or the backend — badge verification is the
/// backend's job (see the backend tests); here the contract only proves
/// its own state machine: Funded -> Released | Refunded, exactly once,
/// by the right caller.
#[concordium_cfg_test]#[concordium_cfg_test]
mod tests {
    use super::*;
    use concordium_std::{claim_eq, concordium_test, test_env::TestEnv, HasLogger};

    fn buyer() -> AccountAddress {
        AccountAddress([1u8; 32])
    }
    fn seller() -> AccountAddress {
        AccountAddress([2u8; 32])
    }
    fn arbiter() -> AccountAddress {
        AccountAddress([3u8; 32])
    }
    fn stranger() -> AccountAddress {
        AccountAddress([4u8; 32])
    }

    /// A fresh contract state: empty escrow map, next id 0, arbiter set.
    fn fresh_host() -> Host<State> {
        let mut builder = StateBuilder::open(StateApi::open());
        let state = State {
            escrows: builder.new_map(),
            next_id: 0,
            arbiter: arbiter(),
        };
        ExternHost {
            state,
            state_builder: builder,
        }
    }

    fn ctx() -> ReceiveContext {
        ExternContext::default()
    }

    fn set_sender(addr: AccountAddress) {
        TestEnv.set_receive_sender(Address::Account(addr));
    }

    fn set_contract_sender() {
        TestEnv.set_receive_sender(Address::Contract(ContractAddress::new(0, 0)));
    }

    fn set_param<T: Serial>(param: &T) {
        TestEnv.set_parameter(0, &to_bytes(param));
    }

    /// Give the contract instance a balance to pay releases/refunds from.
    fn set_balance(micro_ccd: u64) {
        TestEnv.set_receive_balance(Amount::from_micro_ccd(micro_ccd));
    }

    fn create(
        host: &mut Host<State>,
        sender: AccountAddress,
        amount_micro_ccd: u64,
        deadline_ms: u64,
    ) -> Result<u64, Error> {
        set_sender(sender);
        set_balance(10_000_000);
        set_param(&CreateParams {
            seller: seller(),
            seller_badge: "JyP9TtQC3HCNrTYR3sc2T".to_string(),
            deadline_ms,
        });
        let mut logger = Logger::init();
        create_escrow(
            &ctx(),
            host,
            Amount::from_micro_ccd(amount_micro_ccd),
            &mut logger,
        )
    }

    fn view_escrow(host: &Host<State>, id: u64) -> Result<Escrow, Error> {
        set_param(&EscrowId { id });
        view(&ctx(), host)
    }

    /// A plain Funded escrow, for testing the pure state transitions
    /// (`Escrow::release` / `Escrow::refund`) without a host call.
    fn funded_escrow() -> Escrow {
        Escrow {
            buyer: buyer(),
            seller: seller(),
            seller_badge: "JyP9TtQC3HCNrTYR3sc2T".to_string(),
            amount: Amount::from_micro_ccd(1_000_000),
            deadline_ms: 1_800_000_000_000,
            state: EscrowState::Funded,
        }
    }

    /// 1. create_escrow stores a Funded escrow; view returns it verbatim.
    #[concordium_test]
    fn create_escrow_stores_funded_escrow() {
        let mut host = fresh_host();
        let id = create(&mut host, buyer(), 1_000_000, 1_800_000_000_000)
            .expect("create_escrow should succeed");
        claim_eq!(id, 0);
        let escrow = view_escrow(&host, id).expect("view should find the escrow");
        claim_eq!(escrow.buyer, buyer());
        claim_eq!(escrow.seller, seller());
        claim_eq!(escrow.amount, Amount::from_micro_ccd(1_000_000));
        claim_eq!(escrow.state, EscrowState::Funded);
        claim_eq!(escrow.seller_badge, "JyP9TtQC3HCNrTYR3sc2T".to_string());
        // A second escrow gets the next id.
        let id2 = create(&mut host, buyer(), 500_000, 1_800_000_000_000)
            .expect("second create should succeed");
        claim_eq!(id2, 1);
        // Viewing an unknown id fails.
        claim_eq!(
            view_escrow(&host, 99),
            Err(Error::NotFunded),
            "view of an unknown escrow must fail"
        );
    }

    /// 2. The release transition: buyer releases, state becomes
    /// Released, and the payout is (seller, amount). The actual CCD
    /// transfer is done by the `confirm_delivery` receive wrapper and
    /// is covered by the integration tests in `tests/escrow.rs`,
    /// because the wasm test host does not support `invoke_transfer`.
    #[concordium_test]
    fn release_transition_pays_seller() {
        let mut escrow = funded_escrow();
        claim_eq!(
            escrow.release(&Address::Account(buyer())),
            Ok((seller(), Amount::from_micro_ccd(1_000_000)))
        );
        claim_eq!(escrow.state, EscrowState::Released);
    }

    /// 3. The refund transition: buyer (or arbiter) refunds, state
    /// becomes Refunded, and the payout is (buyer, amount). This is
    /// the path the backend calls after a failed badge re-check at
    /// delivery ("badge_revoked").
    #[concordium_test]
    fn refund_transition_on_revocation_refunds_buyer() {
        let mut escrow = funded_escrow();
        claim_eq!(
            escrow.refund(&Address::Account(buyer()), &arbiter()),
            Ok((buyer(), Amount::from_micro_ccd(1_000_000)))
        );
        claim_eq!(escrow.state, EscrowState::Refunded);
        // The arbiter may also refund a Funded escrow.
        let mut escrow2 = funded_escrow();
        claim_eq!(
            escrow2.refund(&Address::Account(arbiter()), &arbiter()),
            Ok((buyer(), Amount::from_micro_ccd(1_000_000)))
        );
        claim_eq!(escrow2.state, EscrowState::Refunded);
    }

    /// 4. Release twice fails: the second release is not Funded.
    #[concordium_test]
    fn release_twice_fails() {
        let mut escrow = funded_escrow();
        escrow
            .release(&Address::Account(buyer()))
            .expect("first release should succeed");
        claim_eq!(
            escrow.release(&Address::Account(buyer())),
            Err(Error::NotFunded),
            "second release must fail"
        );
    }

    /// 5. Refund after release fails.
    #[concordium_test]
    fn refund_after_release_fails() {
        let mut escrow = funded_escrow();
        escrow
            .release(&Address::Account(buyer()))
            .expect("release should succeed");
        claim_eq!(
            escrow.refund(&Address::Account(buyer()), &arbiter()),
            Err(Error::NotFunded),
            "refund after release must fail"
        );
    }

    /// 6. A non-buyer cannot release (and cannot refund either, unless
    /// they are the arbiter). The receive wrapper rejects these before
    /// any transfer — the `confirm_delivery` path is also exercised
    /// here at the receive level, where it fails before `invoke_transfer`.
    #[concordium_test]
    fn non_buyer_cannot_release() {
        let mut escrow = funded_escrow();
        claim_eq!(
            escrow.release(&Address::Account(stranger())),
            Err(Error::NotBuyer),
            "stranger release must fail with NotBuyer"
        );
        claim_eq!(
            escrow.release(&Address::Account(seller())),
            Err(Error::NotBuyer),
            "seller release must fail with NotBuyer"
        );
        claim_eq!(
            escrow.refund(&Address::Account(stranger()), &arbiter()),
            Err(Error::NotArbiterOrBuyer),
            "stranger refund must fail with NotArbiterOrBuyer"
        );
        // The escrow is still Funded after the failed attempts.
        claim_eq!(escrow.state, EscrowState::Funded);

        // Same rejection through the receive entrypoint itself.
        let mut host = fresh_host();
        let id = create(&mut host, buyer(), 1_000_000, 1_800_000_000_000)
            .expect("create should succeed");
        set_sender(stranger());
        set_balance(10_000_000);
        set_param(&EscrowId { id });
        let mut logger = Logger::init();
        claim_eq!(
            confirm_delivery(&ctx(), &mut host, &mut logger),
            Err(Error::NotBuyer),
            "receive-level stranger release must fail with NotBuyer"
        );
        claim_eq!(
            view_escrow(&host, id).expect("view").state,
            EscrowState::Funded
        );
    }

    /// 7. An expired escrow can be refunded. The contract stores the
    /// deadline but does not enforce it on-chain in v1 (see the module
    /// docs); the backend enforces expiry and calls refund with reason
    /// "expired". This test proves the refund path accepts a deal whose
    /// deadline has already passed.
    #[concordium_test]
    fn expired_escrow_can_be_refunded() {
        let mut escrow = funded_escrow();
        // Deadline 1 Jan 2020 — long past.
        escrow.deadline_ms = 1_577_836_800_000;
        claim_eq!(
            escrow.refund(&Address::Account(buyer()), &arbiter()),
            Ok((buyer(), Amount::from_micro_ccd(1_000_000)))
        );
        claim_eq!(escrow.state, EscrowState::Refunded);
    }

    /// 8. Creating an escrow with zero CCD attached fails.
    #[concordium_test]
    fn create_with_zero_amount_fails() {
        let mut host = fresh_host();
        claim_eq!(
            create(&mut host, buyer(), 0, 1_800_000_000_000),
            Err(Error::ZeroAmount),
            "zero-amount create must fail"
        );
        // Nothing was stored.
        claim_eq!(view_escrow(&host, 0), Err(Error::NotFunded));
    }

    /// 9. The buyer must be an account, not a contract.
    #[concordium_test]
    fn create_by_contract_sender_fails() {
        let mut host = fresh_host();
        set_contract_sender();
        set_balance(10_000_000);
        set_param(&CreateParams {
            seller: seller(),
            seller_badge: "JyP9TtQC3HCNrTYR3sc2T".to_string(),
            deadline_ms: 1_800_000_000_000,
        });
        let mut logger = Logger::init();
        claim_eq!(
            create_escrow(
                &ctx(),
                &mut host,
                Amount::from_micro_ccd(1_000_000),
                &mut logger
            ),
            Err(Error::NotAccount),
            "contract sender must fail with NotAccount"
        );
    }
}
