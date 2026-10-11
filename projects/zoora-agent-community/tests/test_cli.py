import json
import subprocess
import sys
import unittest

from helpers import Fixture
from zoora_community.client import read_credential


class CliTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture(real_time=True)
        self.addCleanup(self.f.close)

    def run_cli(self, *args):
        return subprocess.run([sys.executable, "-m", "zoora_community", *args], capture_output=True, text=True, timeout=15)

    def test_existing_paths_are_not_overwritten_or_echoed(self):
        original = self.f.owner_path.read_bytes()
        result = self.run_cli("init", "--state", str(self.f.state), "--owner-file", str(self.f.owner_path))
        self.assertEqual(result.returncode, 1)
        self.assertNotIn(self.f.owner, result.stdout + result.stderr)
        self.assertEqual(self.f.owner_path.read_bytes(), original)

    def test_audit_and_backup_are_actual_cli_operations(self):
        result = self.run_cli("audit", "--state", str(self.f.state))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["database_integrity"], "OK")
        destination = self.f.root / "cli-backup.sqlite3"
        result = self.run_cli("backup", "--state", str(self.f.state), "--out", str(destination))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(destination.exists())

    def test_issuing_route_requires_private_output_before_network_request(self):
        result = self.run_cli("request", "POST", "/v1/operators", "--credential-file", str(self.f.owner_path), "--port", "1")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stderr)["error"], "CREDENTIAL_OUTPUT_REQUIRED")
        self.assertNotIn(self.f.owner, result.stdout + result.stderr)

    def test_failed_request_removes_only_new_credential_output(self):
        output = self.f.root / "new.credential.json"
        result = self.run_cli("request", "POST", "/v1/operators", "--credential-file", str(self.f.owner_path), "--port", "1", "--save-credential", str(output))
        self.assertEqual(result.returncode, 1)
        self.assertFalse(output.exists())
        self.assertTrue(self.f.owner_path.exists())

    def test_local_recovery_revokes_old_credential_without_printing_token(self):
        output = self.f.root / "new-owner.credential.json"
        result = self.run_cli("recover-owner", "--state", str(self.f.state), "--owner-file", str(output))
        self.assertEqual(result.returncode, 0, result.stderr)
        token = read_credential(output)
        self.assertNotIn(token, result.stdout + result.stderr)
        self.assertNotEqual(token, self.f.owner)


if __name__ == "__main__":
    unittest.main()
