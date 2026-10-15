# BuildWithAAI development update — payment recovery

We have added a supported backup and restore workflow for the separate payment-provider journal.

The important failure case is simple: an old backup can say a payment was never submitted even though the provider already received it. Restoring that backup must not give an agent permission to pay again.

Every supported restore now enters durable GET-only recovery mode. It can inspect the saved records, check known transfer IDs and reconcile matching previously attempted transfers. It cannot create a payment, retry an unknown payment through POST or prepare a new payment instruction. Backing up and restoring that recovery copy does not reactivate it.

The workflow checks an independently retained file hash and complete local history before publishing a new private state directory. Existing files and directories are never overwritten. Older original journals require an explicit verified backup before upgrade.

The new separate-process rehearsal passes 26 checks against a local verified HTTPS test server. It includes a backup taken before a payment accepted by the test server, lost replies, pending leases, process death during recovery, process death after restore publication, corrupt backups and two competing backup processes. Ten HTTPS requests produced three unique test transfer objects: three original payment-create requests and seven reads. Restore and recovery added no payment-create request.

This is local sandbox tooling. External Bridge calls remain zero. Provider approval, real merchant acceptance, Phantom signing, real USDC settlement and public deployment are still unfinished. The work strengthens recovery before connecting those boundaries; it does not announce live payments or financial returns.

[Method and commands](../../projects/zoora-agent-community/BRIDGE_RECOVERY.md) · [Source-specific validation](../../projects/zoora-agent-community/VALIDATION_AE026.md)
