//! Manual end-to-end check of the streaming engine with a real torrent:
//!   cargo run -p anime-tv-core --example stream_check -- '<magnet or .torrent URL>' [download dir]
//! Opens the torrent, waits for the first megabytes, then reads the start and
//! the middle of the file through the local HTTP server (like a player
//! starting and then seeking). Use only torrents you are allowed to download.

use std::time::{Duration, Instant};

use anime_tv_core::torrent::{Engine, EngineOptions};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let source = args.next().expect("usage: stream_check <magnet|url> [dir]");
    let dir = args.next().unwrap_or_else(|| std::env::temp_dir().join("anime-tv-check").display().to_string());

    let t0 = Instant::now();
    let engine = Engine::start(dir.into(), EngineOptions { up_kib: Some(64), ..Default::default() }).await?;
    let o = engine.open(&source, None, None).await?;
    println!("[{:>5.1}s] opened: {} ({} MiB) -> {}", t0.elapsed().as_secs_f32(), o.file_name, o.file_len >> 20, o.url);

    loop {
        let s = engine.status(o.id, o.file_idx)?;
        println!(
            "[{:>5.1}s] {} {:.1}/{} MiB, {:.0} KiB/s, {} peers",
            t0.elapsed().as_secs_f32(),
            s.state,
            s.file_downloaded as f64 / 1048576.0,
            s.file_len >> 20,
            s.down_bps / 1024.0,
            s.peers
        );
        if s.file_downloaded >= 4 << 20 || s.file_downloaded >= s.file_len {
            break;
        }
        anyhow::ensure!(t0.elapsed() < Duration::from_secs(240), "too slow: no data after 4 minutes");
        tokio::time::sleep(Duration::from_secs(3)).await;
    }

    let http = reqwest::Client::new();
    let head = http.get(&o.url).header("Range", "bytes=0-65535").send().await?;
    println!("start:  HTTP {} {:?}", head.status(), head.headers().get("content-range"));
    let b = head.bytes().await?;
    println!("        {} bytes, magic {:02x?}", b.len(), &b[..8.min(b.len())]);

    let mid = o.file_len / 2;
    let t1 = Instant::now();
    let r = http.get(&o.url).header("Range", format!("bytes={mid}-{}", mid + 262143)).send().await?;
    println!("seek:   HTTP {} {:?}", r.status(), r.headers().get("content-range"));
    let b = r.bytes().await?;
    println!("        {} bytes from the middle in {:.1}s (fetched on demand)", b.len(), t1.elapsed().as_secs_f32());

    let bad = http.get(o.url.replace("/s/", "/s/x")).send().await?;
    println!("wrong token: HTTP {}", bad.status());

    engine.close(o.id, true).await?;
    println!("closed and deleted");
    Ok(())
}
