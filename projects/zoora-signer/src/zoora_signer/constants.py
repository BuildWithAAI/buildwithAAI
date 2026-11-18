"""Pinned program ids. Verified 2026-11-17. Nothing here is from memory.

Sources, all read on 2026-11-17:

* Pump program ``6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P``
  https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/PUMP_PROGRAM_README.md
  On-chain ``getMultipleAccounts`` via ``api.mainnet-beta.solana.com``: executable,
  owner ``BPFLoaderUpgradeab1e11111111111111111111111``.
  Global PDA ``4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf`` is owned by that program.
* Current ``create_v2`` mint token program is Token-2022
  ``TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb``
  https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/instructions/COIN_CREATION.md
  The same account is executable on mainnet. Wrapped SOL still uses SPL Token
  ``TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`` (BUY.md, quote token program).
* PumpSwap ``pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA``
  https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/PUMP_SWAP_README.md
  On-chain: executable, and global config ``ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw``
  is owned by it. Observed lp fee 20 bps and protocol fee 5 bps match that README.
* Associated Token program and the System and ComputeBudget programs were executable
  on the same ``getMultipleAccounts`` call.

The Pump README example still shows ``fee_basis_points`` 100. The global account read on
2026-11-17 returned 95. Quotes use the on-chain value. A missing fee fails closed.
"""

from __future__ import annotations

import hashlib

VERIFIED_ON = "2026-11-17"
DOCS_COMMIT = "639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22"

PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
PUMP_GLOBAL = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
PUMP_SWAP = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
PUMP_SWAP_GLOBAL = "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw"
TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
ASSOCIATED_TOKEN = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
SYSTEM_PROGRAM = "11111111111111111111111111111111"
COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111"
WSOL_MINT = "So11111111111111111111111111111111111111112"

# Observed on the global account, not the README example (100).
OBSERVED_CURVE_FEE_BPS = 95
README_EXAMPLE_FEE_BPS = 100
OBSERVED_AMM_LP_FEE_BPS = 20
OBSERVED_AMM_PROTOCOL_FEE_BPS = 5

# Current trade instructions from idl/pump.json and idl/pump_amm.json at DOCS_COMMIT.
# buy_v3 / sell_v3 are the current bonding-curve trades (17 accounts). buy_v2 / sell_v2
# remain in the IDL. PumpSwap's current trades are buy_v2 / sell_v2, also 17 accounts.
# Docs: docs/instructions/TRADE_V3.md and docs/instructions/PUMP_SWAP_TRADE_V2.md.
BUY_V2_DISCRIMINATOR = bytes([184, 23, 238, 97, 103, 197, 211, 61])
SELL_V2_DISCRIMINATOR = bytes([93, 246, 130, 60, 231, 233, 64, 178])
BUY_V3_DISCRIMINATOR = bytes([7, 5, 29, 196, 245, 23, 101, 80])
SELL_V3_DISCRIMINATOR = bytes([28, 146, 222, 119, 38, 196, 105, 213])
# Same byte strings as the curve v2 discriminators, on the PumpSwap program.
PUMPSWAP_BUY_V2_DISCRIMINATOR = BUY_V2_DISCRIMINATOR
PUMPSWAP_SELL_V2_DISCRIMINATOR = SELL_V2_DISCRIMINATOR
FEE_PROGRAM = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
FEE_CONFIG_DISCRIMINATOR = hashlib.sha256(b"account:FeeConfig").digest()[:8]
# Recorded pump fee is 95 protocol + 30 creator. The cap can be lowered, not raised.
MAX_TOTAL_FEE_BPS = 125
FEE_BPS_MARGIN = 10
# SetComputeUnitLimit units, and SetComputeUnitPrice in micro-lamports per unit.
CU_LIMIT = 200_000
MAX_CU_LIMIT = 400_000
PRIORITY_MICRO_LAMPORTS = 1_000
# A price at or above 2**32 is not a zero fee. This cap is well under that.
MAX_CU_PRICE_MICRO_LAMPORTS = 1_000_000
SIGNATURE_FEE_LAMPORTS = 5_000
# On-chain UserVolumeAccumulator size, including the discriminator. Dry-run rent
# uses this length. A live buy asks getMinimumBalanceForRentExemption instead.
USER_VOLUME_ACCOUNT_BYTES = 137
# $2.000000 exactly, in micro-USD. 1 cent = 10_000 micro.
USD_CAP_MICRO = 2_000_000
# Recorded rent-exempt minimum for a Token-2022 ATA with extensions.
TOKEN_2022_ATA_RENT_LAMPORTS = 1_513_840

INSTRUCTION_ALLOWLIST = frozenset(
    {
        PUMP_PROGRAM,
        PUMP_SWAP,
        TOKEN_2022,
        SPL_TOKEN,
        ASSOCIATED_TOKEN,
        SYSTEM_PROGRAM,
        COMPUTE_BUDGET,
    }
)

PYTH_SOL_USD_FEED = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"
PYTH_SOL_USD_ACCOUNT = "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
PYTH_RECEIVER_PROGRAM = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"
PYTH_HERMES_PRICE_URL = "https://hermes.pyth.network/v2/updates/price/latest"
JUPITER_PRICE_URL = "https://api.jup.ag/price/v3"

# Helius free tier, read 2026-11-17:
# https://www.helius.dev/docs/billing/rate-limits
# https://www.helius.dev/docs/billing/plans
# 10 RPC requests/second, 5 getProgramAccounts/second, 1_000_000 credits/month.
HELIUS_FREE_RPC_PER_S = 10
HELIUS_FREE_GPA_PER_S = 5
HELIUS_CLIENT_RPC_PER_S = 8
HELIUS_CLIENT_GPA_PER_S = 4
RPC_PROVIDER_NAME = "helius"
HELIUS_LIVE_HOSTS = frozenset({"mainnet.helius-rpc.com"})
HELIUS_RPC_HOSTS = HELIUS_LIVE_HOSTS | frozenset({"devnet.helius-rpc.com"})
BONDING_CURVE_DISCRIMINATOR = bytes.fromhex("17b7f83760d8ac60")

STAKE_CAP_CENTS = 200
OPEN_TRADE_CAP = 3
BUYS_PER_DAY = 10
DAILY_LOSS_CAP_CENTS = 600
EXPOSURE_CAP_CENTS = 2000
WALLET_CAP_CENTS = 2500
SLIPPAGE_CAP_BPS = 1500
INTENTS_PER_HOUR = 4
BUY_MIN_INTERVAL_MS = 600_000
INTENT_TTL_MS = 90_000
HMAC_MIN_BYTES = 32
SIGNING_KEY_BYTES = 64
INTENT_PREFIX = b"v1|signer-intent|"
VET_FRESH_MS = 15_000
VET_TIMEOUT_S = 50.0
VET_BUDGET_S = 45
VET_CONFIG_VERSION = "vetcfg-20261117-v6"
VET_SCHEMA = "vet/1"
ORACLE_MAX_AGE_MS = 30_000
ORACLE_MAX_CONF_BPS = 100
ORACLE_MAX_DISAGREE_BPS = 200
CLOCK_SKEW_MS = 2_000
SLEEP_JUMP_MS = 30_000
PREFLIGHT_INTERVAL_MS = 600_000
UNCONFIRMED_MS = 90_000
CT_ZONE = "America/Chicago"

KEYRING_SERVICE = "zoora-signer"
KEYRING_SIGNING = "signing-key"
KEYRING_HMAC = "hmac-key"
KEYRING_EVENT_HMAC = "event-hmac"
KEYRING_RPC = "rpc-url"

FORBIDDEN_ENV = (
    "SIGNER_KEY",
    "SIGNING_KEY",
    "PRIVATE_KEY",
    "SOLANA_PRIVATE_KEY",
    "HMAC_SECRET",
    "ZOORA_HMAC",
    "ZOORA_EVENT_HMAC",
    "EVENT_HMAC",
    "ZOORA_SIGNING_KEY",
    "SEED_PHRASE",
    "MNEMONIC",
    "ZOORA_RPC_URL",
    "HELIUS_API_KEY",
    "RPC_URL",
)
