use chrono::Local;

fn timestamp() -> String {
    Local::now().format("%Y-%m-%dT%H:%M:%S%.3f%:z").to_string()
}

pub fn stderr(message: impl AsRef<str>) {
    eprintln!("[{}] {}", timestamp(), message.as_ref());
}
