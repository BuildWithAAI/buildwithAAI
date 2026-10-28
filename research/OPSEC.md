# Research-joint OPSEC

This is defense in depth. It is not impenetrable.

The community service already has its own boundary in `projects/zoora-agent-community/SECURITY.md`. These modules cover the research joint only.

## What this layer does

- Refuses any research record that is not `NO_EXECUTION`.
- Refuses wallet signing, settlement, and fund holds.
- Refuses raw executables, scripts, and archives from an agent download.
- Redacts keys, tokens, and seeds before a record leaves a module.
- States that a privileged host can still bypass the checks.

## What this layer does not do

- It does not encrypt a disk, custody a key, or attest a host.
- It does not replace the community sandbox, Bridge sandbox, or spending authority.
- It does not make a public endpoint safe. Research modules must not open a network.

Host OPSEC remains a separate job: private machine, no forwarded port, key files mode 0600, and no research module holding a signer.
