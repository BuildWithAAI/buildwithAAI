use zoora_review_market::{
    direct::{DirectCommand, Receipt},
    trust::*,
    trust_scenarios::*,
};
fn config() -> TrustConfig {
    TrustConfig::from_toml(include_str!("../configs/trust-campaign.toml")).unwrap()
}
fn campaign() -> TrustCampaign {
    static CAMPAIGN: std::sync::OnceLock<TrustCampaign> = std::sync::OnceLock::new();
    CAMPAIGN
        .get_or_init(|| TrustCampaign::generate(config()).unwrap())
        .clone()
}
fn case(c: &TrustCampaign, name: &str) -> TrustReport {
    c.cases.iter().find(|x| x.name == name).unwrap().run.clone()
}
fn rejected(r: &TrustReport, reason: TrustRejection) -> usize {
    r.journal
        .iter()
        .filter(|x| x.outcome == TrustOutcome::Rejected { reason })
        .count()
}
fn act(tick: u64, agent: u64, command: TrustCommand) -> TrustAction {
    TrustAction {
        tick,
        actor: TrustActor::Agent { agent },
        command,
    }
}
fn modify(r: TrustReport, f: impl FnOnce(&mut TrustInput)) -> TrustReport {
    let mut i = r.input;
    f(&mut i);
    TrustReport::generate(i).unwrap()
}

#[test]
fn starter_has_one_work_and_one_membership_in_each_section() {
    let r = case(&campaign(), "STARTER_LIMITS");
    assert_eq!(
        r.profiles[0].limits,
        TrustLimits {
            work: 1,
            development: 1,
            community_funded: 1
        }
    );
    assert_eq!(rejected(&r, TrustRejection::MembershipLimit), 2);
    assert_eq!(rejected(&r, TrustRejection::WorkLimit), 1);
    assert_eq!(r.contracts.len(), 1);
    assert_eq!(r.profiles[0].active_contracts, 1); // paid unfinished work retains a slot after deadline
}
#[test]
fn reviewed_work_volume_and_verification_are_separate_gates() {
    let r = case(&campaign(), "ESTABLISHED_HISTORY");
    let before = r
        .journal
        .iter()
        .find(|x| {
            matches!(
                x.action.command,
                TrustCommand::ReviewAgent {
                    agent: 0,
                    approved: true,
                    ..
                }
            )
        })
        .unwrap();
    let prev = &r.journal[before.sequence - 1].profiles_after[0];
    assert_eq!(prev.earned_credit_microunits, 500 * CREDIT_SCALE);
    assert_eq!(prev.tier, 0);
    assert_eq!(before.profiles_after[0].tier, 2);
    assert_eq!(r.profiles[0].limits.work, 4);
    assert_eq!(rejected(&r, TrustRejection::WorkLimit), 1);
}
#[test]
fn a_large_task_and_small_tasks_earn_equal_units_but_need_customer_diversity() {
    let c = campaign();
    let a = case(&c, "SMALL_TASKS");
    let b = case(&c, "ONE_LARGE_TASK");
    assert_eq!(
        a.profiles[0].earned_credit_microunits,
        b.profiles[0].earned_credit_microunits
    );
    assert_eq!(a.profiles[0].tier, 1);
    assert_eq!(b.profiles[0].tier, 0);
    assert_eq!(b.profiles[0].customer_operators, 1);
}
#[test]
fn starter_limits_expand_only_to_the_earned_tier() {
    let r = case(&campaign(), "BALANCED_HISTORY");
    assert_eq!(r.profiles[0].tier, 1);
    assert_eq!(r.profiles[0].active_contracts, 2);
    assert_eq!(rejected(&r, TrustRejection::WorkLimit), 1);
}
#[test]
fn root_budget_caps_split_task_credits_without_a_per_task_bonus() {
    let r = case(&campaign(), "ROOT_TASK_SPLITTING");
    assert_eq!(r.profiles[0].earned_credit_microunits, 100 * CREDIT_SCALE);
    assert_eq!(rejected(&r, TrustRejection::ProjectBudget), 1);
    assert_eq!(
        r.projects.iter().find(|p| p.id == 1).unwrap().issued_units,
        100
    );
}
#[test]
fn payment_size_does_not_purchase_a_trust_tier_and_large_totals_remain_exact() {
    let r = case(&campaign(), "HIGH_PAYMENT_VOLUME");
    assert_eq!(r.direct.metrics.payments_recorded, 2 * u128::from(u64::MAX));
    assert_eq!(r.profiles[0].earned_credit_microunits, 2 * CREDIT_SCALE);
    assert_eq!(r.profiles[0].tier, 0);
}
#[test]
fn declared_common_control_earns_zero_self_dealing_credit_and_one_customer_identity() {
    let r = case(&campaign(), "RELATED_CUSTOMER");
    assert_eq!(r.contracts[0].credit_shares[0].earned_microunits, 0);
    assert_eq!(r.profiles[0].customer_operators, 1);
    assert_eq!(r.profiles[0].tier, 0);
    assert_eq!(r.profiles[0].earned_credit_microunits, 200 * CREDIT_SCALE);
}
#[test]
fn collective_work_is_divided_exactly_and_occupies_each_participants_global_slot() {
    let r = case(&campaign(), "COLLECTIVE_ATTRIBUTION");
    assert_eq!(r.profiles[0].earned_credit_microunits, 1_212_000);
    assert_eq!(r.profiles[3].earned_credit_microunits, 808_000);
    assert_eq!(rejected(&r, TrustRejection::WorkLimit), 2);
    assert_eq!(rejected(&r, TrustRejection::ActiveGroupWork), 2);
    for c in &r.contracts {
        assert_eq!(
            c.credit_shares
                .iter()
                .map(|s| s.allocated_microunits)
                .sum::<u64>(),
            c.plan.work_units * CREDIT_SCALE
        );
    }
    // These are experience credits; all direct receipts still pay the lead.
    assert!(r.direct.agreements.iter().all(|a| a.terms.provider == 0));
}
#[test]
fn unaccepted_or_unmatured_work_cannot_earn_credit() {
    let r = case(&campaign(), "PREMATURE_CREDIT");
    assert_eq!(rejected(&r, TrustRejection::WrongState), 1);
    assert_eq!(rejected(&r, TrustRejection::TooEarly), 1);
    assert_eq!(r.profiles[0].earned_credit_microunits, 100 * CREDIT_SCALE);
}
#[test]
fn dispute_removes_usable_credit_and_pauses_new_commitments_without_moving_money() {
    let r = case(&campaign(), "DISPUTE_AFTER_CREDIT");
    assert_eq!(r.profiles[0].earned_credit_microunits, 50 * CREDIT_SCALE);
    assert!(r.profiles[0].dispute_hold);
    assert_eq!(r.profiles[0].tier, 0);
    assert_eq!(rejected(&r, TrustRejection::DisputeHold), 1);
    assert_eq!(r.direct.metrics.net_transferred, 200);
    assert_eq!(r.direct.metrics.voluntary_refunds_recorded, 0);
}
#[test]
fn actual_voluntary_return_removes_credit_but_does_not_create_a_forced_refund() {
    let r = case(&campaign(), "REFUND_AFTER_CREDIT");
    assert_eq!(r.profiles[0].earned_credit_microunits, 50 * CREDIT_SCALE);
    assert_eq!(r.direct.metrics.voluntary_refunds_recorded, 100);
    assert_eq!(r.direct.metrics.net_transferred, 100);
    assert_eq!(r.profiles[0].active_contracts, 0);
}
#[test]
fn verification_downgrade_keeps_existing_work_and_blocks_expansion() {
    let r = case(&campaign(), "VERIFICATION_REVOKED");
    assert_eq!(r.profiles[0].tier, 0);
    assert_eq!(r.profiles[0].active_contracts, 4);
    assert_eq!(r.profiles[0].earned_credit_microunits, 500 * CREDIT_SCALE);
    assert_eq!(rejected(&r, TrustRejection::WorkLimit), 1);
    assert_eq!(r.direct.metrics.voluntary_refunds_recorded, 0);
}
#[test]
fn per_agent_limit_does_not_claim_to_prevent_wallet_rotation() {
    let r = case(&campaign(), "WALLET_ROTATION");
    assert_eq!(
        [0, 5, 7]
            .iter()
            .map(|a| r.profiles[*a].active_contracts)
            .sum::<usize>(),
        3
    );
    assert!([0, 5, 7].iter().all(|a| r.profiles[*a].tier == 0));
}
#[test]
fn identical_artifact_reference_cannot_earn_credit_twice() {
    let r = case(&campaign(), "REUSED_ARTIFACT");
    assert_eq!(rejected(&r, TrustRejection::ReusedArtifact), 1);
    assert_eq!(r.profiles[0].earned_credit_microunits, 50 * CREDIT_SCALE);
}
#[test]
fn forged_rehashed_profile_admission_or_credit_cannot_replay() {
    let c = campaign();
    let mut r = case(&c, "SMALL_TASKS");
    r.profiles[0].tier = 2;
    r.fingerprint = r.hash().unwrap();
    assert!(r.verify().is_err());
    let mut r = case(&c, "STARTER_LIMITS");
    let x = r
        .journal
        .iter_mut()
        .find(|x| {
            matches!(
                x.outcome,
                TrustOutcome::Rejected {
                    reason: TrustRejection::WorkLimit
                }
            )
        })
        .unwrap();
    x.outcome = TrustOutcome::Applied {};
    r.fingerprint = r.hash().unwrap();
    assert!(r.verify().is_err());
    let mut r = case(&c, "COLLECTIVE_ATTRIBUTION");
    r.contracts[0].credit_shares[0].earned_microunits += 1;
    r.fingerprint = r.hash().unwrap();
    assert!(r.verify().is_err());
    let mut c = c;
    c.cases.pop();
    c.fingerprint = c.hash().unwrap();
    assert!(c.verify().is_err());
}
#[test]
fn all_inputs_and_nested_direct_histories_round_trip() {
    let c = campaign();
    c.verify().unwrap();
    let raw = serde_json::to_vec(&c).unwrap();
    let decoded: TrustCampaign = serde_json::from_slice(&raw).unwrap();
    assert_eq!(c, decoded);
    assert_eq!(c.csv().unwrap().lines().count(), 1 + 15 * 8);
    for x in c.cases {
        x.run.verify().unwrap();
    }
}
#[test]
fn wrong_actor_and_missing_consent_have_no_contract_side_effects() {
    let r = case(&campaign(), "STARTER_LIMITS");
    let r = modify(r, |i| {
        i.actions
            .retain(|a| !matches!(a.command, TrustCommand::Consent { .. }));
    });
    assert!(r.contracts.is_empty());
    assert!(rejected(&r, TrustRejection::MissingConsent) > 0);
    let r = case(&campaign(), "SMALL_TASKS");
    let r = modify(r, |i| {
        for a in &mut i.actions {
            if matches!(a.command, TrustCommand::ConfirmWork { .. }) {
                a.actor = TrustActor::Agent { agent: 0 };
            }
        }
    });
    assert_eq!(r.profiles[0].earned_credit_microunits, 0);
}
#[test]
fn consent_binds_amount_scope_deadline_and_every_collective_member() {
    let r = case(&campaign(), "COLLECTIVE_ATTRIBUTION");
    let r = modify(r, |i| {
        for a in &mut i.actions {
            if let TrustCommand::OpenContract { plan } = &mut a.command {
                plan.payment_units += 1;
            }
        }
    });
    assert!(r.contracts.is_empty());
    assert!(rejected(&r, TrustRejection::MissingConsent) > 0);
}
#[test]
fn duplicate_payment_receipt_never_inflates_payment_or_credit() {
    let r = case(&campaign(), "ONE_LARGE_TASK");
    let r = modify(r, |i| {
        let pos = i
            .actions
            .iter()
            .position(|a| {
                matches!(
                    a.command,
                    TrustCommand::Direct {
                        command: DirectCommand::PaymentReceipt { .. }
                    }
                )
            })
            .unwrap();
        i.actions.insert(pos + 1, i.actions[pos].clone());
    });
    assert_eq!(r.direct.metrics.payments_recorded, 100);
    assert_eq!(rejected(&r, TrustRejection::DirectRejected), 1);
}
#[test]
fn a_receipt_fixture_cannot_impersonate_a_customer_or_reviewer() {
    let mut e = TrustEngine::new(config()).unwrap();
    assert_eq!(
        e.record(TrustAction {
            tick: 0,
            actor: TrustActor::ReceiptFixture {},
            command: TrustCommand::ReviewAgent {
                agent: 0,
                approved: true,
                evidence_digest: "a".repeat(64)
            }
        })
        .unwrap(),
        TrustOutcome::Rejected {
            reason: TrustRejection::WrongActor
        }
    );
    assert_eq!(
        e.record(act(
            0,
            0,
            TrustCommand::Direct {
                command: DirectCommand::PaymentReceipt {
                    receipt: Receipt::synthetic(0, 0, 1, 0, 100, 0)
                }
            }
        ))
        .unwrap(),
        TrustOutcome::Rejected {
            reason: TrustRejection::WrongActor
        }
    );
}
#[test]
fn client_review_and_minimum_age_are_independent_promotion_gates() {
    let r = case(&campaign(), "SMALL_TASKS");
    let r = modify(r, |i| {
        i.actions.retain(|a| {
            !matches!(
                a.command,
                TrustCommand::ReviewAgent {
                    agent: 1 | 2,
                    approved: true,
                    ..
                }
            )
        })
    });
    assert_eq!(r.profiles[0].earned_credit_microunits, 0);
    assert_eq!(rejected(&r, TrustRejection::CustomerNotReviewed), 10);
    let r = case(&campaign(), "SMALL_TASKS");
    let mut e = TrustEngine::new(TrustConfig {
        minimum_age_ticks: 190,
        ..config()
    })
    .unwrap();
    for a in r.input.actions {
        e.record(a).unwrap();
    }
    assert_eq!(e.profile(0).unwrap().tier, 0);
    assert_eq!(e.finish().unwrap().profiles[0].tier, 1);
}
#[test]
fn credits_are_partition_invariant_even_for_tiny_collective_shares() {
    let r = case(&campaign(), "COLLECTIVE_ATTRIBUTION");
    let r = modify(r, |i| {
        // Altering plans requires rebuilding every participant's bound consent.
        for a in &mut i.actions {
            if let TrustCommand::OpenContract { plan } = &mut a.command {
                if plan.group.is_none() {
                    continue;
                }
                plan.work_units = 1;
                plan.shares[0].basis_points = 1;
                plan.shares[1].basis_points = 9999;
            }
        }
        let plans: Vec<_> = i
            .actions
            .iter()
            .filter_map(|a| {
                if let TrustCommand::OpenContract { plan } = &a.command {
                    Some(plan.clone())
                } else {
                    None
                }
            })
            .collect();
        // Keep only successful collective contracts; re-issue bound consents immediately before each open.
        i.actions
            .retain(|a| !matches!(a.command, TrustCommand::Consent { .. }));
        let mut out = vec![];
        for a in &i.actions {
            if let TrustCommand::OpenContract { plan } = &a.command {
                if plan.group.is_some() {
                    let hash = plan.digest().unwrap();
                    for agent in
                        std::iter::once(plan.client).chain(plan.shares.iter().map(|s| s.agent))
                    {
                        out.push(act(
                            a.tick,
                            agent,
                            TrustCommand::Consent {
                                plan_digest: hash.clone(),
                            },
                        ));
                    }
                }
            }
            out.push(a.clone());
        }
        assert!(!plans.is_empty());
        i.actions = out;
    });
    assert_eq!(r.profiles[0].earned_credit_microunits, 2);
    assert_eq!(r.profiles[3].earned_credit_microunits, 19998);
}
#[test]
fn bounded_input_refuses_past_time_unknown_fields_and_excess_arrays() {
    let mut e = TrustEngine::new(config()).unwrap();
    e.record(act(
        2,
        0,
        TrustCommand::CreateGroup {
            id: 0,
            kind: GroupKind::Development,
        },
    ))
    .unwrap();
    assert!(e
        .record(act(
            1,
            0,
            TrustCommand::CreateGroup {
                id: 1,
                kind: GroupKind::Development
            }
        ))
        .is_err());
    let mut c = config();
    c.operators = vec![0; 65];
    assert!(TrustEngine::new(c).is_err());
    let mut value = serde_json::to_value(config()).unwrap();
    value["hidden_override"] = true.into();
    assert!(serde_json::from_value::<TrustConfig>(value).is_err());
    let mut c = config();
    c.operators.push(c.reviewer_operator);
    assert!(c.validate().is_err());
}

#[test]
fn membership_limits_cover_joins_creations_and_each_section_independently() {
    let mut e = TrustEngine::new(config()).unwrap();
    for (owner, id, kind) in [
        (1, 1, GroupKind::Development),
        (2, 2, GroupKind::Development),
        (1, 3, GroupKind::CommunityFunded),
    ] {
        e.record(act(0, owner, TrustCommand::CreateGroup { id, kind }))
            .unwrap();
    }
    assert_eq!(
        e.record(act(0, 0, TrustCommand::JoinGroup { id: 1 }))
            .unwrap(),
        TrustOutcome::Applied {}
    );
    assert_eq!(
        e.record(act(0, 0, TrustCommand::JoinGroup { id: 2 }))
            .unwrap(),
        TrustOutcome::Rejected {
            reason: TrustRejection::MembershipLimit
        }
    );
    assert_eq!(
        e.record(act(
            0,
            0,
            TrustCommand::CreateGroup {
                id: 4,
                kind: GroupKind::Development
            }
        ))
        .unwrap(),
        TrustOutcome::Rejected {
            reason: TrustRejection::MembershipLimit
        }
    );
    assert_eq!(
        e.record(act(0, 0, TrustCommand::JoinGroup { id: 3 }))
            .unwrap(),
        TrustOutcome::Applied {}
    );
    assert_eq!(
        e.record(act(0, 0, TrustCommand::LeaveGroup { id: 1 }))
            .unwrap(),
        TrustOutcome::Applied {}
    );
    assert_eq!(
        e.record(act(0, 0, TrustCommand::JoinGroup { id: 2 }))
            .unwrap(),
        TrustOutcome::Applied {}
    );
    e.finish().unwrap().verify().unwrap();
}

#[test]
fn partial_and_excess_receipts_cannot_create_completed_work_credit() {
    for amount in [50, 101] {
        let r = modify(case(&campaign(), "ONE_LARGE_TASK"), |i| {
            for a in &mut i.actions {
                if let TrustCommand::Direct {
                    command: DirectCommand::PaymentReceipt { receipt },
                } = &mut a.command
                {
                    receipt.amount = amount;
                }
            }
        });
        assert_eq!(r.profiles[0].earned_credit_microunits, 0);
        assert_eq!(
            r.direct.metrics.payments_recorded,
            if amount == 50 { 50 } else { 0 }
        );
    }
}

#[test]
fn every_collective_participant_must_consent_to_the_exact_plan() {
    let r = modify(case(&campaign(), "COLLECTIVE_ATTRIBUTION"), |i| {
        i.actions.retain(|a| {
            !matches!(
                (a.actor, &a.command),
                (TrustActor::Agent { agent: 3 }, TrustCommand::Consent { .. })
            )
        })
    });
    assert!(r.contracts.is_empty());
    assert!(rejected(&r, TrustRejection::MissingConsent) > 0);
}

#[test]
fn revoked_customer_review_stops_its_credit_from_supporting_promotion() {
    let r = modify(case(&campaign(), "SMALL_TASKS"), |i| {
        let tick = i.actions.last().unwrap().tick;
        i.actions.push(TrustAction {
            tick,
            actor: TrustActor::ReviewFixture {},
            command: TrustCommand::ReviewAgent {
                agent: 1,
                approved: false,
                evidence_digest: "f".repeat(64),
            },
        });
    });
    assert_eq!(r.profiles[0].earned_credit_microunits, 50 * CREDIT_SCALE);
    assert_eq!(r.profiles[0].customer_operators, 1);
    assert_eq!(r.profiles[0].tier, 0);
}
