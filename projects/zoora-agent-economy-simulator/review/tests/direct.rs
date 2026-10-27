use zoora_review_market::direct::*;
fn engine() -> DirectEngine {
    DirectEngine::new(DirectConfig {
        agents: 3,
        ticks: 10,
        max_agreements: 10,
    })
    .unwrap()
}
fn terms(id: u64) -> Terms {
    Terms {
        agreement_id: id,
        client: 0,
        provider: 1,
        title: "synthetic agent work".into(),
        asset: "SYNTHETIC_UNIT".into(),
        amount: 100,
        delivery_deadline: 8,
        criteria_digest: "c".repeat(64),
    }
}
fn paid() -> DirectEngine {
    let mut e = engine();
    e.record(0, DirectCommand::Agree { terms: terms(0) })
        .unwrap();
    e.record(
        1,
        DirectCommand::PaymentReceipt {
            receipt: Receipt::synthetic(0, 0, 0, 1, 100, 1),
        },
    )
    .unwrap();
    e
}
fn done(mut e: DirectEngine) -> DirectReport {
    e.finish().unwrap();
    let r = DirectReport::from_engine(&e).unwrap();
    r.verify().unwrap();
    r
}
#[test]
fn deadline_does_not_refund_or_reverse_a_direct_payment() {
    let r = done(paid());
    assert_eq!(r.agreements[0].status, DirectStatus::Paid);
    assert!(r.agreements[0].delivery_overdue);
    assert_eq!(r.metrics.net_transferred, 100);
    assert_eq!(r.metrics.voluntary_refunds_recorded, 0);
    assert_eq!(r.wallet_boundary, WalletBoundary::default());
}
#[test]
fn refund_request_and_recipient_refusal_do_not_move_money() {
    let mut e = paid();
    e.record(
        2,
        DirectCommand::Dispute {
            agreement_id: 0,
            client: 0,
            reason_digest: "d".repeat(64),
        },
    )
    .unwrap();
    e.record(
        3,
        DirectCommand::RequestRefund {
            agreement_id: 0,
            client: 0,
            amount: 100,
            reason_digest: "e".repeat(64),
        },
    )
    .unwrap();
    e.record(
        4,
        DirectCommand::DeclineRefund {
            agreement_id: 0,
            provider: 1,
        },
    )
    .unwrap();
    let r = done(e);
    assert_eq!(r.agreements[0].status, DirectStatus::RefundRequested);
    assert_eq!(r.metrics.net_transferred, 100);
    assert_eq!(r.metrics.declined_refunds, 1);
    assert_eq!(r.metrics.unresolved_disputes, 1);
}
#[test]
fn only_separate_voluntary_return_receipts_count_as_refunds() {
    let mut e = paid();
    e.record(
        3,
        DirectCommand::VoluntaryRefundReceipt {
            receipt: Receipt::synthetic(0, 1, 1, 0, 30, 3),
        },
    )
    .unwrap();
    assert_eq!(
        e.agreement(0).unwrap().status,
        DirectStatus::PartiallyRefunded
    );
    e.record(
        4,
        DirectCommand::VoluntaryRefundReceipt {
            receipt: Receipt::synthetic(0, 2, 1, 0, 70, 4),
        },
    )
    .unwrap();
    let r = done(e);
    assert_eq!(r.agreements[0].status, DirectStatus::Refunded);
    assert_eq!(r.metrics.net_transferred, 0);
    assert_eq!(r.metrics.voluntary_refunds_recorded, 100);
}
#[test]
fn wrong_sender_and_duplicate_receipts_are_rejected_without_partial_effects() {
    let mut e = paid();
    let original = Receipt::synthetic(0, 0, 0, 1, 100, 1);
    e.record(1, DirectCommand::PaymentReceipt { receipt: original })
        .unwrap();
    e.record(
        2,
        DirectCommand::VoluntaryRefundReceipt {
            receipt: Receipt::synthetic(0, 1, 2, 0, 100, 2),
        },
    )
    .unwrap();
    let r = done(e);
    assert_eq!(r.metrics.rejected_commands, 2);
    assert_eq!(r.metrics.voluntary_refunds_recorded, 0);
}
#[test]
fn refund_cannot_exceed_recorded_payment_and_request_does_not_cap_voluntary_return() {
    let mut e = paid();
    e.record(
        2,
        DirectCommand::RequestRefund {
            agreement_id: 0,
            client: 0,
            amount: 20,
            reason_digest: "a".repeat(64),
        },
    )
    .unwrap();
    e.record(
        3,
        DirectCommand::VoluntaryRefundReceipt {
            receipt: Receipt::synthetic(0, 1, 1, 0, 101, 3),
        },
    )
    .unwrap();
    e.record(
        4,
        DirectCommand::VoluntaryRefundReceipt {
            receipt: Receipt::synthetic(0, 2, 1, 0, 100, 4),
        },
    )
    .unwrap();
    let r = done(e);
    assert_eq!(r.metrics.rejected_commands, 1);
    assert_eq!(r.metrics.voluntary_refunds_recorded, 100);
}
#[test]
fn partial_payments_and_delivery_receipts_are_separate() {
    let mut e = engine();
    e.record(0, DirectCommand::Agree { terms: terms(0) })
        .unwrap();
    e.record(
        1,
        DirectCommand::PaymentReceipt {
            receipt: Receipt::synthetic(0, 0, 0, 1, 40, 1),
        },
    )
    .unwrap();
    assert_eq!(e.agreement(0).unwrap().status, DirectStatus::PartiallyPaid);
    e.record(
        2,
        DirectCommand::Deliver {
            agreement_id: 0,
            provider: 1,
            artifact_digest: "a".repeat(64),
        },
    )
    .unwrap();
    e.record(
        3,
        DirectCommand::PaymentReceipt {
            receipt: Receipt::synthetic(0, 1, 0, 1, 60, 3),
        },
    )
    .unwrap();
    e.record(
        4,
        DirectCommand::Deliver {
            agreement_id: 0,
            provider: 1,
            artifact_digest: "a".repeat(64),
        },
    )
    .unwrap();
    e.record(
        5,
        DirectCommand::Acknowledge {
            agreement_id: 0,
            client: 0,
        },
    )
    .unwrap();
    let r = done(e);
    assert_eq!(r.metrics.rejected_commands, 1);
    assert_eq!(r.agreements[0].status, DirectStatus::Accepted);
    assert!(!r.agreements[0].delivery_overdue);
}
#[test]
fn live_or_unverified_chain_claims_cannot_enter_fixture_adapter() {
    let mut e = paid();
    let mut receipt = Receipt::synthetic(0, 1, 1, 0, 100, 2);
    receipt.classification = "OBSERVED".into();
    receipt.slot = Some(100);
    receipt.commitment = "FINALIZED".into();
    e.record(2, DirectCommand::VoluntaryRefundReceipt { receipt })
        .unwrap();
    let r = done(e);
    assert_eq!(r.metrics.voluntary_refunds_recorded, 0);
    assert_eq!(r.metrics.rejected_commands, 1);
    assert!(!r.wallet_boundary.chain_receipts_verified);
}
#[test]
fn receipt_provenance_and_availability_are_checked() {
    let mut e = paid();
    for tick in 2..5 {
        let mut receipt = Receipt::synthetic(0, tick, 1, 0, 20, tick);
        match tick {
            2 => receipt.availability_tick = 1,
            3 => receipt.source = "invented".into(),
            _ => receipt.transformation_version = 2,
        };
        e.record(tick, DirectCommand::VoluntaryRefundReceipt { receipt })
            .unwrap();
    }
    let r = done(e);
    assert_eq!(r.metrics.rejected_commands, 3);
    assert_eq!(r.metrics.net_transferred, 100);
}
#[test]
fn recomputed_hash_cannot_create_freeze_authority_or_a_refund() {
    let mut e = paid();
    e.finish().unwrap();
    let r = DirectReport::from_engine(&e).unwrap();
    let mut forged = r.clone();
    forged.wallet_boundary.can_freeze_wallets = true;
    forged.fingerprint = forged.hash().unwrap();
    assert!(forged.verify().is_err());
    let mut forged = r;
    forged.agreements[0].voluntary_refunds_received = 100;
    forged.metrics.voluntary_refunds_recorded = 100;
    forged.metrics.net_transferred = 0;
    forged.fingerprint = forged.hash().unwrap();
    assert!(forged.verify().is_err());
}
#[test]
fn unsigned_party_roles_cannot_accept_or_request_on_behalf_of_another_actor() {
    let mut e = paid();
    e.record(
        2,
        DirectCommand::RequestRefund {
            agreement_id: 0,
            client: 2,
            amount: 100,
            reason_digest: "a".repeat(64),
        },
    )
    .unwrap();
    e.record(
        3,
        DirectCommand::Deliver {
            agreement_id: 0,
            provider: 2,
            artifact_digest: "a".repeat(64),
        },
    )
    .unwrap();
    let r = done(e);
    assert_eq!(r.metrics.rejected_commands, 2);
    assert_eq!(r.metrics.refund_requests, 0);
}
#[test]
fn late_delivery_is_recorded_without_freezing_payment() {
    let mut e = paid();
    e.record(
        8,
        DirectCommand::Deliver {
            agreement_id: 0,
            provider: 1,
            artifact_digest: "a".repeat(64),
        },
    )
    .unwrap();
    let r = done(e);
    assert!(r.agreements[0].delivery_overdue);
    assert_eq!(r.agreements[0].status, DirectStatus::Delivered);
    assert_eq!(r.metrics.net_transferred, 100);
}
#[test]
fn direct_demo_and_viewer_separate_requests_refusals_and_actual_returns() {
    let r = DirectReport::demo().unwrap();
    r.verify().unwrap();
    assert_eq!(r.metrics.payments_recorded, 500);
    assert_eq!(r.metrics.voluntary_refunds_recorded, 150);
    assert_eq!(r.metrics.net_transferred, 350);
    assert_eq!(r.agreements[1].status, DirectStatus::RefundRequested);
    assert_eq!(r.agreements[3].status, DirectStatus::Paid);
    let html = zoora_review_market::viewer::export(&serde_json::to_string(&r).unwrap()).unwrap();
    assert!(html.contains("DIRECT_USER_WALLET"));
    assert!(html.contains("Voluntary returns recorded"));
    assert!(html.contains("no chain transaction is verified"));
}
#[test]
fn malformed_terms_and_overlarge_inputs_cannot_create_an_agreement() {
    let mut e = engine();
    let mut t = terms(0);
    t.client = t.provider;
    e.record(0, DirectCommand::Agree { terms: t }).unwrap();
    let mut t = terms(1);
    t.asset = "SOL".into();
    e.record(0, DirectCommand::Agree { terms: t }).unwrap();
    let mut t = terms(2);
    t.title = "x".repeat(129);
    assert!(e.record(0, DirectCommand::Agree { terms: t }).is_err());
    let r = done(e);
    assert!(r.agreements.is_empty());
    assert_eq!(r.metrics.rejected_commands, 2);
}
#[test]
fn finished_history_required_and_finished_engine_cannot_accept_events() {
    let mut e = paid();
    assert!(DirectReport::from_engine(&e).is_err());
    e.finish().unwrap();
    assert!(e
        .record(9, DirectCommand::Agree { terms: terms(1) })
        .is_err());
    assert!(e.finish().is_err());
    let mut r = DirectReport::from_engine(&e).unwrap();
    r.journal.pop();
    r.fingerprint = r.hash().unwrap();
    assert!(r.verify().is_err());
}
#[test]
fn fulfilling_partial_request_does_not_mislabel_full_payment_refunded() {
    let mut e = paid();
    e.record(
        2,
        DirectCommand::RequestRefund {
            agreement_id: 0,
            client: 0,
            amount: 20,
            reason_digest: "a".repeat(64),
        },
    )
    .unwrap();
    e.record(
        3,
        DirectCommand::VoluntaryRefundReceipt {
            receipt: Receipt::synthetic(0, 1, 1, 0, 20, 3),
        },
    )
    .unwrap();
    e.record(
        4,
        DirectCommand::DeclineRefund {
            agreement_id: 0,
            provider: 1,
        },
    )
    .unwrap();
    let r = done(e);
    assert_eq!(r.metrics.unresolved_refund_requests, 0);
    assert_eq!(r.agreements[0].refund_request_remaining, Some(0));
    assert_eq!(r.agreements[0].status, DirectStatus::PartiallyRefunded);
    assert_eq!(r.metrics.net_transferred, 80);
    assert_eq!(r.metrics.rejected_commands, 1);
}
#[test]
fn earlier_returns_do_not_count_toward_a_later_refund_request() {
    let mut e = paid();
    e.record(
        2,
        DirectCommand::VoluntaryRefundReceipt {
            receipt: Receipt::synthetic(0, 1, 1, 0, 40, 2),
        },
    )
    .unwrap();
    e.record(
        3,
        DirectCommand::RequestRefund {
            agreement_id: 0,
            client: 0,
            amount: 30,
            reason_digest: "a".repeat(64),
        },
    )
    .unwrap();
    e.record(
        4,
        DirectCommand::VoluntaryRefundReceipt {
            receipt: Receipt::synthetic(0, 2, 1, 0, 20, 4),
        },
    )
    .unwrap();
    let r = done(e);
    assert_eq!(r.agreements[0].refund_request_remaining, Some(10));
    assert_eq!(r.metrics.unresolved_refund_requests, 1);
    assert_eq!(r.metrics.voluntary_refunds_recorded, 60);
    assert_eq!(r.metrics.net_transferred, 40);
}
#[test]
fn large_atomic_amounts_remain_exact_decimal_strings_in_report_and_viewer() {
    let mut e = engine();
    let mut t = terms(0);
    t.amount = u64::MAX;
    e.record(0, DirectCommand::Agree { terms: t }).unwrap();
    e.record(
        1,
        DirectCommand::PaymentReceipt {
            receipt: Receipt::synthetic(0, 0, 0, 1, u64::MAX, 1),
        },
    )
    .unwrap();
    let r = done(e);
    assert_eq!(r.metrics.payments_recorded, u128::from(u64::MAX));
    let json = serde_json::to_string(&r).unwrap();
    assert!(json.contains("\"payments_recorded\":\"18446744073709551615\""));
    let html = zoora_review_market::viewer::export(&json).unwrap();
    assert!(html.contains("\"paid\":\"18446744073709551615\""));
}
#[test]
fn event_budget_reserves_finalization_and_unknown_agreements_never_create_funds() {
    let mut e = engine();
    for _ in 0..49_999 {
        e.record(
            0,
            DirectCommand::Acknowledge {
                agreement_id: 99,
                client: 0,
            },
        )
        .unwrap();
    }
    assert!(e
        .record(
            0,
            DirectCommand::Acknowledge {
                agreement_id: 99,
                client: 0
            }
        )
        .is_err());
    let r = done(e);
    assert_eq!(r.journal.len(), 50_000);
    assert_eq!(r.metrics.payments_recorded, 0);
    assert!(r.agreements.is_empty());
}
