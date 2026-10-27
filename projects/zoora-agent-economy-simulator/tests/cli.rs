use std::{
    fs,
    path::PathBuf,
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
};
use zoora_agent_economy_simulator::RunReport;
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Workspace(PathBuf);
impl Workspace {
    fn new() -> Self {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "zoora-test-{}-{stamp}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        fs::write(
            path.join("config.toml"),
            "agent_count=3\nstarting_balance=10\nticks=20\nseed=42\n",
        )
        .unwrap();
        Self(path)
    }
    fn run(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_zoora-agent-economy-simulator"))
            .current_dir(&self.0)
            .args(args)
            .output()
            .unwrap()
    }
}
impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn success(output: Output) {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
#[test]
fn cli_runs_replays_and_refuses_overwrite() {
    let dir = Workspace::new();
    success(dir.run(&["run", "--config", "config.toml", "--output", "run.json"]));
    let original = fs::read(dir.0.join("run.json")).unwrap();
    let report: RunReport = serde_json::from_slice(&original).unwrap();
    report.verify().unwrap();
    success(dir.run(&["replay", "--input", "run.json"]));
    assert!(!dir
        .run(&["run", "--config", "config.toml", "--output", "run.json"])
        .status
        .success());
    assert_eq!(fs::read(dir.0.join("run.json")).unwrap(), original);
    success(dir.run(&["run", "--config", "config.toml", "--output", "second.json"]));
    assert_eq!(fs::read(dir.0.join("second.json")).unwrap(), original);
}
#[test]
fn cli_rejects_invalid_options_and_config_without_output() {
    let dir = Workspace::new();
    for args in [
        vec!["run", "--config", "config.toml"],
        vec!["run", "--config", "config.toml", "--output"],
        vec![
            "run",
            "--config",
            "config.toml",
            "--output",
            "new.json",
            "--config",
            "config.toml",
        ],
        vec![
            "run",
            "--config",
            "config.toml",
            "--output",
            "new.json",
            "--unknown",
            "value",
        ],
        vec!["unknown"],
    ] {
        assert!(!dir.run(&args).status.success());
    }
    fs::write(
        dir.0.join("config.toml"),
        "agent_count=1\nstarting_balance=-1\nticks=0\nseed=42\n",
    )
    .unwrap();
    assert!(!dir
        .run(&["run", "--config", "config.toml", "--output", "new.json"])
        .status
        .success());
    assert!(!dir.0.join("new.json").exists());
}
#[test]
fn cli_rejects_tampered_reports_and_invalid_utf8() {
    let dir = Workspace::new();
    success(dir.run(&["run", "--config", "config.toml", "--output", "run.json"]));
    let mut report: serde_json::Value =
        serde_json::from_slice(&fs::read(dir.0.join("run.json")).unwrap()).unwrap();
    report["metrics"]["transfers_completed"] = 500.into();
    fs::write(
        dir.0.join("tampered.json"),
        serde_json::to_vec(&report).unwrap(),
    )
    .unwrap();
    assert!(!dir
        .run(&["replay", "--input", "tampered.json"])
        .status
        .success());
    fs::write(dir.0.join("invalid.toml"), [0xff, 0xfe]).unwrap();
    assert!(!dir
        .run(&["run", "--config", "invalid.toml", "--output", "new.json"])
        .status
        .success());
}
#[test]
fn cli_bounds_input_size_before_parsing() {
    let dir = Workspace::new();
    fs::File::create(dir.0.join("oversize.toml"))
        .unwrap()
        .set_len(1024 * 1024 + 1)
        .unwrap();
    let output = dir.run(&["run", "--config", "oversize.toml", "--output", "new.json"]);
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("size limit"));
    fs::File::create(dir.0.join("oversize.json"))
        .unwrap()
        .set_len(64 * 1024 * 1024 + 1)
        .unwrap();
    assert!(!dir
        .run(&["replay", "--input", "oversize.json"])
        .status
        .success());
}
#[test]
fn cli_measures_scaling_with_conservation_and_replay_evidence() {
    let dir = Workspace::new();
    success(dir.run(&["benchmark", "--output", "scaling.json"]));
    let report: serde_json::Value =
        serde_json::from_slice(&fs::read(dir.0.join("scaling.json")).unwrap()).unwrap();
    let cases = report["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 3);
    for case in cases {
        assert_eq!(case["conservation_passed"], true);
        assert_eq!(case["replay_verified"], true);
        assert!(case["elapsed_microseconds"]
            .as_str()
            .unwrap()
            .parse::<u128>()
            .is_ok());
        assert_eq!(case["ticks"], 10_000);
    }
}
#[test]
fn cli_help_explains_synthetic_scope() {
    let dir = Workspace::new();
    let output = dir.run(&["--help"]);
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("SYNTHETIC"));
}
#[cfg(unix)]
#[test]
fn cli_refuses_symlinks_and_creates_private_output_permissions() {
    use std::os::unix::{fs::symlink, fs::PermissionsExt};
    let dir = Workspace::new();
    symlink("config.toml", dir.0.join("linked.toml")).unwrap();
    assert!(!dir
        .run(&["run", "--config", "linked.toml", "--output", "new.json"])
        .status
        .success());
    symlink("config.toml", dir.0.join("existing.json")).unwrap();
    assert!(!dir
        .run(&[
            "run",
            "--config",
            "config.toml",
            "--output",
            "existing.json"
        ])
        .status
        .success());
    success(dir.run(&["run", "--config", "config.toml", "--output", "private.json"]));
    assert_eq!(
        fs::metadata(dir.0.join("private.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
}
