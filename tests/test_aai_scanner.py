import unittest
from unittest.mock import patch
from src.aai_scanner.mint import decode_address, encode_address, inspect_mint, rpc

class MintScannerTests(unittest.TestCase):
    def test_valid_system_address(self):
        self.assertEqual(len(decode_address("11111111111111111111111111111111")), 32)

    def test_base58_roundtrip_with_leading_zeros(self):
        raw = bytes([0, 0, 1]) + bytes(29)
        self.assertEqual(decode_address(encode_address(raw)), raw)

    def test_exact_supply_and_base58_authorities(self):
        import base64
        data = bytearray(82)
        data[0:4] = (1).to_bytes(4, "little")
        data[4:36] = bytes([0] * 31 + [1])
        data[36:44] = (9007199254740993).to_bytes(8, "little")
        data[44] = 9
        data[45] = 1
        with patch("src.aai_scanner.mint.rpc") as mock_rpc:
            mock_rpc.return_value = {"result": {"context": {"slot": 123}, "value": {
                "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                "data": [base64.b64encode(data).decode(), "base64"]}}}
            result = inspect_mint("11111111111111111111111111111111",
                                  endpoint="https://api.mainnet-beta.solana.com")
        self.assertEqual(result["supply"], "9007199.254740993")
        self.assertEqual(result["mint_authority"], encode_address(bytes(data[4:36])))

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
