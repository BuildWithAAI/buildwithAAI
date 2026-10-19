//! VL-002 validates drafts against one compiled, explicitly synthetic registry snapshot.
//! This is neither an authority oracle nor an acceptance, payment or access capability.
use crate::{canonical as c, wire, *};
use serde_json::json;

pub const VALIDATION_VERSION: u32 = 1;
pub const VALIDATION_CLASSIFICATION: &str = "SYNTHETIC_VL002_NO_MONETARY_VALUE";
pub const UNITS: &str = "synthetic_units";
pub const MAX_INPUT_BYTES: usize = 16_384;

// Identified clauses have immutable fixture content. There is no generated legal text input.
pub(crate) const CLAUSES: [(&str, &str); 8] = [
    (
        "support_downtime",
        "SYNTHETIC: record support and downtime; no uptime guarantee.",
    ),
    (
        "prohibited_uses",
        "SYNTHETIC: only the named fixture business functions; no subletting.",
    ),
    (
        "content_ownership",
        "SYNTHETIC: no transfer of content ownership or third-party rights.",
    ),
    (
        "export_retention",
        "SYNTHETIC: export and retained audit are separate from access state.",
    ),
    (
        "termination_remedies",
        "SYNTHETIC: ending access does not erase history or move funds.",
    ),
    (
        "refund_review",
        "SYNTHETIC: refunds require a separate reviewed record; none is executed.",
    ),
    (
        "dispute_process",
        "SYNTHETIC: record disputed facts separately; no wallet freeze.",
    ),
    (
        "no_promises",
        "SYNTHETIC: no price, profit, holder distribution or native-coin promise.",
    ),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Refusal {
    InputTooLarge,
    MalformedInput,
    UnsupportedIdentity,
    InvalidParameters,
    UnsupportedRights,
    RegistryMismatch,
    RegistryNotCurrent,
    TemplateMismatch,
    ClauseSetMismatch,
    PolicyMismatch,
    PartyOrSpaceMismatch,
    AuthorityMismatch,
    AuthorityNotApproved,
    AuthorityNotCurrent,
    AuthorityUnavailableOrStale,
    QuoteMismatch,
    QuoteNotCurrent,
    QuoteUnavailableOrStale,
    NoticeNotMet,
    RenewalRequiresLifecycle,
    TermsDigestMismatch,
    InvalidFixture,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Status {
    ValidDraft,
    Refused,
}

/// Bounded, redacted decision record. Caller must retain it; no durable journal exists yet.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Decision {
    classification: &'static str,
    at_ms: u64,
    registry_sha256: String,
    input_sha256: Option<String>,
    status: Status,
    reason: Option<Refusal>,
    terms_sha256: Option<String>,
}
impl Decision {
    pub fn status(&self) -> Status {
        self.status
    }
    pub fn reason(&self) -> Option<Refusal> {
        self.reason
    }
    pub fn terms_sha256(&self) -> Option<&str> {
        self.terms_sha256.as_deref()
    }
    pub fn registry_sha256(&self) -> &str {
        &self.registry_sha256
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
/// Synthetic controller vocabulary; no request field can set a registry's approval.
pub enum Approval {
    SimulatedApproved,
    Unknown,
    Revoked,
}

/// Only the compiled laboratory snapshot can construct this registry in VL-002.
/// Changing the fixture is a source change, not a model-supplied approval.
#[derive(Clone, Debug)]
pub struct Registry {
    expected: DraftLease,
    clauses: BTreeSet<Identifier>,
    quote_age_ms: u64,
    authority_age_ms: u64,
    authority_timing: [FactTime; 2],
    authority_approval: [Approval; 2],
    validity: Interval,
    digest: Digest,
}

impl Registry {
    pub fn synthetic_fixture_v1() -> Result<Self, Refusal> {
        let request = wire::parse(include_bytes!("../fixtures/valid_request.json"))?;
        let timing = FactTime::new(
            UtcMillis::new(100).map_err(|_| Refusal::InvalidFixture)?,
            UtcMillis::new(200).map_err(|_| Refusal::InvalidFixture)?,
        )
        .map_err(|_| Refusal::InvalidFixture)?;
        let validity = Interval::new(
            UtcMillis::new(0).map_err(|_| Refusal::InvalidFixture)?,
            UtcMillis::new(5_000).map_err(|_| Refusal::InvalidFixture)?,
        )
        .map_err(|_| Refusal::InvalidFixture)?;
        let mut registry = Self {
            expected: request.draft.clone(),
            clauses: request.clauses.clone(),
            quote_age_ms: 500,
            authority_age_ms: 2_000,
            authority_timing: [timing; 2],
            authority_approval: [Approval::SimulatedApproved; 2],
            validity,
            digest: request.registry,
        };
        let d = registry.expected.fields();
        let template = c::hash(
            b"ZOORA_VL002_TEMPLATE_JSON_TUPLE_V1\0",
            &c::template_manifest(),
        )?;
        let policy = c::hash(
            b"ZOORA_VL002_POLICY_JSON_TUPLE_V1\0",
            &c::policy_manifest(&d.policy, registry.quote_age_ms, registry.authority_age_ms),
        )?;
        let expected_clauses: BTreeSet<_> = CLAUSES
            .iter()
            .map(|(id, _)| Identifier::new(id))
            .collect::<Result<_, _>>()
            .map_err(|_| Refusal::InvalidFixture)?;
        if d.template.id().as_str() != "lab_template"
            || d.template.revision() != 1
            || d.template.digest() != template
            || d.policy.pin().digest() != policy
            || registry.clauses != expected_clauses
            || d.provider.id() == d.platform.id()
            || d.licensee.id() == d.platform.id()
            || d.provider_authority.id() == d.licensee_authority.id()
        {
            return Err(Refusal::InvalidFixture);
        }
        registry.digest = registry.compute_digest()?;
        if request.registry != registry.digest
            || c::terms(&request, registry.digest)? != d.declared_terms_digest
        {
            return Err(Refusal::InvalidFixture);
        }
        Ok(registry)
    }

    fn compute_digest(&self) -> Result<Digest, Refusal> {
        let d = self.expected.fields();
        let approvals: Vec<_> = self
            .authority_timing
            .iter()
            .zip(self.authority_approval)
            .map(|(t, a)| json!([t.observed().value(), t.available().value(), a]))
            .collect();
        c::hash(
            b"ZOORA_VL002_REGISTRY_JSON_TUPLE_V1\0",
            &json!([
                VALIDATION_VERSION,
                VALIDATION_CLASSIFICATION,
                UNITS,
                c::template_manifest(),
                c::policy_manifest(&d.policy, self.quote_age_ms, self.authority_age_ms),
                d.instance.as_str(),
                c::space(&d.space),
                [
                    c::party(&d.provider),
                    c::party(&d.licensee),
                    c::party(&d.platform)
                ],
                [
                    c::claim(&d.provider_authority),
                    c::claim(&d.licensee_authority)
                ],
                approvals,
                c::quote(&d.quote),
                c::interval(self.validity)
            ]),
        )
    }

    /// Hashing alone checks syntax/shape, not policy eligibility, identity or authority.
    pub fn terms_digest(&self, bytes: &[u8]) -> Result<String, Refusal> {
        let request = wire::parse(bytes)?;
        Ok(c::hex(c::terms(&request, self.digest)?))
    }

    pub fn fixture_json(&self) -> &'static [u8] {
        include_bytes!("../fixtures/valid_request.json")
    }

    /// Explicit decision time; never reads the wall clock, signs, stores, or contacts a service.
    pub fn evaluate(&self, bytes: &[u8], at: UtcMillis) -> Decision {
        let input_sha256 = (bytes.len() <= MAX_INPUT_BYTES).then(|| c::raw_hash(bytes));
        let result = self.check(bytes, at);
        Decision {
            classification: VALIDATION_CLASSIFICATION,
            at_ms: at.value(),
            registry_sha256: c::hex(self.digest),
            input_sha256,
            status: if result.is_ok() {
                Status::ValidDraft
            } else {
                Status::Refused
            },
            reason: result.as_ref().err().copied(),
            terms_sha256: result.ok().map(c::hex),
        }
    }

    fn check(&self, bytes: &[u8], at: UtcMillis) -> Result<Digest, Refusal> {
        let r = wire::parse(bytes)?;
        let d = r.draft.fields();
        let e = self.expected.fields();
        if r.registry != self.digest {
            return Err(Refusal::RegistryMismatch);
        }
        if !self.validity.contains(at) {
            return Err(Refusal::RegistryNotCurrent);
        }
        if d.template != e.template {
            return Err(Refusal::TemplateMismatch);
        }
        if r.clauses != self.clauses {
            return Err(Refusal::ClauseSetMismatch);
        }
        if d.policy != e.policy {
            return Err(Refusal::PolicyMismatch);
        }
        if d.instance != e.instance
            || d.space != e.space
            || d.provider != e.provider
            || d.licensee != e.licensee
            || d.platform != e.platform
        {
            return Err(Refusal::PartyOrSpaceMismatch);
        }
        if d.provider_authority != e.provider_authority
            || d.licensee_authority != e.licensee_authority
        {
            return Err(Refusal::AuthorityMismatch);
        }
        for ((claim, timing), approval) in [&d.provider_authority, &d.licensee_authority]
            .into_iter()
            .zip(self.authority_timing)
            .zip(self.authority_approval)
        {
            if approval != Approval::SimulatedApproved {
                return Err(Refusal::AuthorityNotApproved);
            }
            if !claim.validity().contains(at)
                || claim.validity().start() > d.interval.start()
                || claim.validity().end() < d.interval.end()
            {
                return Err(Refusal::AuthorityNotCurrent);
            }
            if !fresh(timing, at, self.authority_age_ms) {
                return Err(Refusal::AuthorityUnavailableOrStale);
            }
        }
        if d.quote != e.quote {
            return Err(Refusal::QuoteMismatch);
        }
        if !d.quote.validity().contains(at) {
            return Err(Refusal::QuoteNotCurrent);
        }
        if !fresh(d.quote.timing(), at, self.quote_age_ms) {
            return Err(Refusal::QuoteUnavailableOrStale);
        }
        if at
            .value()
            .checked_add(d.policy.notice_ms())
            .is_none_or(|start| start > d.interval.start().value())
        {
            return Err(Refusal::NoticeNotMet);
        }
        if d.renewal_of.is_some() {
            return Err(Refusal::RenewalRequiresLifecycle);
        }
        let digest = c::terms(&r, self.digest)?;
        if digest != d.declared_terms_digest {
            return Err(Refusal::TermsDigestMismatch);
        }
        Ok(digest)
    }
}

fn fresh(t: FactTime, at: UtcMillis, max_age: u64) -> bool {
    t.available() <= at
        && at
            .value()
            .checked_sub(t.observed().value())
            .is_some_and(|age| age <= max_age)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_and_revoked_controller_authority_cannot_validate() {
        for status in [Approval::Unknown, Approval::Revoked] {
            for index in 0..2 {
                let mut r = Registry::synthetic_fixture_v1().unwrap();
                r.authority_approval[index] = status;
                assert_eq!(
                    r.evaluate(r.fixture_json(), UtcMillis::new(1000).unwrap())
                        .reason(),
                    Some(Refusal::AuthorityNotApproved)
                );
            }
        }
    }
    #[test]
    fn authority_source_must_be_available_and_observed_age_is_independent() {
        for timing in [(100, 1001), (0, 100)] {
            let mut r = Registry::synthetic_fixture_v1().unwrap();
            r.authority_age_ms = 900;
            r.authority_timing[0] = FactTime::new(
                UtcMillis::new(timing.0).unwrap(),
                UtcMillis::new(timing.1).unwrap(),
            )
            .unwrap();
            assert_eq!(
                r.evaluate(r.fixture_json(), UtcMillis::new(1000).unwrap())
                    .reason(),
                Some(Refusal::AuthorityUnavailableOrStale)
            );
        }
    }
    #[test]
    fn registry_digest_binds_controller_approval_and_freshness() {
        let r = Registry::synthetic_fixture_v1().unwrap();
        let mut altered = r.clone();
        altered.authority_approval[0] = Approval::Revoked;
        assert_ne!(
            r.compute_digest().unwrap(),
            altered.compute_digest().unwrap()
        );
        let mut altered = r.clone();
        altered.authority_age_ms += 1;
        assert_ne!(
            r.compute_digest().unwrap(),
            altered.compute_digest().unwrap()
        );
    }
}
