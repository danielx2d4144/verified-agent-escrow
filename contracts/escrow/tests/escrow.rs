//! Integration tests for the Verified Agent Escrow contract.
//!
//! These run the *built wasm module* on a local test chain
//! (`concordium-smart-contract-testing` 5), using the same execution
//! engine the nodes use — so `invoke_transfer` actually pays out,
//! unlike the wasm unit tests in `src/lib.rs`, whose test host does
//! not support the transfer host call (verified 21 Nov 2026: the
//! wasm tests for release/refund failed with "Unsupported host
//! function call: concordium invoke").
//!
//! Run with:
//!
//! ```sh
//! export TMPDIR="$HOME/cargo-tmp/tmp"
//! cargo concordium test --out concordium-out/module.wasm.v1
//! ```
//!
//! The `--out` flag writes the freshly built module to
//! `concordium-out/module.wasm.v1`, which these tests load. Without
//! it, they fall back to the release wasm under `target/concordium/`
//! if it exists. Nothing here touches a real chain, a registry, or
//! the backend — badge verification is the backend's job; here the
//! contract only proves its escrow state machine end to end, with
//! real CCD moving between accounts on the test chain.
//!
//! Test accounts use distinct first bytes ([0u8; 32], [1u8; 32], …)
//! so they are not aliases of each other (addresses are aliases when
//! their first 29 bytes match).

use concordium_smart_contract_testing::*;
use concordium_std::{AccountAddress, Amount, Deserial, Serialize};

/// Parameter / return types, mirroring `src/lib.rs` exactly
/// (same field names, types and order — the serialisation must match).
#[derive(Serialize)]
struct InitParams {
    arbiter: AccountAddress,
}

#[derive(Serialize)]
struct CreateParams {
    seller: AccountAddress,
    seller_badge: String,
    deadline_ms: u64,
}

#[derive(Serialize)]
struct EscrowId {
    id: u64,
}

#[derive(Serialize)]
struct RefundParams {
    id: u64,
    reason: String,
}

#[derive(Deserial, Debug, PartialEq, Eq)]
enum EscrowStateView {
    Funded,
    Released,
    Refunded,
}

/// Mirror of the contract's `Escrow` view. (Only `state` is asserted
/// in these tests; the other fields are kept so the shape stays
/// honest with the contract's view.)
#[allow(dead_code)]
#[derive(Deserial, Debug)]
struct EscrowView {
    buyer: AccountAddress,
    seller: AccountAddress,
    seller_badge: String,
    amount: Amount,
    deadline_ms: u64,
    state: EscrowStateView,
}

const CONTRACT: &str = "verified-agent-escrow";

fn energy() -> Energy {
    Energy::from(100_000)
}

fn buyer_addr() -> AccountAddress {
    AccountAddress([0u8; 32])
}
fn seller_addr() -> AccountAddress {
    AccountAddress([1u8; 32])
}
fn arbiter_addr() -> AccountAddress {
    AccountAddress([2u8; 32])
}
fn stranger_addr() -> AccountAddress {
    AccountAddress([3u8; 32])
}

struct Fixture {
    chain: Chain,
    contract: ContractAddress,
}

fn setup() -> Fixture {
    let mut chain = Chain::new();
    for addr in [buyer_addr(), seller_addr(), arbiter_addr(), stranger_addr()] {
        chain.create_account(Account::new(addr, Amount::from_ccd(1_000)));
    }

    // Load the built wasm module: prefer the file `cargo concordium
    // test --out` writes, fall back to the release build output.
    // (`WasmModule` is not re-exported by
    // `concordium-smart-contract-testing`, so the type is inferred
    // here rather than named in a helper's signature.)
    let mut loaded = None;
    for path in [
        "concordium-out/module.wasm.v1",
        "target/concordium/wasm32v1-none/release/verified_agent_escrow.wasm",
    ] {
        if let Ok(module) = module_load_v1(path) {
            loaded = Some(module);
            break;
        }
    }
    let module = loaded.expect(
        "built contract module not found: run \
         `cargo concordium test --out concordium-out/module.wasm.v1`",
    );
    let deployment = chain
        .module_deploy_v1(Signer::with_one_key(), buyer_addr(), module)
        .expect("module deploy should succeed");
    let init = chain
        .contract_init(
            Signer::with_one_key(),
            buyer_addr(),
            energy(),
            InitContractPayload {
                mod_ref: deployment.module_reference,
                init_name: OwnedContractName::new_unchecked(format!("init_{CONTRACT}")),
                param: OwnedParameter::from_serial(&InitParams {
                    arbiter: arbiter_addr(),
                })
                .expect("init param should serialise"),
                amount: Amount::zero(),
            },
        )
        .expect("contract init should succeed");
    Fixture {
        chain,
        contract: init.contract_address,
    }
}

fn update(
    fx: &mut Fixture,
    invoker: AccountAddress,
    sender: Address,
    entrypoint: &str,
    param: OwnedParameter,
    amount: Amount,
) -> Result<ContractInvokeSuccess, ContractInvokeError> {
    fx.chain.contract_update(
        Signer::with_one_key(),
        invoker,
        sender,
        energy(),
        UpdateContractPayload {
            address: fx.contract,
            receive_name: OwnedReceiveName::new_unchecked(format!("{CONTRACT}.{entrypoint}")),
            message: param,
            amount,
        },
    )
}

fn create_escrow(
    fx: &mut Fixture,
    amount: Amount,
) -> Result<u64, ContractInvokeError> {
    let ok = update(
        fx,
        buyer_addr(),
        Address::Account(buyer_addr()),
        "create_escrow",
        OwnedParameter::from_serial(&CreateParams {
            seller: seller_addr(),
            seller_badge: "JyP9TtQC3HCNrTYR3sc2T".to_string(),
            deadline_ms: 1_800_000_000_000,
        })
        .expect("create param should serialise"),
        amount,
    )?;
    Ok(ok.parse_return_value::<u64>().expect("create returns the escrow id"))
}

fn view_escrow(fx: &Fixture, id: u64) -> EscrowView {
    let invoke = fx
        .chain
        .contract_invoke(
            buyer_addr(),
            Address::Contract(fx.contract),
            energy(),
            UpdateContractPayload {
                address: fx.contract,
                receive_name: OwnedReceiveName::new_unchecked(format!("{CONTRACT}.view")),
                message: OwnedParameter::from_serial(&EscrowId { id })
                    .expect("view param should serialise"),
                amount: Amount::zero(),
            },
        )
        .expect("view invoke should succeed");
    invoke
        .parse_return_value::<EscrowView>()
        .expect("view returns the escrow")
}

/// 1. create -> confirm_delivery releases, and the seller is actually
/// paid 1 CCD on the test chain (balance + transfer trace).
#[test]
fn create_then_release_pays_seller() {
    let mut fx = setup();
    let amount = Amount::from_ccd(1);
    let seller_before = fx
        .chain
        .account_balance_available(seller_addr())
        .expect("seller account exists");
    let id = create_escrow(&mut fx, amount).expect("create should succeed");
    assert_eq!(id, 0);
    assert_eq!(
        fx.chain.contract_balance(fx.contract),
        Some(amount),
        "contract holds the escrowed CCD after create"
    );
    assert_eq!(view_escrow(&fx, id).state, EscrowStateView::Funded);

    let release = update(
        &mut fx,
        buyer_addr(),
        Address::Account(buyer_addr()),
        "confirm_delivery",
        OwnedParameter::from_serial(&EscrowId { id }).expect("param should serialise"),
        Amount::zero(),
    )
    .expect("buyer release should succeed");
    // The release transfer to the seller, of exactly the escrow amount.
    let transfers: Vec<(ContractAddress, Amount, AccountAddress)> =
        release.account_transfers().collect();
    assert_eq!(
        transfers,
        vec![(fx.contract, amount, seller_addr())],
        "release must transfer the full escrow amount to the seller"
    );
    assert_eq!(
        fx.chain
            .account_balance_available(seller_addr())
            .expect("seller account exists"),
        seller_before + amount,
        "seller balance grows by exactly the escrow amount"
    );
    assert_eq!(
        fx.chain.contract_balance(fx.contract),
        Some(Amount::zero()),
        "contract is empty after release"
    );
    assert_eq!(view_escrow(&fx, id).state, EscrowStateView::Released);
}

/// 2. create -> refund (badge revoked) refunds the buyer: the full
/// amount is transferred back, and the state is Refunded.
#[test]
fn create_then_refund_on_revocation_refunds_buyer() {
    let mut fx = setup();
    let amount = Amount::from_ccd(1);
    let id = create_escrow(&mut fx, amount).expect("create should succeed");
    let refund = update(
        &mut fx,
        buyer_addr(),
        Address::Account(buyer_addr()),
        "refund",
        OwnedParameter::from_serial(&RefundParams {
            id,
            reason: "badge_revoked".to_string(),
        })
        .expect("param should serialise"),
        Amount::zero(),
    )
    .expect("buyer refund should succeed");
    let transfers: Vec<(ContractAddress, Amount, AccountAddress)> =
        refund.account_transfers().collect();
    assert_eq!(
        transfers,
        vec![(fx.contract, amount, buyer_addr())],
        "refund must transfer the full escrow amount back to the buyer"
    );
    assert_eq!(
        fx.chain.contract_balance(fx.contract),
        Some(Amount::zero()),
        "contract is empty after refund"
    );
    assert_eq!(view_escrow(&fx, id).state, EscrowStateView::Refunded);
}

/// 3. Release twice fails: the second release is rejected, and the
/// escrow stays Released (the seller is not paid twice).
#[test]
fn release_twice_fails() {
    let mut fx = setup();
    let id = create_escrow(&mut fx, Amount::from_ccd(1)).expect("create should succeed");
    update(
        &mut fx,
        buyer_addr(),
        Address::Account(buyer_addr()),
        "confirm_delivery",
        OwnedParameter::from_serial(&EscrowId { id }).expect("param should serialise"),
        Amount::zero(),
    )
    .expect("first release should succeed");
    let second = update(
        &mut fx,
        buyer_addr(),
        Address::Account(buyer_addr()),
        "confirm_delivery",
        OwnedParameter::from_serial(&EscrowId { id }).expect("param should serialise"),
        Amount::zero(),
    );
    assert!(second.is_err(), "second release must fail");
    assert_eq!(view_escrow(&fx, id).state, EscrowStateView::Released);
}

/// 4. Refund after release fails, and the escrow stays Released.
#[test]
fn refund_after_release_fails() {
    let mut fx = setup();
    let id = create_escrow(&mut fx, Amount::from_ccd(1)).expect("create should succeed");
    update(
        &mut fx,
        buyer_addr(),
        Address::Account(buyer_addr()),
        "confirm_delivery",
        OwnedParameter::from_serial(&EscrowId { id }).expect("param should serialise"),
        Amount::zero(),
    )
    .expect("release should succeed");
    let refund = update(
        &mut fx,
        buyer_addr(),
        Address::Account(buyer_addr()),
        "refund",
        OwnedParameter::from_serial(&RefundParams {
            id,
            reason: "badge_revoked".to_string(),
        })
        .expect("param should serialise"),
        Amount::zero(),
    );
    assert!(refund.is_err(), "refund after release must fail");
    assert_eq!(view_escrow(&fx, id).state, EscrowStateView::Released);
}

/// 5. A non-buyer cannot release. The escrow stays Funded, and the
/// buyer can still release it afterwards.
#[test]
fn non_buyer_cannot_release() {
    let mut fx = setup();
    let id = create_escrow(&mut fx, Amount::from_ccd(1)).expect("create should succeed");
    let stranger_release = update(
        &mut fx,
        stranger_addr(),
        Address::Account(stranger_addr()),
        "confirm_delivery",
        OwnedParameter::from_serial(&EscrowId { id }).expect("param should serialise"),
        Amount::zero(),
    );
    assert!(stranger_release.is_err(), "stranger release must fail");
    assert_eq!(view_escrow(&fx, id).state, EscrowStateView::Funded);
    update(
        &mut fx,
        buyer_addr(),
        Address::Account(buyer_addr()),
        "confirm_delivery",
        OwnedParameter::from_serial(&EscrowId { id }).expect("param should serialise"),
        Amount::zero(),
    )
    .expect("buyer release should still succeed after the failed attempt");
    assert_eq!(view_escrow(&fx, id).state, EscrowStateView::Released);
}

/// 6. Creating an escrow with zero CCD attached fails, and no escrow
/// is stored (viewing id 0 fails).
#[test]
fn create_with_zero_amount_fails() {
    let mut fx = setup();
    let create = update(
        &mut fx,
        buyer_addr(),
        Address::Account(buyer_addr()),
        "create_escrow",
        OwnedParameter::from_serial(&CreateParams {
            seller: seller_addr(),
            seller_badge: "JyP9TtQC3HCNrTYR3sc2T".to_string(),
            deadline_ms: 1_800_000_000_000,
        })
        .expect("param should serialise"),
        Amount::zero(),
    );
    assert!(create.is_err(), "zero-amount create must fail");
    // contract_invoke of view for a missing escrow must also fail.
    let view = fx.chain.contract_invoke(
        buyer_addr(),
        Address::Contract(fx.contract),
        energy(),
        UpdateContractPayload {
            address: fx.contract,
            receive_name: OwnedReceiveName::new_unchecked(format!("{CONTRACT}.view")),
            message: OwnedParameter::from_serial(&EscrowId { id: 0 })
                .expect("param should serialise"),
            amount: Amount::zero(),
        },
    );
    assert!(view.is_err(), "view of a missing escrow must fail");
}
