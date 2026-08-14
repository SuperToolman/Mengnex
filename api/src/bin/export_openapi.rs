#![allow(dead_code)]

#[path = "../core/mod.rs"]
mod core;
#[path = "../infra/mod.rs"]
mod infra;
#[path = "../modules/mod.rs"]
mod modules;

use std::{env, fs, path::Path};
use utoipa::OpenApi;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output = env::args().nth(1).ok_or("output path is required")?;
    let output_path = Path::new(&output);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(
        output_path,
        serde_json::to_string_pretty(&core::openapi::ApiDoc::openapi())?,
    )?;
    println!("OpenAPI schema written to {}", output_path.display());
    Ok(())
}
