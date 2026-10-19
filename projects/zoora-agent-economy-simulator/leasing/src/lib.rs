//! VL-001 inert, synthetic-only data definitions. No acceptance or execution engine.
#![forbid(unsafe_code)]

use std::collections::BTreeSet;

pub const SCHEMA_VERSION: u32 = 1;
pub const CLASSIFICATION: &str = "SYNTHETIC_VL001_NO_MONETARY_VALUE";
pub const MAX_ID_BYTES: usize = 64;
pub const MAX_UTC_MS: u64 = 253_402_300_799_999;
pub const MAX_DURATION_MS: u64 = 365 * 24 * 60 * 60 * 1_000;
pub const MAX_CAPACITY: u16 = 1_024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SchemaError {
    InvalidIdentifier,
    EmptyDigest,
    InvalidRevision,
    TimestampOutOfRange,
    InvalidInterval,
    InvalidObservationTime,
    AmountOverflow,
    InvalidPolicyBounds,
    InvalidCapacity,
    EmptySelection,
    DuplicateSelection,
    TooManySelections,
    PartyMismatch,
    QuotePartyMismatch,
    AuthorityScopeMismatch,
    DurationExceeded,
    SelfRenewal,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Identifier(String);

impl Identifier {
    pub fn new(value: &str) -> Result<Self, SchemaError> {
        let bytes = value.as_bytes();
        if !(3..=MAX_ID_BYTES).contains(&bytes.len())
            || !bytes[0].is_ascii_lowercase()
            || !bytes
                .iter()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'_')
        {
            return Err(SchemaError::InvalidIdentifier);
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Opaque caller-declared digest. Nonzero is a shape check, not content verification.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Digest([u8; 32]);

impl Digest {
    pub fn new(bytes: [u8; 32]) -> Result<Self, SchemaError> {
        if bytes == [0; 32] {
            return Err(SchemaError::EmptyDigest);
        }
        Ok(Self(bytes))
    }

    pub fn bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VersionPin {
    id: Identifier,
    revision: u32,
    digest: Digest,
}

impl VersionPin {
    pub fn new(id: Identifier, revision: u32, digest: Digest) -> Result<Self, SchemaError> {
        if revision == 0 {
            return Err(SchemaError::InvalidRevision);
        }
        Ok(Self {
            id,
            revision,
            digest,
        })
    }

    pub fn id(&self) -> &Identifier {
        &self.id
    }
    pub fn revision(&self) -> u32 {
        self.revision
    }
    pub fn digest(&self) -> Digest {
        self.digest
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct UtcMillis(u64);

impl UtcMillis {
    pub fn new(value: u64) -> Result<Self, SchemaError> {
        if value > MAX_UTC_MS {
            return Err(SchemaError::TimestampOutOfRange);
        }
        Ok(Self(value))
    }
    pub fn value(self) -> u64 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Interval {
    start: UtcMillis,
    end: UtcMillis,
}

impl Interval {
    pub fn new(start: UtcMillis, end: UtcMillis) -> Result<Self, SchemaError> {
        if start >= end {
            return Err(SchemaError::InvalidInterval);
        }
        Ok(Self { start, end })
    }
    pub fn start(self) -> UtcMillis {
        self.start
    }
    pub fn end(self) -> UtcMillis {
        self.end
    }
    pub fn duration_ms(self) -> u64 {
        self.end.0 - self.start.0
    }
    pub fn contains(self, at: UtcMillis) -> bool {
        self.start <= at && at < self.end
    }
    pub fn overlaps(self, other: Self) -> bool {
        self.start < other.end && other.start < self.end
    }
}

/// Exact integer laboratory units. There is no USD, AAI, SOL or conversion operation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SyntheticUnits(u64);

impl SyntheticUnits {
    pub fn new(value: u64) -> Self {
        Self(value)
    }
    pub fn value(self) -> u64 {
        self.0
    }
    pub fn checked_add(self, other: Self) -> Result<Self, SchemaError> {
        self.0
            .checked_add(other.0)
            .map(Self)
            .ok_or(SchemaError::AmountOverflow)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FactTime {
    observed: UtcMillis,
    available: UtcMillis,
}

impl FactTime {
    pub fn new(observed: UtcMillis, available: UtcMillis) -> Result<Self, SchemaError> {
        if observed > available {
            return Err(SchemaError::InvalidObservationTime);
        }
        Ok(Self {
            observed,
            available,
        })
    }
    pub fn observed(self) -> UtcMillis {
        self.observed
    }
    pub fn available(self) -> UtcMillis {
        self.available
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Quote {
    provider_rent: SyntheticUnits,
    platform_fee: SyntheticUnits,
    source: Identifier,
    validity: Interval,
    timing: FactTime,
    provider_recipient: Identifier,
    platform_recipient: Identifier,
}

impl Quote {
    pub fn new(
        provider_rent: SyntheticUnits,
        platform_fee: SyntheticUnits,
        source: Identifier,
        validity: Interval,
        timing: FactTime,
        provider_recipient: Identifier,
        platform_recipient: Identifier,
    ) -> Result<Self, SchemaError> {
        provider_rent.checked_add(platform_fee)?;
        Ok(Self {
            provider_rent,
            platform_fee,
            source,
            validity,
            timing,
            provider_recipient,
            platform_recipient,
        })
    }
    pub fn provider_rent(&self) -> SyntheticUnits {
        self.provider_rent
    }
    pub fn platform_fee(&self) -> SyntheticUnits {
        self.platform_fee
    }
    pub fn total(&self) -> Result<SyntheticUnits, SchemaError> {
        self.provider_rent.checked_add(self.platform_fee)
    }
    pub fn source(&self) -> &Identifier {
        &self.source
    }
    pub fn validity(&self) -> Interval {
        self.validity
    }
    pub fn timing(&self) -> FactTime {
        self.timing
    }
    pub fn provider_recipient(&self) -> &Identifier {
        &self.provider_recipient
    }
    pub fn platform_recipient(&self) -> &Identifier {
        &self.platform_recipient
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Party {
    id: Identifier,
    operator: Identifier,
}

impl Party {
    pub fn new(id: Identifier, operator: Identifier) -> Self {
        Self { id, operator }
    }
    pub fn id(&self) -> &Identifier {
        &self.id
    }
    pub fn operator(&self) -> &Identifier {
        &self.operator
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum AuthorityScope {
    OfferSpace,
    AcceptLease,
    RequestRenewal,
    EndLease,
    ManageDispute,
}

/// A simulated claim with evidence reference, not verified legal/business authority.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthorityClaim {
    id: Identifier,
    party: Identifier,
    delegate: Identifier,
    space: Identifier,
    scopes: BTreeSet<AuthorityScope>,
    validity: Interval,
    evidence: VersionPin,
}

impl AuthorityClaim {
    pub fn new(
        id: Identifier,
        party: Identifier,
        delegate: Identifier,
        space: Identifier,
        scopes: Vec<AuthorityScope>,
        validity: Interval,
        evidence: VersionPin,
    ) -> Result<Self, SchemaError> {
        if scopes.is_empty() {
            return Err(SchemaError::EmptySelection);
        }
        if scopes.len() > 5 {
            return Err(SchemaError::TooManySelections);
        }
        let count = scopes.len();
        let scopes: BTreeSet<_> = scopes.into_iter().collect();
        if scopes.len() != count {
            return Err(SchemaError::DuplicateSelection);
        }
        Ok(Self {
            id,
            party,
            delegate,
            space,
            scopes,
            validity,
            evidence,
        })
    }
    pub fn id(&self) -> &Identifier {
        &self.id
    }
    pub fn party(&self) -> &Identifier {
        &self.party
    }
    pub fn delegate(&self) -> &Identifier {
        &self.delegate
    }
    pub fn space(&self) -> &Identifier {
        &self.space
    }
    pub fn scopes(&self) -> &BTreeSet<AuthorityScope> {
        &self.scopes
    }
    pub fn validity(&self) -> Interval {
        self.validity
    }
    pub fn evidence(&self) -> &VersionPin {
        &self.evidence
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UseMode {
    Exclusive,
    Shared,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum BusinessFunction {
    ServiceListing,
    InquiryLink,
    ProjectCollaboration,
    ContentDisplay,
    AgentWorkspace,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Space {
    id: Identifier,
    provider: Identifier,
    mode: UseMode,
    capacity: u16,
    functions: BTreeSet<BusinessFunction>,
}

impl Space {
    pub fn new(
        id: Identifier,
        provider: Identifier,
        mode: UseMode,
        capacity: u16,
        functions: Vec<BusinessFunction>,
    ) -> Result<Self, SchemaError> {
        if capacity == 0 || capacity > MAX_CAPACITY {
            return Err(SchemaError::InvalidCapacity);
        }
        if functions.is_empty() {
            return Err(SchemaError::EmptySelection);
        }
        if functions.len() > 5 {
            return Err(SchemaError::TooManySelections);
        }
        let count = functions.len();
        let functions: BTreeSet<_> = functions.into_iter().collect();
        if functions.len() != count {
            return Err(SchemaError::DuplicateSelection);
        }
        Ok(Self {
            id,
            provider,
            mode,
            capacity,
            functions,
        })
    }
    pub fn id(&self) -> &Identifier {
        &self.id
    }
    pub fn provider(&self) -> &Identifier {
        &self.provider
    }
    pub fn mode(&self) -> UseMode {
        self.mode
    }
    pub fn capacity(&self) -> u16 {
        self.capacity
    }
    pub fn functions(&self) -> &BTreeSet<BusinessFunction> {
        &self.functions
    }
    pub fn subletting_permitted(&self) -> bool {
        false
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Policy {
    pin: VersionPin,
    max_duration_ms: u64,
    notice_ms: u64,
    grace_ms: u64,
}

impl Policy {
    pub fn new(
        pin: VersionPin,
        max_duration_ms: u64,
        notice_ms: u64,
        grace_ms: u64,
    ) -> Result<Self, SchemaError> {
        if max_duration_ms == 0
            || max_duration_ms > MAX_DURATION_MS
            || notice_ms > max_duration_ms
            || grace_ms > max_duration_ms
        {
            return Err(SchemaError::InvalidPolicyBounds);
        }
        Ok(Self {
            pin,
            max_duration_ms,
            notice_ms,
            grace_ms,
        })
    }
    pub fn pin(&self) -> &VersionPin {
        &self.pin
    }
    pub fn max_duration_ms(&self) -> u64 {
        self.max_duration_ms
    }
    pub fn notice_ms(&self) -> u64 {
        self.notice_ms
    }
    pub fn grace_ms(&self) -> u64 {
        self.grace_ms
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LeaseStage {
    Draft,
    ReviewRequired,
    AwaitingAcceptance,
    Accepted,
    Ended,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AccessState {
    NotGranted,
    Granted,
    Suspended,
    Ended,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaymentFact {
    Unobserved,
    Partial,
    ReportedComplete,
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DisputeState {
    None,
    Open,
    Resolved,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DraftInput {
    pub id: Identifier,
    pub instance: Identifier,
    pub space: Space,
    pub provider: Party,
    pub licensee: Party,
    pub platform: Party,
    pub provider_authority: AuthorityClaim,
    pub licensee_authority: AuthorityClaim,
    pub policy: Policy,
    pub template: VersionPin,
    pub declared_terms_digest: Digest,
    pub interval: Interval,
    pub quote: Quote,
    pub renewal_of: Option<Identifier>,
}

/// Structurally bounded draft only. Construction cannot accept a lease or grant access.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DraftLease(DraftInput);

impl DraftLease {
    pub fn new(input: DraftInput) -> Result<Self, SchemaError> {
        if input.provider.id != input.space.provider || input.provider.id == input.licensee.id {
            return Err(SchemaError::PartyMismatch);
        }
        if input.quote.provider_recipient != input.provider.id
            || input.quote.platform_recipient != input.platform.id
        {
            return Err(SchemaError::QuotePartyMismatch);
        }
        for (claim, party, scope) in [
            (
                &input.provider_authority,
                &input.provider,
                AuthorityScope::OfferSpace,
            ),
            (
                &input.licensee_authority,
                &input.licensee,
                AuthorityScope::AcceptLease,
            ),
        ] {
            if claim.party != party.id
                || claim.space != input.space.id
                || !claim.scopes.contains(&scope)
            {
                return Err(SchemaError::AuthorityScopeMismatch);
            }
        }
        if input.interval.duration_ms() > input.policy.max_duration_ms {
            return Err(SchemaError::DurationExceeded);
        }
        if input.renewal_of.as_ref() == Some(&input.id) {
            return Err(SchemaError::SelfRenewal);
        }
        Ok(Self(input))
    }
    pub fn fields(&self) -> &DraftInput {
        &self.0
    }
    pub fn stage(&self) -> LeaseStage {
        LeaseStage::Draft
    }
    pub fn access(&self) -> AccessState {
        AccessState::NotGranted
    }
    pub fn payment(&self) -> PaymentFact {
        PaymentFact::Unobserved
    }
    pub fn dispute(&self) -> DisputeState {
        DisputeState::None
    }
    pub fn related_operators(&self) -> bool {
        self.0.provider.operator == self.0.licensee.operator
            || self.0.provider.operator == self.0.platform.operator
            || self.0.licensee.operator == self.0.platform.operator
    }
}
