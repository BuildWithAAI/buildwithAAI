use zoora_review_market::{
    ownership::*, ownership_scenarios::*, recovery::*, recovery_scenarios::RecoveryCampaign,
    trust::*, trust_scenarios::TrustCampaign,
};
fn config() -> OwnerConfig {
    OwnerConfig::from_toml(include_str!("../configs/owner-campaign.toml")).unwrap()
}
fn campaign() -> &'static OwnerCampaign {
    static C: std::sync::OnceLock<OwnerCampaign> = std::sync::OnceLock::new();
    C.get_or_init(|| OwnerCampaign::generate(config()).unwrap())
}
fn run(name: &str, policy: OwnerPolicy) -> OwnerReport {
    campaign()
        .cases
        .iter()
        .find(|c| c.name == name)
        .unwrap()
        .runs
        .iter()
        .find(|r| r.input.policy == policy)
        .unwrap()
        .clone()
}
fn owner(r: &OwnerReport, op: u64) -> &OwnerState {
    r.owners.iter().find(|o| o.operator == op).unwrap()
}
fn rejected(r: &OwnerReport, reason: OwnerRejection) -> usize {
    r.journal
        .iter()
        .filter(|r| matches!(r.outcome,OwnerOutcome::Refused{reason:x,..} if x==reason))
        .count()
}
fn applied_open(r: &OwnerReport) -> usize {
    r.journal
        .iter()
        .filter(|r| {
            matches!(
                &r.action.command,
                RecoveryCommand::Trust {
                    command: TrustCommand::OpenContract { .. },
                    ..
                }
            ) && r.outcome
                == OwnerOutcome::Forwarded {
                    outcome: RecoveryOutcome::Trust {
                        outcome: TrustOutcome::Applied {},
                    },
                }
        })
        .count()
}
#[test]
fn all_thirteen_scenarios_and_three_policies_replay() {
    let c = campaign();
    assert_eq!(c.cases.len(), 13);
    assert!(c.cases.iter().all(|x| x.runs.len() == 3));
    c.verify().unwrap();
}
#[test]
fn every_policy_receives_exactly_the_same_original_actions() {
    for c in &campaign().cases {
        for r in &c.runs {
            assert_eq!(r.input.actions, c.actions);
            assert_eq!(r.input.config, c.config);
        }
    }
}
#[test]
fn declared_wallet_aliases_do_not_multiply_owner_capacity() {
    let a = run("DECLARED_WALLET_ROTATION", OwnerPolicy::AgentOnly);
    let c = run("DECLARED_WALLET_ROTATION", OwnerPolicy::OwnerCount);
    let r = run("DECLARED_WALLET_ROTATION", OwnerPolicy::OwnerRisk);
    assert_eq!(applied_open(&a), 3);
    assert_eq!(applied_open(&c), 1);
    assert_eq!(applied_open(&r), 1);
    assert_eq!(owner(&r, 0).agents, vec![0, 5, 7]);
    assert_eq!(rejected(&r, OwnerRejection::OwnerWorkLimit), 2);
}
#[test]
fn one_large_contract_cannot_bypass_the_reserved_payment_budget() {
    let c = run("LARGE_SINGLE_OBLIGATION", OwnerPolicy::OwnerCount);
    let r = run("LARGE_SINGLE_OBLIGATION", OwnerPolicy::OwnerRisk);
    assert_eq!(applied_open(&c), 1);
    assert_eq!(applied_open(&r), 0);
    assert_eq!(rejected(&r, OwnerRejection::OwnerPaymentLimit), 1);
    assert_eq!(c.metrics.payments_recorded, 101);
    assert_eq!(r.metrics.payments_recorded, 0);
}
#[test]
fn best_current_member_tier_sets_owner_capacity_instead_of_summing_aliases() {
    let r = run("TIERED_OWNER_CAPACITY", OwnerPolicy::OwnerRisk);
    assert_eq!(owner(&r, 0).tier, 1);
    assert_eq!(owner(&r, 0).work_limit, 2);
    assert_eq!(owner(&r, 0).payment_limit, 300);
    assert_eq!(owner(&r, 0).limit_source_agent, 0);
    assert_eq!(applied_open(&r), 4);
    assert_eq!(rejected(&r, OwnerRejection::OwnerWorkLimit), 1);
}
#[test]
fn unpaid_contracts_reserve_full_notional_before_receipts() {
    let r = run("UNPAID_EXPIRY_RETRY", OwnerPolicy::OwnerRisk);
    let row = r
        .journal
        .iter()
        .find(|r| matches!(r.outcome, OwnerOutcome::Refused { .. }))
        .unwrap();
    let o = row.owners_after.iter().find(|o| o.operator == 0).unwrap();
    assert_eq!(o.reserved_payment_units, 100);
    assert_eq!(o.active_assigned_net_units, 0);
    assert_eq!(o.active_lead_net_units, 0);
}
#[test]
fn unpaid_expiry_releases_owner_capacity_before_same_tick_retry() {
    let r = run("UNPAID_EXPIRY_RETRY", OwnerPolicy::OwnerRisk);
    assert_eq!(applied_open(&r), 2);
    assert_eq!(r.recovery.trust.contracts.len(), 2);
    assert_eq!(r.metrics.payments_recorded, 0);
    assert_eq!(owner(&r, 0).active_agreements.len(), 0);
}
#[test]
fn partial_return_does_not_release_the_reserved_notional() {
    let r = run("PARTIAL_AND_FULL_RETURN", OwnerPolicy::OwnerRisk);
    let row = r
        .journal
        .iter()
        .find(|r| matches!(r.outcome, OwnerOutcome::Refused { .. }))
        .unwrap();
    let o = row.owners_after.iter().find(|o| o.operator == 0).unwrap();
    assert_eq!(o.reserved_payment_units, 100);
    assert_eq!(o.active_assigned_net_units, 70);
    assert_eq!(o.active_agreements, vec![0]);
}
#[test]
fn full_observed_return_releases_capacity_without_recycling_work_credit() {
    let r = run("PARTIAL_AND_FULL_RETURN", OwnerPolicy::OwnerRisk);
    assert_eq!(applied_open(&r), 2);
    assert_eq!(r.metrics.voluntary_returns_recorded, 100);
    assert_eq!(r.metrics.net_transferred, 100);
    assert!(r
        .recovery
        .trust
        .contracts
        .iter()
        .all(|w| w.credit_shares.is_empty()));
}
#[test]
fn valid_late_receipts_are_recorded_even_when_owner_limits_are_exceeded() {
    let r = run("LATE_RECEIPT_OVERAGE", OwnerPolicy::OwnerRisk);
    let o = owner(&r, 0);
    assert_eq!(r.metrics.payments_recorded, 200);
    assert_eq!(r.metrics.voluntary_returns_recorded, 0);
    assert_eq!(o.active_agreements.len(), 2);
    assert_eq!(o.reserved_payment_units, 200);
    assert!(o.over_work_limit && o.over_payment_limit && o.dispute_hold);
    assert!(rejected(&r, OwnerRejection::OwnerHold) > 0);
}
#[test]
fn alias_cannot_join_a_new_group_during_an_owner_dispute_hold() {
    let c = run("DISPUTE_HOLD_PROPAGATION", OwnerPolicy::OwnerCount);
    let r = run("DISPUTE_HOLD_PROPAGATION", OwnerPolicy::OwnerRisk);
    assert_eq!(rejected(&r, OwnerRejection::OwnerHold), 1);
    assert_eq!(c.metrics.owner_rejections, 0);
    let row = r
        .journal
        .iter()
        .find(|r| {
            matches!(
                r.outcome,
                OwnerOutcome::Refused {
                    reason: OwnerRejection::OwnerHold,
                    ..
                }
            )
        })
        .unwrap();
    assert!(
        row.owners_after
            .iter()
            .find(|o| o.operator == 0)
            .unwrap()
            .dispute_hold
    );
}
#[test]
fn accepted_review_and_maturity_restore_owner_admission() {
    let r = run("DISPUTE_HOLD_PROPAGATION", OwnerPolicy::OwnerRisk);
    assert_eq!(r.recovery.cases[0].status, CaseStatus::FinalAccepted);
    assert!(!owner(&r, 0).dispute_hold);
    assert_eq!(owner(&r, 0).tier, 1);
    assert!(r
        .recovery
        .trust
        .groups
        .iter()
        .any(|g| g.id == 9 && g.members == vec![5]));
}
#[test]
fn same_owner_collective_counts_once_for_contract_and_notional() {
    let r = run("COLLECTIVE_SAME_OWNER", OwnerPolicy::OwnerRisk);
    let open = r
        .journal
        .iter()
        .find(|r| {
            matches!(
                r.action.command,
                RecoveryCommand::Trust {
                    command: TrustCommand::OpenContract { .. },
                    ..
                }
            ) && r.outcome
                == OwnerOutcome::Forwarded {
                    outcome: RecoveryOutcome::Trust {
                        outcome: TrustOutcome::Applied {},
                    },
                }
        })
        .unwrap();
    let o = open.owners_after.iter().find(|o| o.operator == 0).unwrap();
    assert_eq!(o.active_agreements, vec![0]);
    assert_eq!(o.reserved_payment_units, 100);
    assert_eq!(rejected(&r, OwnerRejection::OwnerWorkLimit), 1);
}
#[test]
fn group_credit_remains_exact_and_does_not_become_member_payouts() {
    let r = run("COLLECTIVE_SAME_OWNER", OwnerPolicy::OwnerRisk);
    assert_eq!(
        r.recovery.trust.profiles[0].earned_credit_microunits,
        606_000
    );
    assert_eq!(
        r.recovery.trust.profiles[5].earned_credit_microunits,
        404_000
    );
    assert_eq!(r.recovery.trust.direct.agreements[0].terms.provider, 0);
}
#[test]
fn different_group_owners_each_receive_a_full_conservative_assignment_charge() {
    let r = run("COLLECTIVE_DIFFERENT_OWNERS", OwnerPolicy::OwnerRisk);
    for op in [0, 3, 4] {
        assert_eq!(owner(&r, op).reserved_payment_units, 100);
    }
    assert_eq!(owner(&r, 0).active_lead_net_units, 100);
    assert_eq!(owner(&r, 3).active_lead_net_units, 0);
    assert_eq!(owner(&r, 4).active_lead_net_units, 100);
    assert_eq!(r.metrics.payments_recorded, 200);
    assert_eq!(
        r.owners
            .iter()
            .map(|o| o.active_assigned_net_units)
            .sum::<u128>(),
        300
    );
}
#[test]
fn other_declared_owners_are_not_blocked_by_one_owners_reservation() {
    let r = run("COLLECTIVE_DIFFERENT_OWNERS", OwnerPolicy::OwnerRisk);
    assert_eq!(r.metrics.owner_rejections, 0);
    assert_eq!(applied_open(&r), 2);
}
#[test]
fn owner_downgrade_preserves_existing_work_and_money() {
    let r = run("OWNER_DOWNGRADE", OwnerPolicy::OwnerRisk);
    let o = owner(&r, 0);
    assert_eq!(o.tier, 0);
    assert_eq!(o.work_limit, 1);
    assert_eq!(o.active_agreements.len(), 4);
    assert_eq!(o.reserved_payment_units, 400);
    assert!(o.over_work_limit && o.over_payment_limit);
    assert_eq!(r.metrics.voluntary_returns_recorded, 0);
    assert_eq!(r.metrics.payments_recorded, 900);
}
#[test]
fn an_unverified_alias_does_not_inherit_the_peers_individual_tier() {
    let r = run("UNVERIFIED_ALIAS", OwnerPolicy::OwnerRisk);
    assert_eq!(owner(&r, 0).tier, 1);
    assert_eq!(r.recovery.trust.profiles[5].tier, 0);
    assert!(!r.recovery.trust.profiles[5].review_fixture_approved);
    assert!(r.journal.iter().any(|r| r.outcome
        == OwnerOutcome::Forwarded {
            outcome: RecoveryOutcome::Trust {
                outcome: TrustOutcome::Rejected {
                    reason: TrustRejection::WorkLimit
                }
            }
        }));
    assert_eq!(r.metrics.owner_rejections, 0);
}
#[test]
fn exposure_totals_above_u64_stay_exact() {
    let c = run("LARGE_EXACT_TOTALS", OwnerPolicy::OwnerCount);
    let r = run("LARGE_EXACT_TOTALS", OwnerPolicy::OwnerRisk);
    assert_eq!(c.metrics.payments_recorded, 200 + 2 * u128::from(u64::MAX));
    assert_eq!(r.metrics.payments_recorded, 200 + u128::from(u64::MAX));
    assert_eq!(
        owner(&c, 0).reserved_payment_units,
        2 * u128::from(u64::MAX)
    );
    assert_eq!(rejected(&r, OwnerRejection::OwnerPaymentLimit), 1);
    let text = serde_json::to_string(&c).unwrap();
    assert!(text.contains(&(200 + 2 * u128::from(u64::MAX)).to_string()));
}
#[test]
fn hidden_common_control_still_bypasses_unverified_declared_labels() {
    let r = run("HIDDEN_COMMON_CONTROL", OwnerPolicy::OwnerRisk);
    assert_eq!(applied_open(&r), 3);
    assert!(r.owners.iter().any(|o| o.operator == 50));
    assert!(r.owners.iter().any(|o| o.operator == 70));
}
#[test]
fn incoming_receipts_and_returns_are_never_owner_refused() {
    for c in &campaign().cases {
        for r in &c.runs {
            for row in &r.journal {
                if matches!(
                    row.action.command,
                    RecoveryCommand::Trust {
                        command: TrustCommand::Direct { .. },
                        ..
                    }
                ) {
                    assert!(matches!(row.outcome, OwnerOutcome::Forwarded { .. }));
                }
            }
        }
    }
}
#[test]
fn each_original_attempt_has_a_canonical_clock_and_exact_delegation_link() {
    for c in &campaign().cases {
        for r in &c.runs {
            let mut next = 0;
            for row in &r.journal {
                assert_eq!(row.advance_sequence, next);
                assert_eq!(
                    r.recovery.journal[next].action,
                    RecoveryAction {
                        tick: row.action.tick,
                        command: RecoveryCommand::Advance {}
                    }
                );
                next += 1;
                if let Some(i) = row.delegated_sequence {
                    assert_eq!(i, next);
                    assert_eq!(r.recovery.journal[i].action, row.action);
                    next += 1;
                } else {
                    assert!(matches!(row.outcome, OwnerOutcome::Refused { .. }));
                }
            }
            assert_eq!(next, r.recovery.journal.len());
        }
    }
}
#[test]
fn rehashed_owner_limits_snapshots_or_delegation_forgery_cannot_replay() {
    let r = run("DECLARED_WALLET_ROTATION", OwnerPolicy::OwnerRisk);
    let mut candidates = vec![];
    let mut f = r.clone();
    f.owners[0].reserved_payment_units = 0;
    candidates.push(f);
    let mut f = r.clone();
    f.journal[0].advance_sequence += 1;
    candidates.push(f);
    let mut f = r.clone();
    f.journal[0].owners_after[0].work_limit = 100;
    candidates.push(f);
    let mut f = r.clone();
    f.metrics.payments_recorded += 1;
    candidates.push(f);
    for mut f in candidates {
        f.fingerprint = f.hash().unwrap();
        assert!(f.verify().is_err());
    }
}
#[test]
fn report_arrays_time_and_unknown_input_fields_are_bounded() {
    let r = run("DECLARED_WALLET_ROTATION", OwnerPolicy::OwnerRisk);
    let mut i = r.input.clone();
    i.actions = vec![i.actions[0].clone(); 2049];
    assert!(OwnerReport::generate(i).is_err());
    let mut i = r.input.clone();
    i.actions.push(i.actions[0].clone());
    assert!(OwnerReport::generate(i).is_err());
    let mut v = serde_json::to_value(r.input).unwrap();
    v["hidden_override"] = true.into();
    assert!(serde_json::from_value::<OwnerInput>(v).is_err());
    let mut c = config();
    c.payment_caps = [100, 50, 1000];
    assert!(c.validate().is_err());
    let mut c = config();
    c.payment_caps[0] = 0;
    assert!(c.validate().is_err());
}
#[test]
fn previous_recovery_and_trust_reference_fingerprints_remain_unchanged() {
    let cfg = config().recovery;
    assert_eq!(
        RecoveryCampaign::generate(cfg.clone()).unwrap().fingerprint,
        "85a846c501f22791e8d299684b7877ba3f6ced09959361f1a429a3b0058d61da"
    );
    assert_eq!(
        TrustCampaign::generate(cfg.trust).unwrap().fingerprint,
        "f5bdab1d42c6663fe1bb8b989e99cac8385022a35a9d90e8cde3e9f4e3c08c68"
    );
}
#[test]
fn generic_recovery_report_owns_its_replay_without_hidden_owner_context() {
    for c in &campaign().cases {
        for r in &c.runs {
            r.recovery.verify().unwrap();
        }
    }
}
#[test]
fn valid_but_incompatible_fixture_settings_return_errors_without_panics() {
    let mut c = config();
    c.recovery.trust.maturity_ticks = c.recovery.complaint_ticks;
    c.validate().unwrap();
    assert!(OwnerCampaign::generate(c).is_err());
}
