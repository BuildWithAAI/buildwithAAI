"""Controlled JSON fixtures test parsing only; they are never chain or payment evidence."""

import unittest
from unittest.mock import Mock, patch

from zoora_community import live_connections as live
from zoora_community.solana_payment_verifier import (
    MEMO_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, payment_request, verify_payment,
)
from zoora_community.solana_rpc import NETWORKS
from zoora_community.validation import Problem

PAYER = "47eFuHR9ste9kopiJ9eRxcwahmE62JovbKe5r7AjANut"
RECIPIENT = "44ZsKstjBY52Zz1iB9Q9HqVPbpK4d6BqAJgqshz1bXPs"
MINT = "72p1XsRo7KRptf8ZhPoHvVFneLPpUT4rpTYRu5EnKB8A"
SOURCE = "9vLSZ1gujMzisVrK5r3ZBXLVJMrF3fp6BtAUDyD94nW2"
DESTINATION = "D3XSB6m2ZjNjTspKVd8hXdmi19CbjmtKabBLLzgf9x6B"
SIGNATURE = "56rgv1Fqg7MHLoct3ESNx8DHeC2c5TFYyK1As35paWn2KYuRuXPFZK3XDEwkkZemVfmnKrkj17mMzz4N1d8kMYC4"
OTHER_SIGNATURE = "4fqGV381e6h87Hn5vGm7W5MGivHFtTisS9G2UpbsuritcTmXPsPtU32BWF2Bw4yMxH1NAFgGtpWbuVfXbZt8xTBw"
MEMO = "ZOORA-MEMBER-abcdefghijklmnopqrstuv"
DEFAULT_RESULT = object()


def row(index, owner, amount):
    return {"accountIndex": index, "mint": MINT, "owner": owner,
            "programId": TOKEN_PROGRAM,
            "uiTokenAmount": {"amount": str(amount), "decimals": 6,
                              "uiAmount": None, "uiAmountString": str(amount)}}


def transaction():
    keys = [PAYER, SOURCE, DESTINATION, MINT, RECIPIENT, MEMO_PROGRAM, TOKEN_PROGRAM]
    accounts = [{"pubkey": key, "signer": index == 0, "source": "transaction",
                 "writable": index in (0, 1, 2)} for index, key in enumerate(keys)]
    return {"version": "legacy", "slot": 500, "blockTime": 150,
            "meta": {"err": None, "fee": 5_000, "innerInstructions": [],
                     "preTokenBalances": [row(1, PAYER, 5_000), row(2, RECIPIENT, 100)],
                     "postTokenBalances": [row(1, PAYER, 4_000), row(2, RECIPIENT, 1_100)]},
            "transaction": {"signatures": [SIGNATURE],
                            "message": {"accountKeys": accounts,
                                        "instructions": [
                                            {"programId": MEMO_PROGRAM, "program": "spl-memo",
                                             "parsed": MEMO, "stackHeight": 1},
                                            {"programId": TOKEN_PROGRAM, "program": "spl-token",
                                             "parsed": {"type": "transferChecked", "info": {
                                                 "authority": PAYER, "source": SOURCE,
                                                 "destination": DESTINATION, "mint": MINT,
                                                 "tokenAmount": {"amount": "1000", "decimals": 6,
                                                                 "uiAmount": None,
                                                                 "uiAmountString": "0.001"}}},
                                             "stackHeight": 1}]}}}


def request(**overrides):
    values = {"signature": SIGNATURE, "payer": PAYER, "recipient": RECIPIENT,
              "mint": MINT, "amount_raw": "1000", "decimals": 6, "memo": MEMO,
              "quote_created_at": 100, "quote_expires_at": 200}
    values.update(overrides)
    return values


class SolanaPaymentVerifierTests(unittest.TestCase):
    def rejected(self, code, result=DEFAULT_RESULT, finalized_slot=501, **overrides):
        with self.assertRaises(Problem) as caught:
            value = transaction() if result is DEFAULT_RESULT else result
            verify_payment(value, finalized_slot=finalized_slot, **request(**overrides))
        self.assertEqual(caught.exception.code, code)

    def test_exact_finalized_checked_transfer_produces_evidence_only(self):
        result = verify_payment(transaction(), finalized_slot=501, **request())
        self.assertEqual((result["execution"], result["finality"], result["amount_raw"]),
                         ("SUCCEEDED", "PROVIDER_REPORTED_FINALIZED", "1000"))
        self.assertEqual(result["receipt_key"], "solana:mainnet:" + SIGNATURE)
        self.assertEqual(result["transaction_fee_lamports"], "5000")
        self.assertFalse(result["membership_activated"])
        self.assertFalse(result["fulfillment_authorized"])
        self.assertFalse(result["burn_verified"])
        self.assertFalse(result["lp_deposit_verified"])
        self.assertEqual((result["quote_created_at_unix_seconds"],
                          result["quote_expires_at_unix_seconds"]), (100, 200))

    def test_classic_transfer_is_bound_to_expected_mint_by_token_account_balances(self):
        value = transaction()
        info = value["transaction"]["message"]["instructions"][1]["parsed"]["info"]
        value["transaction"]["message"]["instructions"][1]["parsed"] = {
            "type": "transfer", "info": {key: info[key] for key in
                ("authority", "source", "destination")} | {"amount": "1000"}}
        result = verify_payment(value, finalized_slot=501, **request())
        self.assertEqual(result["mint"], MINT)

    def test_checked_transfer_requires_exact_quote_and_order_memo(self):
        value = transaction()
        value["transaction"]["signatures"][0] = OTHER_SIGNATURE
        self.rejected("PAYMENT_SIGNATURE_MISMATCH", value)
        self.rejected("PAYMENT_MINT_MISMATCH", mint="11111111111111111111111111111111")
        self.rejected("PAYMENT_AMOUNT_MISMATCH", amount_raw="1001")
        self.rejected("PAYMENT_DECIMALS_REJECTED", decimals=True)
        self.rejected("PAYMENT_ORDER_MEMO_MISMATCH", memo="ZOORA-MEMBER-zyxwvutsrqponmlkjihgfe")
        self.rejected("PAYMENT_OUTSIDE_QUOTE_WINDOW", quote_created_at=160)
        self.rejected("PAYMENT_OUTSIDE_QUOTE_WINDOW", quote_expires_at=140)

    def test_payer_must_sign_and_be_the_transfer_authority(self):
        value = transaction()
        value["transaction"]["message"]["accountKeys"][0]["signer"] = False
        self.rejected("PAYMENT_PAYER_SIGNATURE_MISSING", value)
        value = transaction()
        value["transaction"]["message"]["instructions"][1]["parsed"]["info"]["authority"] = RECIPIENT
        self.rejected("PAYMENT_TRANSFER_AUTHORITY_REJECTED", value)

    def test_balance_deltas_must_match_exact_source_and_treasury_credit(self):
        for field, amount in (("preTokenBalances", 4_900), ("postTokenBalances", 1_099)):
            value = transaction()
            value["meta"][field][0 if field == "preTokenBalances" else 1] = row(
                1 if field == "preTokenBalances" else 2,
                PAYER if field == "preTokenBalances" else RECIPIENT, amount)
            with self.subTest(field=field):
                self.rejected("PAYMENT_TOKEN_DELTAS_MISMATCH", value)
        value = transaction()
        value["meta"]["postTokenBalances"].append(row(3, PAYER, 1))
        self.rejected("PAYMENT_TOKEN_DELTAS_MISMATCH", value)

    def test_created_destination_account_is_supported_but_closed_source_is_not(self):
        value = transaction()
        value["meta"]["preTokenBalances"] = [row(1, PAYER, 1_000)]
        value["meta"]["postTokenBalances"] = [row(1, PAYER, 0), row(2, RECIPIENT, 1_000)]
        result = verify_payment(value, finalized_slot=501, **request())
        self.assertEqual(result["amount_raw"], "1000")
        value["meta"]["postTokenBalances"] = [row(2, RECIPIENT, 1_000)]
        self.rejected("PAYMENT_TOKEN_OWNER_MISMATCH", value)

    def test_failed_unfinalized_unparsed_or_ambiguous_transactions_are_refused(self):
        self.rejected("PAYMENT_TRANSACTION_FAILED_OR_UNVERIFIED", transaction() | {"meta": {"err": {"InstructionError": [0, "x"]}}})
        self.rejected("PAYMENT_TRANSACTION_NOT_FOUND_AT_FINALIZED", None)
        self.rejected("PAYMENT_SLOT_NOT_FINALIZED", finalized_slot=499)
        value = transaction()
        value["meta"]["innerInstructions"] = None
        self.rejected("PAYMENT_INNER_INSTRUCTIONS_UNAVAILABLE", value)
        value = transaction()
        value["blockTime"] = None
        self.rejected("PAYMENT_BLOCK_TIME_UNAVAILABLE", value)
        value = transaction()
        value["transaction"]["message"]["instructions"].append(
            value["transaction"]["message"]["instructions"][1])
        self.rejected("PAYMENT_TRANSFER_AMBIGUOUS", value)
        value = transaction()
        value["transaction"]["message"]["instructions"].insert(
            1, value["transaction"]["message"]["instructions"][0])
        self.rejected("PAYMENT_ORDER_MEMO_MISMATCH", value)
        value = transaction()
        value["transaction"]["message"]["instructions"][1]["programId"] = TOKEN_2022_PROGRAM
        self.rejected("PAYMENT_TRANSFER_UNSUPPORTED", value)

    def test_invalid_local_quote_is_rejected_before_any_rpc_call(self):
        with patch.object(live, "request_json") as rpc:
            with self.assertRaises(Problem):
                live.solana_payment_read(**request(amount_raw="01"))
            rpc.assert_not_called()

    def test_mainnet_read_checks_cluster_finalized_slot_and_exact_gettransaction_shape(self):
        values = [NETWORKS["solana:mainnet"][1], 501, transaction()]
        responses = [({"jsonrpc": "2.0", "id": 1, "result": value}, "a" * 64)
                     for value in values]
        with patch.object(live, "request_json", side_effect=responses) as rpc:
            observed = live.solana_payment_read(**request())
        self.assertEqual(observed["payment"]["signature"], SIGNATURE)
        self.assertFalse(observed["membership_activated"])
        self.assertEqual(rpc.call_count, 3)
        call = rpc.call_args_list[2]
        self.assertEqual(call.args, (NETWORKS["solana:mainnet"][0], "POST", "/"))
        self.assertEqual(call.kwargs["payload"]["params"], [SIGNATURE, {
            "commitment": "finalized", "encoding": "jsonParsed",
            "maxSupportedTransactionVersion": 1}])

    def test_fixed_rpc_boundary_rejects_write_or_weakened_transaction_queries(self):
        good = {"jsonrpc": "2.0", "id": 1, "method": "getTransaction", "params": [SIGNATURE, {
            "commitment": "finalized", "encoding": "jsonParsed",
            "maxSupportedTransactionVersion": 1}]}
        response = Mock()
        response.status = 200
        response.getheader.side_effect = lambda name: {
            "Content-Type": "application/json", "Content-Encoding": "identity",
            "Content-Length": "38"}.get(name)
        response.read1.side_effect = [b'{"jsonrpc":"2.0","id":1,"result":null}', b""]
        with patch.object(live, "HTTPSConnection") as connection:
            connection.return_value.getresponse.return_value = response
            value, _digest = live.request_json(NETWORKS["solana:mainnet"][0], "POST", "/", payload=good)
            self.assertIsNone(value["result"])
        with patch.object(live, "HTTPSConnection") as connection:
            for changes in ({"commitment": "confirmed"}, {"encoding": "json"},
                            {"maxSupportedTransactionVersion": 2}, {"encoding": "jsonParsed",
                             "commitment": "finalized", "maxSupportedTransactionVersion": 1,
                             "replaceRecentBlockhash": True}):
                with self.subTest(changes=changes), self.assertRaises(Problem):
                    live.request_json(NETWORKS["solana:mainnet"][0], "POST", "/", payload={
                        **good, "params": [SIGNATURE, changes]})
            connection.assert_not_called()

    def test_payment_report_stays_blocked_on_real_rpc_failure(self):
        with patch.object(live, "request_json", side_effect=Problem(502, "CONNECTION_DNS_FAILED")):
            with self.assertRaises(Problem) as caught:
                live.solana_payment_read(**request())
        self.assertEqual(caught.exception.code, "CONNECTION_DNS_FAILED")

    def test_quote_input_requires_canonical_raw_units_and_unique_memo(self):
        for changes in ({"amount_raw": "0"}, {"amount_raw": "010"},
                        {"amount_raw": str(2**64)}, {"memo": "ZOORA-MEMBER-short"},
                        {"quote_expires_at": 86_501}, {"payer": RECIPIENT}):
            with self.subTest(changes=changes), self.assertRaises(Problem):
                payment_request(**request(**changes))


if __name__ == "__main__":
    unittest.main()
