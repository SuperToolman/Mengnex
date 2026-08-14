mod core;
mod infra;
mod modules;

use std::{env, net::SocketAddr};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "api=info,tower_http=info".into()),
        )
        .init();
    let db = infra::database::connect().await?;
    modules::tasks::service::recover_interrupted_tasks(&db)
        .await
        .map_err(|error| format!("failed to recover background tasks: {error:?}"))?;
    let removed_transient_files = modules::sources::cleanup_transient_media_files()
        .await
        .map_err(|error| format!("failed to clean WebDAV transient files: {error:?}"))?;
    if removed_transient_files > 0 {
        tracing::info!(
            removed_transient_files,
            "cleaned stale WebDAV transient files"
        );
    }
    let app = core::app::router(db);
    let port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(3001);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;

    tracing::info!(%addr, "API listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}
