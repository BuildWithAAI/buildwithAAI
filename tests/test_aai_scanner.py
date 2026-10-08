import unittest
from unittest.mock import patch
from src.aai_scanner.mint import decode_address, inspect_mint, rpc

class MintScannerTests(unittest.TestCase):
    def test_valid_system_address(self):
        self.assertEqual(len(decode_address("11111111111111111111111111111111")), 32)

    def test_invalid_address_rejected(self):
        with self.assertRaises(ValueError):
            decode_address("not-a-mint")

    def test_no_transaction_methods(self):
        with self.assertRaises(ValueError):
            rpc("https://api.mainnet-beta.solana.com", "sendTransaction", [])

    @patch("src.aai_scanner.mint.rpc")
    def test_missing_account_is_unavailable(self, mock_rpc):
        mock_rpc.return_value = {"result": {"context": {"slot": 1}, "value": None}}
        result = inspect_mint("11111111111111111111111111111111", endpoint="https://api.mainnet-beta.solana.com")
        self.assertEqual(result["status"], "UNAVAILABLE")
