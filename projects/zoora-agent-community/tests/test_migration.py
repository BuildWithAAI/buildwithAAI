from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from legacy_fixture import create  # noqa: E402
from fixture_signatures import signed_body  # noqa: E402
from zoora_community.store import SCHEMA_VERSION, Store  # noqa: E402
from zoora_community.recovery import restore_backup, verify_backup  # noqa: E402
from zoora_community.validation import Problem  # noqa: E402


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.at = 1_800_000_000_000
        self.legacy, self.files, self.ids = create(self.root, clock=lambda: self.at)
        self.agent = json.loads(self.files["agent"].read_text())["token"]

    def refused(self, code, fn):
        with self.assertRaises(Problem) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)

    def schema_five(self):
        with closing(sqlite3.connect(self.legacy.path, autocommit=True)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            for version in (2, 3, 4, 5):
                ddl = Path(__file__).resolve().parent.parent / "zoora_community" / f"migration_{version:03}.sql"
                for statement in ddl.read_text().split(";"):
                    if statement.strip():
                        connection.execute(statement)
            connection.execute("PRAGMA user_version=5")
            connection.execute("COMMIT")
        old = Store(self.legacy.state, clock=lambda: self.at, _schema_version=5)
        with closing(old._connection()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            checkpoint = connection.execute("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1").fetchone()[0]
            old._event(connection, {"role": "OWNER", "principal_id": "owner"}, "SCHEMA_MIGRATE", "schema",
                       {"from": 1, "to": 5, "backup_audit_head": checkpoint}, self.at)
            principal = old._authenticate(connection, self.agent, self.at)
            job = old._jobs_write(connection, principal, "POST", "/v1/jobs",
                                  {"request_id": "a" * 32, "title": "Schema five task", "prompt": "Preserved"}, self.at)[1]["job"]
            connection.execute("COMMIT")
        return old, job

    def schema_eight(self):
        with closing(sqlite3.connect(self.legacy.path, autocommit=True)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            for version in range(2, 9):
                ddl = Path(__file__).resolve().parent.parent / "zoora_community" / f"migration_{version:03}.sql"
                for statement in ddl.read_text(encoding="utf-8").split(";"):
                    if statement.strip():
                        connection.execute(statement)
            connection.execute("PRAGMA user_version=8")
            connection.execute("COMMIT")
        old = Store(self.legacy.state, clock=lambda: self.at, _schema_version=8)
        with closing(old._connection()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            checkpoint = connection.execute("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1").fetchone()[0]
            old._event(connection, {"role":"OWNER", "principal_id":"owner"}, "SCHEMA_MIGRATE", "schema",
                       {"from":1, "to":8, "backup_audit_head":checkpoint}, self.at)
            principal = old._authenticate(connection, self.agent, self.at)
            thread = old._forum_write(connection, principal, "POST", "/v1/forum/threads",
                                      {"topic":"crypto", "title":"Preserved research", "body":"Existing content."}, self.at)[1]
            connection.execute("COMMIT")
        return old, thread

    def test_schema_eight_upgrade_preserves_forum_and_has_no_market_or_credit_grants(self):
        old, thread = self.schema_eight()
        before = old.audit()
        backup = self.root / "schema-eight.sqlite3"
        current = Store.migrate(old.state, backup, clock=lambda: self.at)
        self.assertEqual(verify_backup(backup)["audit"], before)
        self.assertEqual(current.call("GET", "/v1/forum/threads/"+thread["id"], token=self.agent)[1]["thread"]["body"], "Existing content.")
        self.assertEqual(current.call("GET", "/v1/practice/episodes", token=self.agent)[1]["items"], [])
        self.assertEqual(current.audit()["schema_version"], SCHEMA_VERSION)

    def test_schema_eight_failed_upgrade_restores_original_with_backup(self):
        old, _ = self.schema_eight()
        before = old.audit()
        backup = self.root / "schema-eight-failure.sqlite3"
        with patch.object(Store, "_event", side_effect=RuntimeError("injected migration failure")):
            with self.assertRaises(RuntimeError):
                Store.migrate(old.state, backup, clock=lambda: self.at)
        self.assertEqual(old.audit(), before)
        self.assertEqual(verify_backup(backup)["audit"], before)
        with closing(old._connection()) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='practice_episodes'").fetchone()[0], 0)

    def test_schema_five_upgrade_preserves_pending_work_and_creates_no_commerce_grants(self):
        old, job = self.schema_five()
        before = old.audit()
        backup = self.root / "schema-five.sqlite3"
        current = Store.migrate(old.state, backup, clock=lambda: self.at)
        self.assertEqual(verify_backup(backup)["audit"], before)
        self.assertEqual(current.call("GET", "/v1/jobs/" + job["id"], token=self.agent)[1]["state"], "QUEUED")
        self.assertEqual(current.call("GET", "/v1/commerce/books", token=self.agent)[1]["items"], [])
        with closing(sqlite3.connect(backup)) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 5)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='commerce_books'").fetchone()[0], 0)
        self.assertEqual(current.audit()["schema_version"], SCHEMA_VERSION)

    def test_schema_five_failed_upgrade_keeps_original_schema_and_valid_backup(self):
        old, _ = self.schema_five()
        before = old.audit()
        backup = self.root / "schema-five-failed.sqlite3"
        with patch.object(Store, "_event", side_effect=RuntimeError("injected migration failure")):
            with self.assertRaises(RuntimeError):
                Store.migrate(old.state, backup, clock=lambda: self.at)
        self.assertEqual(old.audit(), before)
        self.assertEqual(verify_backup(backup)["audit"], before)
        with closing(sqlite3.connect(old.path)) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='commerce_books'").fetchone()[0], 0)

    def test_schema_six_upgrade_preserves_credentials_and_adds_wallet_login_schema(self):
        with closing(sqlite3.connect(self.legacy.path, autocommit=True)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            for version in range(2, 7):
                ddl = Path(__file__).resolve().parent.parent / "zoora_community" / f"migration_{version:03}.sql"
                for statement in ddl.read_text(encoding="utf-8").split(";"):
                    if statement.strip():
                        connection.execute(statement)
            connection.execute("PRAGMA user_version=6")
            connection.execute("COMMIT")
        old = Store(self.legacy.state, clock=lambda: self.at, _schema_version=6)
        with closing(old._connection()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            checkpoint = connection.execute("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1").fetchone()[0]
            old._event(connection, {"role": "OWNER", "principal_id": "owner"}, "SCHEMA_MIGRATE", "schema",
                       {"from": 1, "to": 6, "backup_audit_head": checkpoint}, self.at)
            connection.execute("COMMIT")
        before = old.audit()
        backup = self.root / "schema-six.sqlite3"
        current = Store.migrate(old.state, backup, clock=lambda: self.at)
        self.assertEqual(verify_backup(backup)["audit"], before)
        with closing(sqlite3.connect(backup)) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 6)
        with closing(current._connection()) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], SCHEMA_VERSION)
            self.assertIsNotNone(connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='wallet_login_challenges'").fetchone())
            self.assertIn("signature", {row["name"] for row in connection.execute(
                "PRAGMA table_info(wallet_login_challenges)")})
            self.assertEqual(connection.execute("PRAGMA table_info(wallet_challenges)").fetchall()[-1]["name"], "audience")
        self.assertEqual(current.call("GET", "/v1/me", token=self.agent)[1]["principal_id"], self.ids["agent_id"])
        self.assertEqual(current.audit()["schema_version"], SCHEMA_VERSION)

    def test_schema_seven_upgrade_is_explicit_preserves_login_and_adds_no_forum_grants(self):
        with closing(sqlite3.connect(self.legacy.path, autocommit=True)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            for version in range(2, 8):
                ddl = Path(__file__).resolve().parent.parent / "zoora_community" / f"migration_{version:03}.sql"
                for statement in ddl.read_text(encoding="utf-8").split(";"):
                    if statement.strip():
                        connection.execute(statement)
            connection.execute("PRAGMA user_version=7")
            connection.execute("COMMIT")
        old = Store(self.legacy.state, clock=lambda: self.at, _schema_version=7)
        with closing(old._connection()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            checkpoint = connection.execute("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1").fetchone()[0]
            old._event(connection, {"role": "OWNER", "principal_id": "owner"}, "SCHEMA_MIGRATE", "schema",
                       {"from": 1, "to": 7, "backup_audit_head": checkpoint}, self.at)
            connection.execute("COMMIT")
        before = old.audit()
        self.refused("UNSUPPORTED_SCHEMA", lambda: Store(old.state, clock=lambda: self.at))
        backup = self.root / "schema-seven.sqlite3"
        current = Store.migrate(old.state, backup, clock=lambda: self.at)
        self.assertEqual(verify_backup(backup)["audit"], before)
        self.assertEqual(current.call("GET", "/v1/me", token=self.agent)[1]["principal_id"], self.ids["agent_id"])
        with closing(current._connection()) as connection:
            for table in ("creator_wallets", "forum_posts", "forum_credentials"):
                self.assertEqual(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0)
        self.assertEqual(current.audit()["schema_version"], SCHEMA_VERSION)

    def test_migration_preserves_records_credentials_audit_and_reproof(self):
        before = self.legacy.audit()
        with closing(sqlite3.connect(self.legacy.path)) as connection:
            saved = {name: connection.execute("SELECT * FROM " + name).fetchall() for name in
                     ("metadata", "operators", "agents", "handles", "credentials", "projects", "members", "posts", "offers", "audit")}
        self.refused("UNSUPPORTED_SCHEMA", lambda: Store(self.legacy.state))
        backup = self.root / "before-upgrade.sqlite3"
        current = Store.migrate(self.legacy.state, backup, clock=lambda: self.at)
        with closing(sqlite3.connect(backup)) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 1)
            for name, rows in saved.items():
                self.assertEqual(connection.execute("SELECT * FROM " + name).fetchall(), rows)
        with closing(sqlite3.connect(current.path)) as connection:
            for name, rows in saved.items():
                actual = connection.execute("SELECT * FROM " + name).fetchall()
                self.assertEqual(actual[:len(rows)], rows)
                if name != "audit":
                    self.assertEqual(len(actual), len(rows))
        self.assertEqual(current.audit()["audit_events"], before["audit_events"] + 1)
        self.assertEqual(current.call("GET", "/v1/me", token=self.agent)[1]["principal_id"], self.ids["agent_id"])
        route = "/v1/agents/" + self.ids["agent_id"]
        self.assertEqual(current.call("GET", route)[1]["wallet_status"], "DECLARED_UNVERIFIED")
        challenge = current.call("POST", route + "/wallet-challenges", {}, self.agent)[1]
        current.call("POST", route + "/wallet-proof", signed_body(challenge, "legacy-fixture"), self.agent)
        self.assertEqual(current.call("GET", route)[1]["wallet_status"], "SIGNATURE_VERIFIED")
        current.audit()

    def test_schema_four_upgrade_preserves_two_pending_tasks_before_owner_sets_limit(self):
        with closing(sqlite3.connect(self.legacy.path, autocommit=True)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            for version in (2, 3, 4):
                ddl = Path(__file__).resolve().parent.parent / "zoora_community" / f"migration_{version:03}.sql"
                for statement in ddl.read_text().split(";"):
                    if statement.strip():
                        connection.execute(statement)
            connection.execute("PRAGMA user_version=4")
            connection.execute("COMMIT")
        old = Store(self.legacy.state, clock=lambda: self.at, _schema_version=4)
        with closing(old._connection()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            principal = old._authenticate(connection, self.agent, self.at)
            jobs = [old._jobs_write(connection, principal, "POST", "/v1/jobs",
                                   {"request_id": letter * 32, "title": "Schema four task", "prompt": "Preserved"}, self.at)[1]["job"]
                    for letter in ("a", "b")]
            connection.execute("COMMIT")
        before = old.audit()
        backup = self.root / "schema-four.sqlite3"
        current = Store.migrate(old.state, backup, clock=lambda: self.at)
        self.assertEqual(verify_backup(backup)["audit"], before)
        view = current.call("GET", "/v1/task-capacity", token=self.agent)[1]
        self.assertIsNone(view["max_pending"])
        self.assertEqual(view["pending"], 2)
        owner = json.loads(self.files["owner"].read_text())["token"]
        route = "/v1/operators/" + view["operator_id"] + "/task-capacity"
        limited = current.call("PATCH", route, {"expected_revision": 0, "max_pending": 1, "reason": "Reviewed"}, owner)[1]
        self.assertTrue(limited["capacity"]["over_limit"])
        self.refused("OPERATOR_TASK_LIMIT", lambda: current.call("POST", "/v1/jobs",
                     {"request_id": "c" * 32, "title": "New", "prompt": "Blocked"}, self.agent))
        for job in jobs:
            self.assertEqual(current.call("GET", "/v1/jobs/" + job["id"], token=self.agent)[1]["state"], "QUEUED")
        current.audit()

    def test_migration_failure_rolls_back_ddl_and_keeps_valid_backup(self):
        before = self.legacy.audit()
        backup = self.root / "before.sqlite3"
        with patch.object(Store, "_event", side_effect=RuntimeError("injected failure")):
            with self.assertRaises(RuntimeError):
                Store.migrate(self.legacy.state, backup, clock=lambda: self.at)
        self.assertEqual(self.legacy.audit(), before)
        self.assertTrue(backup.exists())
        with closing(sqlite3.connect(self.legacy.path)) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='wallet_proofs'").fetchone()[0], 0)
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 1)

    def test_existing_backup_is_never_replaced_and_repeat_migration_is_refused(self):
        backup = self.root / "existing.sqlite3"
        backup.write_bytes(b"preserve")
        with self.assertRaises(FileExistsError):
            Store.migrate(self.legacy.state, backup)
        self.assertEqual(backup.read_bytes(), b"preserve")
        Store.migrate(self.legacy.state, self.root / "new.sqlite3", clock=lambda: self.at)
        self.refused("UNSUPPORTED_SCHEMA", lambda: Store.migrate(self.legacy.state, self.root / "second.sqlite3"))
        self.assertFalse(self.root.joinpath("second.sqlite3").exists())

    def test_intervening_write_aborts_instead_of_migrating_unbacked_state(self):
        backup_impl = Store.backup

        def concurrent_change(store, destination):
            backup_impl(store, destination)
            with closing(store._connection()) as connection:
                connection.execute("BEGIN IMMEDIATE")
                store._event(connection, {"role": "OWNER", "principal_id": "owner"}, "TEST_INTERVENING_WRITE", "test", {}, self.at)
                connection.execute("COMMIT")

        with patch.object(Store, "backup", concurrent_change):
            self.refused("STATE_CHANGED_DURING_MIGRATION", lambda: Store.migrate(self.legacy.state, self.root / "snapshot.sqlite3", clock=lambda: self.at))
        self.assertEqual(self.legacy.audit()["schema_version"], 1)

    def test_schema_two_upgrade_and_legacy_backup_restore_require_explicit_migration(self):
        ddl = Path(__file__).resolve().parent.parent / "zoora_community" / "migration_002.sql"
        with closing(sqlite3.connect(self.legacy.path, autocommit=True)) as connection:
            connection.executescript("BEGIN IMMEDIATE;\n" + ddl.read_text())
            connection.execute("PRAGMA user_version=2")
            connection.execute("COMMIT")
        old = Store(self.legacy.state, clock=lambda: self.at, _schema_version=2)
        before = old.audit()
        backup = self.root / "schema-two.sqlite3"
        current = Store.migrate(old.state, backup, clock=lambda: self.at)
        self.assertEqual(current.schema_version, SCHEMA_VERSION)
        self.assertEqual(current.audit()["audit_events"], before["audit_events"] + 1)
        self.assertEqual(verify_backup(backup)["audit"], before)
        restored = self.root / "restored-two"
        result = restore_backup(backup, restored)
        self.assertTrue(result["next_action"].startswith("MIGRATE_THEN_"))
        self.refused("UNSUPPORTED_SCHEMA", lambda: Store(restored))
        migrated = Store.migrate(restored, self.root / "second-snapshot.sqlite3", clock=lambda: self.at)
        self.assertEqual(migrated.audit()["schema_version"], SCHEMA_VERSION)
        self.assertEqual(migrated.call("GET", "/v1/me", token=self.agent)[1]["principal_id"], self.ids["agent_id"])

    def test_schema_three_upgrade_preserves_queued_job_and_original_credential(self):
        with closing(sqlite3.connect(self.legacy.path, autocommit=True)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            for version in (2, 3):
                ddl = Path(__file__).resolve().parent.parent / "zoora_community" / f"migration_{version:03}.sql"
                for statement in ddl.read_text().split(";"):
                    if statement.strip():
                        connection.execute(statement)
            connection.execute("PRAGMA user_version=3")
            connection.execute("COMMIT")
        old = Store(self.legacy.state, clock=lambda: self.at, _schema_version=3)
        with closing(old._connection()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            principal = old._authenticate(connection, self.agent, self.at)
            job = old._jobs_write(connection, principal, "POST", "/v1/jobs",
                                  {"request_id": "a" * 32, "title": "Legacy queued task", "prompt": "Preserved private task"}, self.at)[1]["job"]
            connection.execute("COMMIT")
        before = old.audit()
        backup = self.root / "schema-three.sqlite3"
        current = Store.migrate(old.state, backup, clock=lambda: self.at)
        self.assertEqual(verify_backup(backup)["audit"], before)
        self.assertEqual(current.call("GET", "/v1/jobs/" + job["id"], token=self.agent)[1]["state"], "QUEUED")
        self.assertEqual(current.call("POST", "/v1/jobs/claim", {"max_steps": 4, "timeout_seconds": 60}, self.agent)[1]["job"]["id"], job["id"])
        current.audit()
