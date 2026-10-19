//! Schema-owned compact JSON arrays; never a hash of unordered input objects.
use crate::{validation::*, wire::Request, *};
use serde_json::{json, Value};
use sha2::{Digest as _, Sha256};

pub(crate) fn hash(domain: &[u8], value: &Value) -> Result<Digest, Refusal> {
    let encoded = serde_json::to_vec(value).map_err(|_| Refusal::InvalidFixture)?;
    let mut hash = Sha256::new();
    hash.update(domain);
    hash.update(encoded);
    Digest::new(hash.finalize().into()).map_err(|_| Refusal::InvalidFixture)
}
pub(crate) fn hex(d: Digest) -> String {
    d.bytes().iter().map(|b| format!("{b:02x}")).collect()
}
pub(crate) fn raw_hash(bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(b"ZOORA_VL002_INPUT_BYTES_V1\0");
    hash.update(bytes);
    hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
}
pub(crate) fn pin(p: &VersionPin) -> Value {
    json!([p.id().as_str(), p.revision(), hex(p.digest())])
}
pub(crate) fn interval(i: Interval) -> Value {
    json!([i.start().value(), i.end().value()])
}
pub(crate) fn party(p: &Party) -> Value {
    json!([p.id().as_str(), p.operator().as_str()])
}
pub(crate) fn space(s: &Space) -> Value {
    json!([
        s.id().as_str(),
        s.provider().as_str(),
        s.mode(),
        s.capacity(),
        s.functions(),
        s.subletting_permitted()
    ])
}
pub(crate) fn claim(c: &AuthorityClaim) -> Value {
    json!([
        c.id().as_str(),
        c.party().as_str(),
        c.delegate().as_str(),
        c.space().as_str(),
        c.scopes(),
        interval(c.validity()),
        pin(c.evidence())
    ])
}
pub(crate) fn quote(q: &Quote) -> Value {
    json!([
        q.provider_rent().value(),
        q.platform_fee().value(),
        q.source().as_str(),
        interval(q.validity()),
        [
            q.timing().observed().value(),
            q.timing().available().value()
        ],
        q.provider_recipient().as_str(),
        q.platform_recipient().as_str()
    ])
}
pub(crate) fn policy(p: &Policy) -> Value {
    json!([
        pin(p.pin()),
        p.max_duration_ms(),
        p.notice_ms(),
        p.grace_ms()
    ])
}
pub(crate) fn template_manifest() -> Value {
    json!([
        "lab_template",
        1,
        "synthetic_lab_no_legal_jurisdiction",
        "synthetic_fixture_not_legal_review",
        CLAUSES
    ])
}
pub(crate) fn policy_manifest(p: &Policy, quote_age: u64, authority_age: u64) -> Value {
    json!([
        p.pin().id().as_str(),
        p.pin().revision(),
        p.max_duration_ms(),
        p.notice_ms(),
        p.grace_ms(),
        quote_age,
        authority_age
    ])
}
pub(crate) fn terms(r: &Request, registry: Digest) -> Result<Digest, Refusal> {
    let d = r.draft.fields();
    let clauses: Vec<_> = r.clauses.iter().map(Identifier::as_str).collect();
    hash(
        b"ZOORA_VL002_TERMS_JSON_TUPLE_V1\0",
        &json!([
            VALIDATION_VERSION,
            VALIDATION_CLASSIFICATION,
            UNITS,
            hex(registry),
            d.id.as_str(),
            d.instance.as_str(),
            space(&d.space),
            [party(&d.provider), party(&d.licensee), party(&d.platform)],
            [claim(&d.provider_authority), claim(&d.licensee_authority)],
            policy(&d.policy),
            pin(&d.template),
            interval(d.interval),
            quote(&d.quote),
            d.renewal_of.as_ref().map(Identifier::as_str),
            clauses
        ]),
    )
}
