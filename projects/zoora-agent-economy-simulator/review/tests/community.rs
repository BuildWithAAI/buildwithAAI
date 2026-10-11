use zoora_review_market::{
    community::*,
    community_export,
    community_scenarios::{BatchConfig, BatchReport, RunReport, Scenario, WorkloadConfig},
    direct::{DirectCommand, DirectOutcome, Receipt},
    viewer,
};
fn actor(id: u64) -> Actor {
    Actor::Agent { agent_id: id }
}
fn registration(id: u64) -> Registration {
    Registration {
        agent_id: id,
        operator_id: id,
        handle: format!("agent_{id}"),
        wallet_label: format!("synthetic-wallet-{id}"),
        capabilities: vec!["code".into()],
    }
}
fn config() -> CommunityConfig {
    CommunityConfig {
        agents: 4,
        ticks: 20,
        max_pending_per_provider: 2,
        ..CommunityConfig::default()
    }
}
fn setup() -> CommunityEngine {
    let mut e = CommunityEngine::new(config()).unwrap();
    for id in 0..4 {
        e.record(
            0,
            Actor::Operator { operator_id: id },
            CommunityCommand::Register {
                registration: registration(id),
            },
        )
        .unwrap();
    }
    e.record(
        1,
        actor(0),
        CommunityCommand::CreateProject {
            project_id: 0,
            title: "Creative work".into(),
            summary: "A test project.".into(),
        },
    )
    .unwrap();
    e.record(
        1,
        actor(0),
        CommunityCommand::PublishOffer {
            offer_id: 0,
            project_id: 0,
            title: "Code review".into(),
            criteria_digest: "c".repeat(64),
            amount: 100,
            delivery_ticks: 6,
        },
    )
    .unwrap();
    e
}
fn accept(e: &mut CommunityEngine, tick: u64, id: u64) {
    e.record(
        tick,
        actor(1),
        CommunityCommand::AcceptOffer {
            offer_id: 0,
            agreement_id: id,
        },
    )
    .unwrap();
}
fn workflow(e: &mut CommunityEngine, tick: u64, who: u64, command: DirectCommand) {
    e.record(tick, actor(who), CommunityCommand::Workflow { command })
        .unwrap();
}
fn pay(e: &mut CommunityEngine, tick: u64, id: u64) {
    workflow(
        e,
        tick,
        1,
        DirectCommand::PaymentReceipt {
            receipt: Receipt::synthetic(id, 0, 1, 0, 100, tick),
        },
    );
}
fn finish(mut e: CommunityEngine) -> CommunityReport {
    e.finish().unwrap();
    let r = CommunityReport::from_engine(&e).unwrap();
    r.verify().unwrap();
    r
}
fn rejected(e: &CommunityEngine, reason: Rejection) {
    assert!(
        matches!(e.journal().last().unwrap().outcome,CommunityOutcome::Rejected{reason:r} if r==reason)
    );
}
fn workload() -> WorkloadConfig {
    WorkloadConfig {
        seed: 42,
        agents: 20,
        tasks: 100,
        max_pending_per_provider: 16,
        posts_per_agent_per_tick: 3,
    }
}

#[test]
fn one_declared_wallet_per_agent_and_historical_handle_reservation() {
    let mut e = setup();
    let mut r = registration(3);
    r.agent_id = 9;
    e.record(
        2,
        Actor::Operator { operator_id: 3 },
        CommunityCommand::Register { registration: r },
    )
    .unwrap();
    rejected(&e, Rejection::InvalidIdentity);
    e.record(
        2,
        actor(0),
        CommunityCommand::Rename {
            agent_id: 0,
            handle: "new_handle".into(),
        },
    )
    .unwrap();
    e.record(
        2,
        actor(3),
        CommunityCommand::Rename {
            agent_id: 3,
            handle: "agent_0".into(),
        },
    )
    .unwrap();
    rejected(&e, Rejection::HandleReserved);
    let r = finish(e);
    assert_eq!(r.agents[0].handle_history.len(), 2);
    assert_eq!(r.agents[0].registration.handle, "new_handle");
}
#[test]
fn duplicate_wallet_or_handle_cannot_create_another_identity() {
    let mut e = CommunityEngine::new(config()).unwrap();
    e.record(
        0,
        Actor::Operator { operator_id: 0 },
        CommunityCommand::Register {
            registration: registration(0),
        },
    )
    .unwrap();
    let mut r = registration(1);
    r.wallet_label = registration(0).wallet_label;
    e.record(
        0,
        Actor::Operator { operator_id: 1 },
        CommunityCommand::Register { registration: r },
    )
    .unwrap();
    rejected(&e, Rejection::WalletReserved);
    let mut r = registration(1);
    r.handle = registration(0).handle;
    e.record(
        0,
        Actor::Operator { operator_id: 1 },
        CommunityCommand::Register { registration: r },
    )
    .unwrap();
    rejected(&e, Rejection::HandleReserved);
    assert_eq!(finish(e).agents.len(), 1);
}
#[test]
fn owner_override_is_a_declared_profile_control_not_authentication() {
    let mut e = setup();
    e.record(
        2,
        Actor::Operator { operator_id: 2 },
        CommunityCommand::SetActive {
            agent_id: 0,
            active: false,
        },
    )
    .unwrap();
    rejected(&e, Rejection::WrongActor);
    e.record(
        2,
        actor(0),
        CommunityCommand::SetActive {
            agent_id: 0,
            active: false,
        },
    )
    .unwrap();
    rejected(&e, Rejection::WrongActor);
    e.record(
        2,
        Actor::Operator { operator_id: 0 },
        CommunityCommand::SetActive {
            agent_id: 0,
            active: false,
        },
    )
    .unwrap();
    e.record(
        2,
        actor(0),
        CommunityCommand::Post {
            post_id: 0,
            project_id: None,
            reply_to: None,
            body: "Blocked while inactive.".into(),
        },
    )
    .unwrap();
    rejected(&e, Rejection::InactiveAgent);
    e.record(
        2,
        Actor::Operator { operator_id: 0 },
        CommunityCommand::Rename {
            agent_id: 0,
            handle: "owner_rename".into(),
        },
    )
    .unwrap();
    assert!(!finish(e).agents[0].active);
}
#[test]
fn project_membership_controls_artifact_and_offer_records() {
    let mut e = setup();
    e.record(
        2,
        actor(2),
        CommunityCommand::PublishArtifact {
            project_id: 0,
            digest: "a".repeat(64),
        },
    )
    .unwrap();
    rejected(&e, Rejection::NotContributor);
    e.record(
        2,
        actor(2),
        CommunityCommand::AddContributor {
            project_id: 0,
            agent_id: 2,
        },
    )
    .unwrap();
    rejected(&e, Rejection::WrongActor);
    e.record(
        2,
        actor(0),
        CommunityCommand::AddContributor {
            project_id: 0,
            agent_id: 2,
        },
    )
    .unwrap();
    e.record(
        2,
        actor(2),
        CommunityCommand::PublishArtifact {
            project_id: 0,
            digest: "a".repeat(64),
        },
    )
    .unwrap();
    let r = finish(e);
    assert_eq!(r.projects[0].contributors, vec![0, 2]);
    assert_eq!(r.projects[0].artifacts[0].agent_id, 2);
}
#[test]
fn post_limits_count_applied_posts_and_release_on_next_tick() {
    let mut e = setup();
    for id in 0..4 {
        e.record(
            2,
            actor(1),
            CommunityCommand::Post {
                post_id: id,
                project_id: None,
                reply_to: None,
                body: "Fixture text.".into(),
            },
        )
        .unwrap();
    }
    rejected(&e, Rejection::PostRateLimit);
    e.record(
        3,
        actor(1),
        CommunityCommand::Post {
            post_id: 4,
            project_id: None,
            reply_to: None,
            body: "Next tick.".into(),
        },
    )
    .unwrap();
    let r = finish(e);
    assert_eq!(r.posts.len(), 4);
    assert_eq!(r.metrics.post_rate_rejections, 1);
}
#[test]
fn reply_must_refer_to_an_existing_post_in_the_same_project() {
    let mut e = setup();
    e.record(
        2,
        actor(1),
        CommunityCommand::Post {
            post_id: 0,
            project_id: Some(0),
            reply_to: None,
            body: "Project discussion.".into(),
        },
    )
    .unwrap();
    e.record(
        2,
        actor(2),
        CommunityCommand::Post {
            post_id: 1,
            project_id: None,
            reply_to: Some(0),
            body: "Wrong context.".into(),
        },
    )
    .unwrap();
    rejected(&e, Rejection::InvalidContent);
    e.record(
        2,
        actor(2),
        CommunityCommand::Post {
            post_id: 1,
            project_id: Some(0),
            reply_to: Some(0),
            body: "Valid reply.".into(),
        },
    )
    .unwrap();
    assert_eq!(finish(e).posts.len(), 2);
}
#[test]
fn accepted_offer_creates_exact_direct_terms_without_a_payment() {
    let mut e = setup();
    accept(&mut e, 2, 12);
    let r = finish(e);
    assert_eq!(r.orders.len(), 1);
    let a = &r.direct.agreements[0];
    assert_eq!(a.terms.client, 1);
    assert_eq!(a.terms.provider, 0);
    assert_eq!(a.terms.amount, 100);
    assert_eq!(a.terms.delivery_deadline, 8);
    assert_eq!(a.payments_received, 0);
    assert_eq!(r.metrics.unpaid_at_finish, 1);
    assert!(r.direct.wallet_boundary == Default::default());
}
#[test]
fn provider_capacity_rejects_without_creating_direct_or_community_order() {
    let mut e = setup();
    accept(&mut e, 2, 0);
    accept(&mut e, 2, 1);
    accept(&mut e, 2, 2);
    rejected(&e, Rejection::ProviderCapacity);
    assert!(e.agreement(2).is_none());
    let r = finish(e);
    assert_eq!(r.orders.len(), 2);
    assert_eq!(r.direct.agreements.len(), 2);
    assert_eq!(r.metrics.provider_capacity_rejections, 1);
}
#[test]
fn delivery_releases_admission_capacity_without_reversing_any_payment() {
    let mut e = setup();
    accept(&mut e, 2, 0);
    accept(&mut e, 2, 1);
    pay(&mut e, 3, 0);
    workflow(
        &mut e,
        4,
        0,
        DirectCommand::Deliver {
            agreement_id: 0,
            provider: 0,
            artifact_digest: "a".repeat(64),
        },
    );
    accept(&mut e, 4, 2);
    let r = finish(e);
    assert_eq!(r.orders.len(), 3);
    assert_eq!(r.direct.metrics.payments_recorded, 100);
    assert_eq!(r.direct.metrics.voluntary_refunds_recorded, 0);
}
#[test]
fn unpaid_reservations_expire_without_being_reported_as_refunded() {
    let mut e = setup();
    accept(&mut e, 2, 0);
    accept(&mut e, 2, 1);
    assert_eq!(e.pending(0, 7), 2);
    assert_eq!(e.pending(0, 8), 0);
    accept(&mut e, 8, 2);
    let r = finish(e);
    assert_eq!(r.orders.len(), 3);
    assert_eq!(r.metrics.unpaid_at_finish, 3);
    assert_eq!(r.direct.metrics.voluntary_refunds_recorded, 0);
}
#[test]
fn withdrawing_offer_does_not_cancel_existing_agreements() {
    let mut e = setup();
    accept(&mut e, 2, 0);
    e.record(
        3,
        Actor::Operator { operator_id: 0 },
        CommunityCommand::WithdrawOffer { offer_id: 0 },
    )
    .unwrap();
    accept(&mut e, 3, 1);
    rejected(&e, Rejection::OfferUnavailable);
    pay(&mut e, 4, 0);
    assert_eq!(finish(e).direct.metrics.payments_recorded, 100);
}
#[test]
fn deactivation_does_not_block_later_payment_or_voluntary_return_observations() {
    let mut e = setup();
    accept(&mut e, 2, 0);
    for id in [0, 1] {
        e.record(
            3,
            Actor::Operator { operator_id: id },
            CommunityCommand::SetActive {
                agent_id: id,
                active: false,
            },
        )
        .unwrap();
    }
    pay(&mut e, 4, 0);
    workflow(
        &mut e,
        5,
        0,
        DirectCommand::VoluntaryRefundReceipt {
            receipt: Receipt::synthetic(0, 1, 0, 1, 40, 5),
        },
    );
    let r = finish(e);
    assert_eq!(r.direct.metrics.payments_recorded, 100);
    assert_eq!(r.direct.metrics.voluntary_refunds_recorded, 40);
    assert_eq!(r.direct.metrics.net_transferred, 60);
}
#[test]
fn wrong_declared_actor_or_engine_owned_workflow_does_not_create_receipt() {
    let mut e = setup();
    accept(&mut e, 2, 0);
    workflow(
        &mut e,
        3,
        2,
        DirectCommand::PaymentReceipt {
            receipt: Receipt::synthetic(0, 0, 1, 0, 100, 3),
        },
    );
    rejected(&e, Rejection::WrongActor);
    workflow(&mut e, 3, 0, DirectCommand::Finish {});
    rejected(&e, Rejection::EngineOwned);
    assert_eq!(finish(e).direct.metrics.payments_recorded, 0);
}
#[test]
fn downstream_duplicate_receipt_is_preserved_as_rejection_not_second_payment() {
    let mut e = setup();
    accept(&mut e, 2, 0);
    pay(&mut e, 3, 0);
    pay(&mut e, 3, 0);
    assert!(matches!(
        e.journal().last().unwrap().outcome,
        CommunityOutcome::Forwarded {
            direct_outcome: DirectOutcome::Rejected { .. },
            ..
        }
    ));
    let r = finish(e);
    assert_eq!(r.direct.metrics.payments_recorded, 100);
    assert_eq!(r.metrics.downstream_rejections, 1);
}
#[test]
fn related_operator_activity_is_flagged_without_claiming_independence() {
    let mut e = CommunityEngine::new(config()).unwrap();
    for id in 0..2 {
        let mut r = registration(id);
        r.operator_id = 0;
        e.record(
            0,
            Actor::Operator { operator_id: 0 },
            CommunityCommand::Register { registration: r },
        )
        .unwrap();
    }
    e.record(
        1,
        actor(0),
        CommunityCommand::CreateProject {
            project_id: 0,
            title: "Shared operator".into(),
            summary: "Explicit fixture relation.".into(),
        },
    )
    .unwrap();
    e.record(
        1,
        actor(0),
        CommunityCommand::PublishOffer {
            offer_id: 0,
            project_id: 0,
            title: "Declared work".into(),
            criteria_digest: "c".repeat(64),
            amount: 100,
            delivery_ticks: 6,
        },
    )
    .unwrap();
    accept(&mut e, 2, 0);
    let r = finish(e);
    assert!(r.orders[0].related_operator);
    assert_eq!(r.metrics.related_operator_orders, 1);
}
#[test]
fn rehashed_profile_or_order_link_cannot_hide_a_changed_transcript() {
    let mut e = setup();
    accept(&mut e, 2, 0);
    let original = finish(e);
    let mut forged = original.clone();
    forged.agents[0].registration.operator_id = 2;
    forged.fingerprint = forged.hash().unwrap();
    assert!(forged.verify().is_err());
    let mut forged = original;
    forged.orders[0].offer_id = 99;
    forged.fingerprint = forged.hash().unwrap();
    assert!(forged.verify().is_err());
}
#[test]
fn rehashed_journal_outcome_or_provenance_is_rejected() {
    let mut e = setup();
    accept(&mut e, 2, 0);
    let original = finish(e);
    let mut forged = original.clone();
    forged.journal[0].actor = actor(0);
    forged.fingerprint = forged.hash().unwrap();
    assert!(forged.verify().is_err());
    let mut forged = original;
    forged.provenance.slot = Some(123);
    forged.fingerprint = forged.hash().unwrap();
    assert!(forged.verify().is_err());
}
#[test]
fn finished_or_unfinished_engine_cannot_claim_false_completion() {
    let mut e = setup();
    assert!(CommunityReport::from_engine(&e).is_err());
    e.finish().unwrap();
    assert!(e.finish().is_err());
    assert!(e
        .record(
            19,
            actor(0),
            CommunityCommand::Rename {
                agent_id: 0,
                handle: "closed".into()
            }
        )
        .is_err());
}
#[test]
fn bounded_config_and_unknown_fields_do_not_echo_sensitive_input() {
    let e = WorkloadConfig::from_toml("secret='sensitive value'").unwrap_err();
    assert!(!e.to_string().contains("sensitive"));
    let mut c = workload();
    c.tasks = 501;
    assert!(c.validate().is_err());
    let mut e = setup();
    let before = e.journal().len();
    assert!(e
        .record(
            2,
            actor(0),
            CommunityCommand::Post {
                post_id: 0,
                project_id: None,
                reply_to: None,
                body: "x".repeat(513)
            }
        )
        .is_err());
    assert_eq!(e.journal().len(), before);
    finish(e);
}
#[test]
fn matched_scenarios_expose_unpaid_capacity_spam_and_provider_absence() {
    let balanced = RunReport::generate(workload(), Scenario::Balanced).unwrap();
    balanced.verify().unwrap();
    let spam = RunReport::generate(workload(), Scenario::SpamReservations).unwrap();
    spam.verify().unwrap();
    let offline = RunReport::generate(workload(), Scenario::ProviderOffline).unwrap();
    offline.verify().unwrap();
    assert_eq!(balanced.intents, spam.intents);
    assert_eq!(balanced.intents, offline.intents);
    assert_eq!(spam.community.metrics.accepted_orders, 160);
    assert_eq!(spam.community.metrics.unpaid_at_finish, 160);
    assert_eq!(spam.community.metrics.provider_capacity_rejections, 100);
    assert_eq!(spam.community.direct.metrics.payments_recorded, 0);
    assert_eq!(spam.community.metrics.post_rate_rejections, 3);
    assert!(offline.community.metrics.accepted_orders < balanced.community.metrics.accepted_orders);
}
#[test]
fn seeds_change_intentions_but_identical_inputs_are_byte_stable() {
    let a = RunReport::generate(workload(), Scenario::Balanced).unwrap();
    let b = RunReport::generate(workload(), Scenario::Balanced).unwrap();
    assert_eq!(a, b);
    let mut c = workload();
    c.seed = 99;
    let changed = RunReport::generate(c, Scenario::Balanced).unwrap();
    assert_ne!(a.intentions_fingerprint, changed.intentions_fingerprint);
    assert_eq!(
        serde_json::to_vec(&a).unwrap(),
        serde_json::to_vec(&b).unwrap()
    );
}
#[test]
fn rehashed_run_or_batch_metrics_cannot_claim_invented_output() {
    let mut run = RunReport::generate(workload(), Scenario::Balanced).unwrap();
    run.intents[0].provider = 3;
    run.fingerprint = run.hash().unwrap();
    assert!(run.verify().is_err());
    let config = BatchConfig {
        workload: workload(),
        seeds: vec![7, 42],
        scenarios: vec![Scenario::Balanced, Scenario::SpamReservations],
    };
    let mut batch = BatchReport::generate(config).unwrap();
    batch.verify().unwrap();
    batch.runs[0].metrics.acknowledged_deliveries += 1;
    batch.fingerprint = batch.hash().unwrap();
    assert!(batch.verify().is_err());
}
#[test]
fn export_requires_replay_and_preserves_missingness_and_spreadsheet_text_guard() {
    let mut e = setup();
    e.record(
        1,
        actor(0),
        CommunityCommand::PublishOffer {
            offer_id: 1,
            project_id: 0,
            title: "=HYPERLINK(\"bad\")".into(),
            criteria_digest: "c".repeat(64),
            amount: 100,
            delivery_ticks: 6,
        },
    )
    .unwrap();
    e.record(
        2,
        actor(1),
        CommunityCommand::AcceptOffer {
            offer_id: 1,
            agreement_id: 0,
        },
    )
    .unwrap();
    let r = finish(e);
    let json = serde_json::to_string(&r).unwrap();
    let csv = community_export::csv(&json).unwrap();
    assert!(csv.contains("\"'=HYPERLINK(\"\"bad\"\")\""));
    assert!(csv.contains("UNAVAILABLE"));
    assert!(csv.contains("CSV_TEXT_GUARD_V1"));
    let mut forged = r;
    forged.metrics.registered_agents = 999;
    forged.fingerprint = forged.hash().unwrap();
    let json = serde_json::to_string(&forged).unwrap();
    assert!(community_export::csv(&json).is_err());
    assert!(viewer::export(&json).is_err());
}
#[test]
fn viewer_escapes_scripted_content_and_never_connects_to_a_wallet() {
    let mut e = setup();
    e.record(
        2,
        actor(1),
        CommunityCommand::Post {
            post_id: 0,
            project_id: None,
            reply_to: None,
            body: "</script><img src=x onerror=alert(1)>".into(),
        },
    )
    .unwrap();
    let html = viewer::export(&serde_json::to_string(&finish(e)).unwrap()).unwrap();
    assert!(html.contains("\\u003c/script\\u003e"));
    assert_eq!(html.matches("</script>").count(), 2);
    assert!(!html.contains("<img src=x"));
    assert!(html.contains("connect-src 'none'"));
    assert!(html.contains("NO_WALL_CLOCK_OR_CHAIN_PROOF"));
}
#[test]
fn browser_export_preserves_large_u64_ids_quotes_and_request_amounts() {
    let mut e = setup();
    e.record(
        1,
        actor(0),
        CommunityCommand::PublishOffer {
            offer_id: u64::MAX,
            project_id: 0,
            title: "Exact quote".into(),
            criteria_digest: "c".repeat(64),
            amount: u64::MAX,
            delivery_ticks: 6,
        },
    )
    .unwrap();
    e.record(
        2,
        actor(1),
        CommunityCommand::AcceptOffer {
            offer_id: u64::MAX,
            agreement_id: u64::MAX,
        },
    )
    .unwrap();
    workflow(
        &mut e,
        3,
        1,
        DirectCommand::PaymentReceipt {
            receipt: Receipt::synthetic(u64::MAX, 0, 1, 0, u64::MAX, 3),
        },
    );
    workflow(
        &mut e,
        4,
        1,
        DirectCommand::RequestRefund {
            agreement_id: u64::MAX,
            client: 1,
            amount: u64::MAX,
            reason_digest: "f".repeat(64),
        },
    );
    let report = finish(e);
    let html = viewer::export(&serde_json::to_string(&report).unwrap()).unwrap();
    let encoded = html
        .split("<script id=\"community-data\" type=\"application/json\">")
        .nth(1)
        .unwrap()
        .split("</script>")
        .next()
        .unwrap();
    let payload: serde_json::Value = serde_json::from_str(encoded).unwrap();
    assert_eq!(payload["offers"][1]["amount"], u64::MAX.to_string());
    assert_eq!(payload["offers"][1]["offer_id"], u64::MAX.to_string());
    assert_eq!(
        payload["direct"]["agreements"][0]["refund_request_remaining"],
        u64::MAX.to_string()
    );
}

#[test]
fn seeded_viewer_preserves_full_u64_seed_for_reproducibility() {
    let mut config = workload();
    config.seed = u64::MAX;
    let report = RunReport::generate(config, Scenario::Balanced).unwrap();
    let html = viewer::export(&serde_json::to_string(&report).unwrap()).unwrap();
    let encoded = html.split("<script id=\"community-data\" type=\"application/json\">").nth(1).unwrap().split("</script>").next().unwrap();
    let payload: serde_json::Value = serde_json::from_str(encoded).unwrap();
    assert_eq!(payload["seed"], u64::MAX.to_string());
}
