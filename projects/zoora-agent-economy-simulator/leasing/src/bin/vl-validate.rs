use std::io::{self, Read, Write};
use zoora_virtual_leasing_schema::{
    validation::{Registry, Status, MAX_INPUT_BYTES},
    UtcMillis,
};

fn main() {
    let code = run().unwrap_or_else(|message| {
        eprintln!("{message}");
        2
    });
    std::process::exit(code);
}
fn run() -> Result<i32, &'static str> {
    let args: Vec<_> = std::env::args().skip(1).take(4).collect();
    let registry =
        Registry::synthetic_fixture_v1().map_err(|_| "compiled synthetic fixture is invalid")?;
    if args == ["fixture"] {
        io::stdout()
            .write_all(registry.fixture_json())
            .map_err(|_| "output unavailable")?;
        return Ok(0);
    }
    if args.len() != 2 || args[0] != "validate" {
        return Err("usage: vl-validate fixture | vl-validate validate <UTC-ms> (JSON on stdin)");
    }
    if args[1].is_empty() || !args[1].bytes().all(|b| b.is_ascii_digit()) {
        return Err("invalid UTC decision time");
    }
    let at = UtcMillis::new(args[1].parse().map_err(|_| "invalid UTC decision time")?)
        .map_err(|_| "invalid UTC decision time")?;
    let mut bytes = Vec::new();
    io::stdin()
        .take((MAX_INPUT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "input unavailable")?;
    let decision = registry.evaluate(&bytes, at);
    serde_json::to_writer(io::stdout(), &decision).map_err(|_| "output unavailable")?;
    println!();
    Ok(if decision.status() == Status::ValidDraft {
        0
    } else {
        1
    })
}
