# Render farm public keys

The farm encrypts every output of an encrypted request (renders, checksums, tool logs) to a **public** key kept here,
`<recipient>.pub.pem`. Only the matching **private** key can decrypt them, and it never enters this repository or
GitHub: no CI step can read an output. Details: `docs/RENDER_FARM.md`, "Keys and secrets".

| File | Recipient | Who holds the private key |
| --- | --- | --- |
| `owner.pub.pem` | `owner` (the default for every request) | The owner, on his own computer. **Not created yet: an owner step.** |
| `selftest.pub.pem` | `selftest` (the farm's own self-test; test compositions only) | Nobody needs it: it was made on 2026-11-24 in a scratch folder of the build session, to prove the encrypted path end to end. It is not in this repository or on GitHub, and the farm accepts this recipient only for test compositions. |

## Creating the owner's key pair (once)

On the owner's computer, from `projects/video-studio`:

```bash
mkdir -p ~/.zoora && chmod 700 ~/.zoora
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -aes-256-cbc -out ~/.zoora/farm-owner.key
openssl pkey -in ~/.zoora/farm-owner.key -pubout -out scripts/farm/keys/owner.pub.pem
git add scripts/farm/keys/owner.pub.pem && git commit -m "Render farm: the owner's public key"
```

`-aes-256-cbc` protects the private key file with a passphrase (`scripts/farm/decrypt.sh` reads it from
`FARM_KEY_PASSPHRASE`). Keep a backup of `~/.zoora/farm-owner.key` and its passphrase in a password manager: without
it, encrypted artifacts cannot be opened. Never commit, paste or upload the private key.

The farm refuses keys that are not RSA or are shorter than 3072 bits.
