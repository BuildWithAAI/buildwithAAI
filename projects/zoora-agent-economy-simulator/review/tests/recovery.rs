use zoora_review_market::{
    recovery::*, recovery_scenarios::*, trust::*, trust_scenarios::TrustCampaign,
};
fn config() -> RecoveryConfig {
    RecoveryConfig::from_toml(include_str!("../configs/recovery-campaign.toml")).unwrap()
}
fn campaign() -> RecoveryCampaign {
    static C: std::sync::OnceLock<RecoveryCampaign> = std::sync::OnceLock::new();
    C.get_or_init(|| RecoveryCampaign::generate(config()).unwrap())
        .clone()
}
fn case(name: &str) -> RecoveryReport {
    campaign()
        .cases
        .into_iter()
        .find(|c| c.name == name)
        .unwrap()
        .run
}
fn rejected(r: &RecoveryReport, reason: RecoveryRejection) -> usize {
    r.journal
        .iter()
        .filter(|x| x.outcome == RecoveryOutcome::Rejected { reason })
        .count()
}
fn input_until(r: &RecoveryReport, p: impl Fn(&RecoveryCommand) -> bool) -> RecoveryInput {
    let mut i = r.input.clone();
    let n = i.actions.iter().position(|a| p(&a.command)).unwrap();
    i.actions.truncate(n);
    i
}
fn append(i: &mut RecoveryInput, tick: u64, command: RecoveryCommand) {
    i.actions.push(RecoveryAction { tick, command });
}
fn regenerated(i: RecoveryInput) -> RecoveryReport {
    let r = RecoveryReport::generate(i).unwrap();
    r.verify().unwrap();
    r
}
fn accept_command(r: &RecoveryReport) -> RecoveryCommand {
    r.input
        .actions
        .iter()
        .find_map(|a| {
            matches!(a.command, RecoveryCommand::PrimaryVerdict { .. }).then_some(a.command.clone())
        })
        .unwrap()
}
#[test]
fn all_fifteen_cases_replay_deterministically() {
    let c = campaign();
    assert_eq!(c.cases.len(), 15);
    c.verify().unwrap();
    assert_eq!(c, RecoveryCampaign::generate(config()).unwrap());
}
#[test]
fn prior_ae016_fingerprint_is_unchanged() {
    let c = TrustCampaign::generate(config().trust).unwrap();
    assert_eq!(
        c.fingerprint,
        "f5bdab1d42c6663fe1bb8b989e99cac8385022a35a9d90e8cde3e9f4e3c08c68"
    );
}
#[test]
fn false_complaint_restores_earned_tier_after_review_and_maturity() {
    let r = case("FALSE_COMPLAINT_DISMISSED");
    assert_eq!(r.cases[0].status, CaseStatus::FinalAccepted);
    let opened = r
        .journal
        .iter()
        .find(|x| matches!(x.action.command, RecoveryCommand::OpenCase { .. }))
        .unwrap();
    assert!(opened.profiles_after[0].dispute_hold);
    assert_eq!(opened.profiles_after[0].earned_credit_microunits, 500_000);
    let p = &r.trust.profiles[0];
    assert_eq!(p.tier, 1);
    assert_eq!(p.earned_credit_microunits, 1_000_000);
    assert!(!p.dispute_hold);
    assert!(r.journal.iter().any(|x| x.outcome
        == RecoveryOutcome::Trust {
            outcome: TrustOutcome::Rejected {
                reason: TrustRejection::DisputeHold
            }
        }));
}
#[test]
fn customer_nonresponse_can_be_reviewed_without_forging_client_ack() {
    let r = case("CUSTOMER_NONRESPONSE_ACCEPTED");
    assert_eq!(r.cases[0].status, CaseStatus::FinalAccepted);
    assert!(!r.trust.direct.agreements[0].delivery_acknowledged);
    assert_eq!(r.trust.contracts[0].accepted_tick, None);
    assert_eq!(r.trust.profiles[0].earned_credit_microunits, 1_000_000);
    assert_eq!(r.trust.profiles[0].active_contracts, 0);
}
#[test]
fn resolution_does_not_skip_credit_maturity() {
    let r = case("CUSTOMER_NONRESPONSE_ACCEPTED");
    assert!(r.journal.iter().any(|x| x.outcome
        == RecoveryOutcome::Trust {
            outcome: TrustOutcome::Rejected {
                reason: TrustRejection::TooEarly
            }
        }));
}
#[test]
fn upheld_complaint_retains_exposure_without_forced_refund() {
    let r = case("COMPLAINT_UPHELD");
    assert_eq!(r.cases[0].status, CaseStatus::FinalRejected);
    assert!(r.trust.profiles[0].dispute_hold);
    assert_eq!(r.trust.profiles[0].active_contracts, 1);
    assert_eq!(r.trust.profiles[0].earned_credit_microunits, 0);
    assert_eq!(r.trust.direct.metrics.net_transferred, 100);
    assert_eq!(r.trust.direct.metrics.voluntary_refunds_recorded, 0);
}
#[test]
fn independent_appeal_can_overturn_rejection() {
    let r = case("APPEAL_OVERTURNS_REJECTION");
    assert_eq!(
        r.cases[0].primary.as_ref().unwrap().verdict,
        WorkVerdict::RejectWork
    );
    assert_eq!(r.cases[0].status, CaseStatus::FinalAccepted);
    assert_eq!(r.trust.profiles[0].earned_credit_microunits, 1_000_000);
}
#[test]
fn appeal_can_uphold_complaint() {
    let r = case("APPEAL_UPHOLDS_COMPLAINT");
    assert_eq!(r.cases[0].status, CaseStatus::FinalRejected);
    assert!(r.trust.profiles[0].dispute_hold);
}
#[test]
fn one_primary_timeout_assigns_a_distinct_operator() {
    let r = case("REVIEWER_TIMEOUT_ESCALATION");
    assert_eq!(r.cases[0].primary_assignments, vec![1, 3]);
    assert_eq!(r.cases[0].status, CaseStatus::FinalAccepted);
    assert_eq!(rejected(&r, RecoveryRejection::WrongReviewer), 1);
}
#[test]
fn all_primary_timeouts_remain_unresolved() {
    let r = case("REVIEWERS_ALL_TIMEOUT");
    assert_eq!(r.cases[0].status, CaseStatus::Expired);
    assert!(r.trust.profiles[0].dispute_hold);
    assert_eq!(r.trust.profiles[0].earned_credit_microunits, 0);
    assert_eq!(r.trust.direct.metrics.net_transferred, 100);
}
#[test]
fn appellate_timeout_does_not_adopt_provisional_verdict() {
    let r = case("APPEAL_TIMEOUT_UNRESOLVED");
    assert_eq!(
        r.cases[0].primary.as_ref().unwrap().verdict,
        WorkVerdict::AcceptWork
    );
    assert_eq!(r.cases[0].status, CaseStatus::Expired);
    assert!(r.trust.profiles[0].dispute_hold);
}
#[test]
fn full_observed_return_clears_hold_but_grants_no_work_credit() {
    let r = case("RETURN_RESOLVES_PENDING");
    assert_eq!(r.cases[0].status, CaseStatus::Returned);
    assert!(r.cases[0].returned_tick.is_some());
    assert!(!r.trust.profiles[0].dispute_hold);
    assert_eq!(r.trust.profiles[0].active_contracts, 0);
    assert_eq!(r.trust.profiles[0].earned_credit_microunits, 0);
    assert_eq!(r.trust.direct.metrics.voluntary_refunds_recorded, 100);
}
#[test]
fn changed_payment_evidence_makes_provisional_acceptance_stale() {
    let r = case("STALE_ACCEPTANCE");
    assert_eq!(r.cases[0].status, CaseStatus::Stale);
    assert_eq!(r.trust.direct.metrics.net_transferred, 99);
    assert!(r.trust.profiles[0].dispute_hold);
}
#[test]
fn declared_conflicts_and_primary_operator_aliases_cannot_review() {
    let r = case("CONFLICTED_REVIEWERS");
    assert_eq!(rejected(&r, RecoveryRejection::WrongReviewer), 2);
    assert_eq!(r.cases[0].primary_assignments, vec![1]);
    assert_eq!(r.cases[0].appellate_reviewer, Some(3));
}
#[test]
fn overdue_paid_work_cannot_gain_acceptance_without_delivery() {
    let r = case("UNFINISHED_PAID_WORK_HOLD");
    assert_eq!(rejected(&r, RecoveryRejection::WorkNotAcceptable), 1);
    assert_eq!(r.cases[0].status, CaseStatus::FinalRejected);
    assert!(r.trust.profiles[0].dispute_hold);
    assert_eq!(r.trust.profiles[0].active_contracts, 1);
}
#[test]
fn collective_hold_and_restoration_apply_to_all_work_shares() {
    let r = case("COLLECTIVE_CONTESTED");
    assert_eq!(r.trust.profiles[0].earned_credit_microunits, 606_000);
    assert_eq!(r.trust.profiles[3].earned_credit_microunits, 404_000);
    let open = r
        .journal
        .iter()
        .find(|x| matches!(x.action.command, RecoveryCommand::OpenCase { .. }))
        .unwrap();
    for a in [0, 3] {
        assert!(open.profiles_after[a].dispute_hold);
        assert_eq!(open.profiles_after[a].earned_credit_microunits, 0);
    }
    assert_eq!(r.trust.direct.agreements[0].terms.provider, 0);
}
#[test]
fn deadlines_are_exclusive_and_timer_runs_before_same_tick_command() {
    let r = case("DEADLINE_BOUNDARIES");
    assert!(rejected(&r, RecoveryRejection::TooEarly) > 0);
    assert!(rejected(&r, RecoveryRejection::WrongState) > 0);
    assert_eq!(r.cases[0].status, CaseStatus::FinalAccepted);
}
#[test]
fn stale_bindings_duplicate_cases_and_legacy_claim_bypass_are_rejected() {
    let r = case("FORGED_BINDINGS_AND_DUPLICATES");
    for reason in [
        RecoveryRejection::DuplicateCase,
        RecoveryRejection::WrongParty,
        RecoveryRejection::BindingMismatch,
        RecoveryRejection::WrongState,
        RecoveryRejection::UseCaseWorkflow,
    ] {
        assert!(rejected(&r, reason) > 0, "{reason:?}");
    }
}
#[test]
fn withdrawal_before_decision_is_explicit_and_cannot_erase_final_ruling() {
    let r = case("COMPLAINT_UPHELD");
    let mut i = input_until(&r, |c| matches!(c, RecoveryCommand::PrimaryVerdict { .. }));
    append(
        &mut i,
        8,
        RecoveryCommand::Withdraw {
            agent: 1,
            case_id: 0,
        },
    );
    let r = regenerated(i);
    assert_eq!(r.cases[0].status, CaseStatus::Withdrawn);
    assert_eq!(r.trust.profiles[0].earned_credit_microunits, 1_000_000);
}
#[test]
fn insufficient_independent_reviewers_prevents_case_admission() {
    let r = case("COMPLAINT_UPHELD");
    let mut i = r.input;
    i.config.reviewers[4].operator = 100;
    let r = regenerated(i);
    assert!(rejected(&r, RecoveryRejection::NoIndependentPanel) > 0);
    assert!(r.cases.is_empty());
}
#[test]
fn appeal_cannot_be_filed_twice() {
    let r = case("APPEAL_OVERTURNS_REJECTION");
    let mut i = r.input;
    let n = i
        .actions
        .iter()
        .position(|a| matches!(a.command, RecoveryCommand::Appeal { .. }))
        .unwrap();
    let a = i.actions[n].clone();
    i.actions.insert(n + 1, a);
    let r = regenerated(i);
    assert!(rejected(&r, RecoveryRejection::WrongState) > 0);
    assert_eq!(r.cases[0].status, CaseStatus::FinalAccepted);
}
#[test]
fn stale_accepted_work_after_finalization_loses_access_immediately() {
    use zoora_review_market::direct::{DirectCommand, Receipt};
    let r = case("CUSTOMER_NONRESPONSE_ACCEPTED");
    let mut i = r.input;
    append(
        &mut i,
        20,
        RecoveryCommand::Trust {
            actor: TrustActor::ReceiptFixture {},
            command: TrustCommand::Direct {
                command: DirectCommand::VoluntaryRefundReceipt {
                    receipt: Receipt::synthetic(0, 999, 0, 1, 1, 20),
                },
            },
        },
    );
    let r = regenerated(i);
    assert_eq!(r.cases[0].status, CaseStatus::FinalAccepted);
    assert!(r.trust.profiles[0].dispute_hold);
    assert_eq!(r.trust.profiles[0].earned_credit_microunits, 0);
}
#[test]
fn rehashed_forged_ruling_credit_profile_or_event_cannot_replay() {
    let r = case("APPEAL_OVERTURNS_REJECTION");
    let mut candidates = vec![];
    let mut x = r.clone();
    x.cases[0].appellate_reviewer = Some(2);
    candidates.push(x);
    let mut x = r.clone();
    x.events[0].visible_actions += 1;
    candidates.push(x);
    let mut x = r.clone();
    x.journal[0].profiles_after[0].tier = 2;
    candidates.push(x);
    let mut x = r.clone();
    x.trust.contracts[0].credit_shares[0].earned_microunits += 1;
    candidates.push(x);
    let mut x = r.clone();
    x.trust.direct.metrics.voluntary_refunds_recorded = 100;
    candidates.push(x);
    for mut x in candidates {
        x.fingerprint = x.hash().unwrap();
        assert!(x.verify().is_err());
    }
}
#[test]
fn config_time_order_capacity_and_unknown_fields_are_bounded() {
    let mut c = config();
    c.evidence_ticks = 0;
    assert!(c.validate().is_err());
    let mut c = config();
    c.reviewers[1].id = 0;
    assert!(c.validate().is_err());
    let r = case("COMPLAINT_UPHELD");
    let mut i = r.input.clone();
    i.actions.push(i.actions[0].clone());
    assert!(RecoveryReport::generate(i).is_err());
    let mut i = r.input.clone();
    i.actions = vec![i.actions[0].clone(); 4097];
    assert!(RecoveryReport::generate(i).is_err());
    let mut v = serde_json::to_value(r.input).unwrap();
    v["hidden_override"] = true.into();
    assert!(serde_json::from_value::<RecoveryInput>(v).is_err());
}
#[test]
fn current_binding_is_not_replaced_by_new_evidence_after_primary_close() {
    let r = case("COMPLAINT_UPHELD");
    let mut i = r.input;
    append(
        &mut i,
        9,
        RecoveryCommand::SubmitEvidence {
            agent: 0,
            case_id: 0,
            evidence_digest: "a".repeat(64),
        },
    );
    let r = regenerated(i);
    assert!(rejected(&r, RecoveryRejection::WrongState) > 0);
    assert_eq!(r.cases[0].status, CaseStatus::FinalRejected);
}
#[test]
fn open_case_and_report_fingerprint_preserve_each_failed_attempt() {
    let r = case("FORGED_BINDINGS_AND_DUPLICATES");
    assert_eq!(r.journal.len(), r.input.actions.len());
    assert!(r
        .journal
        .iter()
        .any(|x| matches!(x.outcome, RecoveryOutcome::Rejected { .. })));
    let mut x = r.clone();
    x.journal.pop();
    x.fingerprint = x.hash().unwrap();
    assert!(x.verify().is_err());
}
#[test]
fn valid_binding_does_not_authorize_an_unassigned_reviewer() {
    let r = case("COMPLAINT_UPHELD");
    let mut i = input_until(&r, |c| matches!(c, RecoveryCommand::PrimaryVerdict { .. }));
    let mut c = accept_command(&r);
    if let RecoveryCommand::PrimaryVerdict { reviewer, .. } = &mut c {
        *reviewer = u64::MAX;
    }
    append(&mut i, 8, c);
    let r = regenerated(i);
    assert_eq!(rejected(&r, RecoveryRejection::WrongReviewer), 1);
    assert_eq!(r.cases[0].status, CaseStatus::Expired);
}

#[test]
fn valid_timing_that_cannot_admit_the_fixed_demo_returns_an_error() {
    let mut c = config();
    c.trust.maturity_ticks = c.complaint_ticks;
    c.validate().unwrap();
    assert!(RecoveryCampaign::generate(c).is_err());
}
#[test]
fn valid_panel_that_cannot_admit_the_fixed_demo_returns_an_error() {
    let mut c = config();
    c.reviewers[4].operator = 100;
    c.validate().unwrap();
    assert!(RecoveryCampaign::generate(c).is_err());
}
