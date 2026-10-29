"""Owner-priced SPL service invoices, wallet-side signing, finalized receipt deduplication.

No server key, transaction submission, membership activation, token burn, locking or
liquidity allocation is fabricated by this service-payment adapter.
"""
import hashlib
import json
import os
import secrets
import struct
import time

from zoora_community.solana_payment_verifier import MEMO_PROGRAM, TOKEN_PROGRAM, verify_payment
from zoora_community.validation import Problem, canonical, wallet
from zoora_community.wallet_proof import decode_base58
from src.aai_scanner.transport import MAINNET_GENESIS, ProviderError, fetch_json

RPC_URL = "https://api.mainnet-beta.solana.com"
ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def encode58(raw):
    number = int.from_bytes(raw, "big")
    result = ""
    while number:
        number, remainder = divmod(number, 58)
        result = ALPHABET[remainder] + result
    return "1" * (len(raw) - len(raw.lstrip(b"\0"))) + result


def vector_size(value):
    output = bytearray()
    while True:
        byte = value & 0x7f
        value >>= 7
        output.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(output)


def transfer_message(quote, source, destination, blockhash):
    keys = [quote["payer"], source, destination, quote["mint"], MEMO_PROGRAM, TOKEN_PROGRAM]
    if len(set(keys)) != 6:
        raise Problem(422, "TRANSFER_ACCOUNT_COLLISION")
    raw_keys = [decode_base58(k, 32, "INVALID_TRANSACTION_ACCOUNT") for k in keys]
    recent = decode_base58(blockhash, 32, "INVALID_RECENT_BLOCKHASH")
    memo = quote["memo"].encode("ascii")
    # One signer, two writable token accounts, three readonly unsigned accounts.
    message = bytes((1, 0, 3)) + vector_size(6) + b"".join(raw_keys) + recent + vector_size(2)
    message += bytes((4, 1, 0)) + vector_size(len(memo)) + memo
    data = bytes((12,)) + struct.pack("<Q", int(quote["amount_raw"])) + bytes((quote["decimals"],))
    message += bytes((5, 4, 1, 3, 2, 0)) + vector_size(len(data)) + data
    return message


class PaymentRPC:
    METHODS = {"getGenesisHash", "getSlot", "getTransaction", "getAccountInfo", "getTokenAccountsByOwner", "getLatestBlockhash"}

    def call(self, method, params):
        if method not in self.METHODS:
            raise Problem(400, "PAYMENT_RPC_METHOD_REJECTED")
        try:
            result, _digest = fetch_json(RPC_URL, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=5)
        except ProviderError:
            raise Problem(502, "PAYMENT_RPC_UNAVAILABLE") from None
        if (type(result) is not dict or result.get("jsonrpc") != "2.0" or result.get("id") != 1
                or "error" in result or "result" not in result):
            raise Problem(502, "PAYMENT_RPC_ENVELOPE_REJECTED")
        return result["result"]

    def identity(self):
        if self.call("getGenesisHash", []) != MAINNET_GENESIS:
            raise Problem(502, "PAYMENT_CHAIN_MISMATCH")

    def token_account(self, owner, mint, amount):
        response = self.call("getTokenAccountsByOwner", [owner, {"mint": mint}, {"encoding": "jsonParsed", "commitment": "finalized"}])
        rows = response.get("value")
        if type(rows) is not list or len(rows) > 100:
            raise Problem(502, "TOKEN_ACCOUNTS_REJECTED")
        eligible = []
        for row in rows:
            try:
                account = row["account"]
                info = account["data"]["parsed"]["info"]
                if (account["owner"] == TOKEN_PROGRAM and info["owner"] == owner and info["mint"] == mint
                        and info["state"] == "initialized" and int(info["tokenAmount"]["amount"]) >= amount):
                    decode_base58(row["pubkey"], 32, "TOKEN_ACCOUNT_REJECTED")
                    eligible.append(row["pubkey"])
            except (KeyError, ValueError, TypeError):
                raise Problem(502, "TOKEN_ACCOUNT_SCHEMA_REJECTED") from None
        if not eligible:
            raise Problem(422, "FUNDED_SOURCE_OR_RECIPIENT_TOKEN_ACCOUNT_REQUIRED")
        return sorted(eligible)[0]


class Payments:
    def __init__(self, ledger, env=None, rpc=None):
        self.ledger = ledger
        env = os.environ if env is None else env
        self.mint = env.get("ZOORA_AAI_MINT", "")
        self.recipient = env.get("ZOORA_PAYMENT_RECIPIENT", "")
        self.rpc = rpc or PaymentRPC()
        self.last_poll = 0

    @property
    def configured(self):
        if not self.mint or not self.recipient:
            return False
        try:
            for value in (self.mint, self.recipient):
                decode_base58(value, 32, "PAYMENT_CONFIG_REJECTED")
        except Problem:
            return False
        return True

    @staticmethod
    def view(row):
        value = json.loads(row["quote"])
        value.update({"id": row["id"], "state": row["state"], "signature": row["signature"],
                      "error": row["error"], "message_base58": row["message"],
                      "purpose": "OWNER_PRICED_SERVICE_PAYMENT", "activation_granted": False})
        if row["receipt"]:
            value["receipt"] = json.loads(row["receipt"])
        return value

    def create(self, request_id, payer, amount_raw):
        if not self.configured:
            raise Problem(503, "AAI_MINT_AND_PAYMENT_RECIPIENT_REQUIRED")
        wallet(payer)
        decode_base58(payer, 32, "INVALID_PAYER")
        if payer == self.recipient:
            raise Problem(400, "PAYMENT_PARTIES_MUST_DIFFER")
        if type(request_id) is not str or not 8 <= len(request_id) <= 80:
            raise Problem(400, "INVALID_REQUEST_ID")
        if type(amount_raw) is not str or not 1 <= len(amount_raw) <= 20 or not amount_raw.isascii() or not amount_raw.isdigit() or not 0 < int(amount_raw) < 2**64:
            raise Problem(400, "INVALID_TOKEN_AMOUNT")
        amount_raw = str(int(amount_raw))
        with self.ledger.db() as db:
            old = db.execute("SELECT * FROM payments WHERE request_id=?", (request_id,)).fetchone()
            if old:
                value = self.view(old)
                if value["payer"] != payer or value["amount_raw"] != amount_raw:
                    raise Problem(409, "PAYMENT_REQUEST_CONFLICT")
                return value
        self.rpc.identity()
        account = self.rpc.call("getAccountInfo", [self.mint, {"encoding": "jsonParsed", "commitment": "finalized"}]).get("value")
        try:
            if account["owner"] != TOKEN_PROGRAM or account["data"]["parsed"]["type"] != "mint":
                raise Problem(422, "STANDARD_SPL_MINT_REQUIRED")
            if account["data"]["parsed"]["info"].get("isInitialized") is not True:
                raise Problem(422, "INITIALIZED_MINT_REQUIRED")
            decimals = account["data"]["parsed"]["info"]["decimals"]
            if type(decimals) is not int or not 0 <= decimals <= 18:
                raise ValueError
        except (TypeError, KeyError, ValueError):
            raise Problem(502, "PAYMENT_MINT_SCHEMA_REJECTED") from None
        source = self.rpc.token_account(payer, self.mint, int(amount_raw))
        destination = self.rpc.token_account(self.recipient, self.mint, 0)
        recent = self.rpc.call("getLatestBlockhash", [{"commitment": "finalized"}])["value"]
        created = self.ledger.clock() // 1000
        payment_id = secrets.token_hex(16)
        quote = {"payer": payer, "recipient": self.recipient, "mint": self.mint, "amount_raw": amount_raw,
                 "decimals": decimals, "memo": "ZOORA-MEMBER-" + payment_id,
                 "quote_created_at": created, "quote_expires_at": created + 120,
                 "network": "solana:mainnet", "source_token_account": source,
                 "recipient_token_account": destination, "last_valid_block_height": recent["lastValidBlockHeight"]}
        message = transfer_message(quote, source, destination, recent["blockhash"])
        quote["message_sha256"] = hashlib.sha256(message).hexdigest()
        at = self.ledger.clock()
        with self.ledger.db(True) as db:
            if db.execute("SELECT count(*) FROM payments").fetchone()[0] >= 10000:
                raise Problem(503, "PAYMENT_LEDGER_CAPACITY")
            db.execute("INSERT INTO payments(id,request_id,payer,quote,message,state,created_ms,updated_ms) VALUES(?,?,?,?,?,'AWAITING_WALLET',?,?)", (payment_id, request_id, payer, canonical(quote), encode58(message), at, at))
            row = db.execute("SELECT * FROM payments WHERE id=?", (payment_id,)).fetchone()
        return self.view(row)

    def get(self, payment_id, payer=None, owner=False):
        with self.ledger.db() as db:
            row = db.execute("SELECT * FROM payments WHERE id=?", (payment_id,)).fetchone()
            if row is None or (not owner and payer != row["payer"]):
                raise Problem(404, "PAYMENT_NOT_FOUND")
            return self.view(row)

    def submit(self, payment_id, signature, payer=None, owner=False):
        from zoora_community.solana_rpc import transaction_signature
        transaction_signature(signature)
        self.get(payment_id, payer, owner)
        with self.ledger.db(True) as db:
            row = db.execute("SELECT * FROM payments WHERE id=?", (payment_id,)).fetchone()
            if row["signature"] is not None and row["signature"] != signature:
                raise Problem(409, "PAYMENT_SIGNATURE_ALREADY_BOUND")
            other = db.execute("SELECT id FROM payments WHERE signature=?", (signature,)).fetchone()
            if other is not None and other["id"] != payment_id:
                raise Problem(409, "PAYMENT_SIGNATURE_REPLAY")
            if row["state"] == "AWAITING_WALLET":
                db.execute("UPDATE payments SET state='SUBMITTED',signature=?,updated_ms=? WHERE id=?", (signature, self.ledger.clock(), payment_id))
        return self.get(payment_id, payer, owner)

    def poll(self):
        if time.monotonic() - self.last_poll < 10:
            return
        self.last_poll = time.monotonic()
        with self.ledger.db(True) as db:
            row = db.execute("SELECT * FROM payments WHERE state='SUBMITTED' ORDER BY updated_ms,id LIMIT 1").fetchone()
            if row is not None:
                # Rotate before a bounded RPC read, including pending and unavailable outcomes.
                # One missing transaction must not starve every other payer's reconciliation.
                last = db.execute("SELECT max(updated_ms) FROM payments WHERE state='SUBMITTED'").fetchone()[0]
                db.execute("UPDATE payments SET updated_ms=? WHERE id=? AND state='SUBMITTED'",
                           (max(self.ledger.clock(), last + 1), row["id"]))
        if row is None:
            return
        quote = json.loads(row["quote"])
        try:
            self.rpc.identity()
            transaction = self.rpc.call("getTransaction", [row["signature"], {"encoding": "jsonParsed", "commitment": "finalized", "maxSupportedTransactionVersion": 0}])
            if transaction is None:
                if self.ledger.clock() - row["created_ms"] < 3600000:
                    return
                with self.ledger.db(True) as db:
                    db.execute("UPDATE payments SET state='UNKNOWN',error='PAYMENT_NOT_OBSERVED_AT_FINALITY',updated_ms=? WHERE id=? AND state='SUBMITTED'", (self.ledger.clock(), row["id"]))
                return
            finalized_slot = self.rpc.call("getSlot", [{"commitment": "finalized"}])
            request = {k: quote[k] for k in ("payer", "recipient", "mint", "amount_raw", "decimals", "memo", "quote_created_at", "quote_expires_at")}
            receipt = verify_payment(transaction, finalized_slot=finalized_slot, signature=row["signature"], **request)
            receipt["receipt_deduplication"] = "DURABLE_UNIQUE_SIGNATURE"
            state, error = "CONFIRMED", None
        except Problem as problem:
            if problem.status >= 500:
                if self.ledger.clock() - row["created_ms"] < 3600000:
                    return
                receipt, state, error = None, "UNKNOWN", "PAYMENT_RECONCILIATION_UNAVAILABLE"
            else:
                receipt, state, error = None, "REJECTED", problem.code
        with self.ledger.db(True) as db:
            db.execute("UPDATE payments SET state=?,receipt=?,error=?,updated_ms=? WHERE id=? AND state='SUBMITTED' AND signature=?", (state, canonical(receipt) if receipt else None, error, self.ledger.clock(), row["id"], row["signature"]))
