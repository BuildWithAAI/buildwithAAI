//! Untrusted JSON is decoded into private DTOs, then passed through schema constructors.
use crate::{validation::*, *};
use serde::de::{self, SeqAccess, Visitor};
use std::{fmt, marker::PhantomData};

fn bounded<'de, D, T, const N: usize>(d: D) -> Result<Vec<T>, D::Error>
where
    D: de::Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct Limit<T, const N: usize>(PhantomData<T>);
    impl<'de, T: Deserialize<'de>, const N: usize> Visitor<'de> for Limit<T, N> {
        type Value = Vec<T>;
        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            write!(f, "at most {N} entries")
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Vec<T>, A::Error> {
            let mut result = Vec::new();
            while let Some(value) = seq.next_element()? {
                if result.len() == N {
                    return Err(de::Error::custom("list bound exceeded"));
                }
                result.push(value);
            }
            Ok(result)
        }
    }
    d.deserialize_seq(Limit::<T, N>(PhantomData))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Pin {
    id: String,
    revision: u32,
    sha256: String,
}
impl Pin {
    fn checked(self) -> Result<VersionPin, Refusal> {
        VersionPin::new(identifier(&self.id)?, self.revision, digest(&self.sha256)?)
            .map_err(|_| Refusal::InvalidParameters)
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TimeRange {
    start_ms: u64,
    end_ms: u64,
}
impl TimeRange {
    fn checked(self) -> Result<Interval, Refusal> {
        Interval::new(time(self.start_ms)?, time(self.end_ms)?)
            .map_err(|_| Refusal::InvalidParameters)
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Timing {
    observed_ms: u64,
    available_ms: u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireParty {
    id: String,
    operator: String,
}
impl WireParty {
    fn checked(self) -> Result<Party, Refusal> {
        Ok(Party::new(
            identifier(&self.id)?,
            identifier(&self.operator)?,
        ))
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Claim {
    id: String,
    party: String,
    delegate: String,
    space: String,
    #[serde(deserialize_with = "bounded::<_, AuthorityScope, 5>")]
    scopes: Vec<AuthorityScope>,
    validity: TimeRange,
    evidence: Pin,
}
impl Claim {
    fn checked(self) -> Result<AuthorityClaim, Refusal> {
        AuthorityClaim::new(
            identifier(&self.id)?,
            identifier(&self.party)?,
            identifier(&self.delegate)?,
            identifier(&self.space)?,
            self.scopes,
            self.validity.checked()?,
            self.evidence.checked()?,
        )
        .map_err(|_| Refusal::InvalidParameters)
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireSpace {
    id: String,
    provider: String,
    mode: UseMode,
    capacity: u16,
    #[serde(deserialize_with = "bounded::<_, BusinessFunction, 5>")]
    functions: Vec<BusinessFunction>,
    subletting_permitted: bool,
}
impl WireSpace {
    fn checked(self) -> Result<Space, Refusal> {
        if self.subletting_permitted {
            return Err(Refusal::UnsupportedRights);
        }
        Space::new(
            identifier(&self.id)?,
            identifier(&self.provider)?,
            self.mode,
            self.capacity,
            self.functions,
        )
        .map_err(|_| Refusal::InvalidParameters)
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WirePolicy {
    pin: Pin,
    max_duration_ms: u64,
    notice_ms: u64,
    grace_ms: u64,
}
impl WirePolicy {
    fn checked(self) -> Result<Policy, Refusal> {
        Policy::new(
            self.pin.checked()?,
            self.max_duration_ms,
            self.notice_ms,
            self.grace_ms,
        )
        .map_err(|_| Refusal::InvalidParameters)
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireQuote {
    provider_rent: u64,
    platform_fee: u64,
    source: String,
    validity: TimeRange,
    timing: Timing,
    provider_recipient: String,
    platform_recipient: String,
}
impl WireQuote {
    fn checked(self) -> Result<Quote, Refusal> {
        Quote::new(
            SyntheticUnits::new(self.provider_rent),
            SyntheticUnits::new(self.platform_fee),
            identifier(&self.source)?,
            self.validity.checked()?,
            FactTime::new(
                time(self.timing.observed_ms)?,
                time(self.timing.available_ms)?,
            )
            .map_err(|_| Refusal::InvalidParameters)?,
            identifier(&self.provider_recipient)?,
            identifier(&self.platform_recipient)?,
        )
        .map_err(|_| Refusal::InvalidParameters)
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireDraft {
    id: String,
    instance: String,
    space: WireSpace,
    provider: WireParty,
    licensee: WireParty,
    platform: WireParty,
    provider_authority: Claim,
    licensee_authority: Claim,
    policy: WirePolicy,
    template: Pin,
    declared_terms_sha256: String,
    interval: TimeRange,
    quote: WireQuote,
    renewal_of: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    schema_version: u32,
    classification: String,
    units: String,
    registry_sha256: String,
    #[serde(deserialize_with = "bounded::<_, String, 8>")]
    clauses: Vec<String>,
    draft: WireDraft,
}

pub(crate) struct Request {
    pub registry: Digest,
    pub clauses: BTreeSet<Identifier>,
    pub draft: DraftLease,
}

pub(crate) fn parse(bytes: &[u8]) -> Result<Request, Refusal> {
    if bytes.len() > MAX_INPUT_BYTES {
        return Err(Refusal::InputTooLarge);
    }
    let w: Envelope = serde_json::from_slice(bytes).map_err(|_| Refusal::MalformedInput)?;
    if w.schema_version != VALIDATION_VERSION
        || w.classification != VALIDATION_CLASSIFICATION
        || w.units != UNITS
    {
        return Err(Refusal::UnsupportedIdentity);
    }
    let mut clauses = BTreeSet::new();
    for clause in w.clauses {
        if !clauses.insert(identifier(&clause)?) {
            return Err(Refusal::ClauseSetMismatch);
        }
    }
    let d = w.draft;
    let draft = DraftLease::new(DraftInput {
        id: identifier(&d.id)?,
        instance: identifier(&d.instance)?,
        space: d.space.checked()?,
        provider: d.provider.checked()?,
        licensee: d.licensee.checked()?,
        platform: d.platform.checked()?,
        provider_authority: d.provider_authority.checked()?,
        licensee_authority: d.licensee_authority.checked()?,
        policy: d.policy.checked()?,
        template: d.template.checked()?,
        declared_terms_digest: digest(&d.declared_terms_sha256)?,
        interval: d.interval.checked()?,
        quote: d.quote.checked()?,
        renewal_of: d.renewal_of.map(|v| identifier(&v)).transpose()?,
    })
    .map_err(|_| Refusal::InvalidParameters)?;
    Ok(Request {
        registry: digest(&w.registry_sha256)?,
        clauses,
        draft,
    })
}

fn identifier(s: &str) -> Result<Identifier, Refusal> {
    Identifier::new(s).map_err(|_| Refusal::InvalidParameters)
}
fn time(t: u64) -> Result<UtcMillis, Refusal> {
    UtcMillis::new(t).map_err(|_| Refusal::InvalidParameters)
}
fn digest(s: &str) -> Result<Digest, Refusal> {
    if s.len() != 64
        || !s
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(Refusal::InvalidParameters);
    }
    let mut bytes = [0; 32];
    for (i, chunk) in s.as_bytes().as_chunks::<2>().0.iter().enumerate() {
        let nibble = |b: u8| if b <= b'9' { b - b'0' } else { b - b'a' + 10 };
        bytes[i] = nibble(chunk[0]) * 16 + nibble(chunk[1]);
    }
    Digest::new(bytes).map_err(|_| Refusal::InvalidParameters)
}
