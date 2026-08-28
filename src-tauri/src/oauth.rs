//! Loopback catcher for the GitHub OAuth redirect.
//!
//! A desktop app can't receive an OAuth redirect on a hosted URL, so GitHub
//! sign-in points Supabase's `redirectTo` at `http://localhost:<port>` and we
//! listen there for the single request the browser makes once the user has
//! authorised. We pull the `?code=` out of that request line, hand it back to
//! the frontend (which exchanges it for a Supabase session), and reply with a
//! tiny page telling the user to switch back to the app.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

const DONE_HTML: &str = "<!doctype html><meta charset=utf-8><title>Signed in</title>\
<body style=\"font:16px system-ui;margin:4rem auto;max-width:24rem;text-align:center\">\
<p>You're signed in. Close this tab and return to Vibeco.</p>";

// Give up rather than leak a listener thread if the user abandons sign-in.
const TIMEOUT: Duration = Duration::from_secs(180);

/// Pull the `code` query param out of an HTTP request line like
/// `GET /?code=abc123&state=xyz HTTP/1.1`. An OAuth `error` param (the user
/// declined, config is wrong) comes back as `Err` with its description.
fn parse_redirect(request_line: &str) -> Result<String, String> {
    let path = request_line
        .split_whitespace()
        .nth(1)
        .ok_or("malformed redirect request")?;
    let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");

    let mut code: Option<String> = None;
    let mut err: Option<String> = None;
    for pair in query.split('&') {
        match pair.split_once('=') {
            Some(("code", v)) => code = Some(urldecode(v)),
            Some(("error_description", v)) => err = Some(urldecode(v)),
            Some(("error", v)) if err.is_none() => err = Some(urldecode(v)),
            _ => {}
        }
    }

    if let Some(c) = code {
        return Ok(c);
    }
    Err(err.unwrap_or_else(|| "GitHub redirect carried no authorization code".to_string()))
}

fn urldecode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => match u8::from_str_radix(&s[i + 1..i + 3], 16) {
                Ok(b) => {
                    out.push(b);
                    i += 3;
                }
                Err(_) => {
                    out.push(b'%');
                    i += 1;
                }
            },
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Block until the GitHub OAuth redirect hits `127.0.0.1:<port>` and return
/// its `code`. A plain sync `#[tauri::command]` would run this on the main
/// thread and beachball the UI for the whole wait — so it's `async` + a
/// dedicated blocking thread, the pattern used by `summarize_diff` et al.
#[tauri::command]
pub async fn oauth_listen(port: u16) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || listen_blocking(port))
        .await
        .map_err(|e| e.to_string())?
}

fn listen_blocking(port: u16) -> Result<String, String> {
    let listener = TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("couldn't listen on port {port} for the sign-in redirect: {e}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| e.to_string())?;

    let deadline = Instant::now() + TIMEOUT;
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
                let text = String::from_utf8_lossy(&buf[..n]);
                let result = parse_redirect(text.lines().next().unwrap_or(""));
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                    DONE_HTML.len(),
                    DONE_HTML,
                );
                return result;
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("timed out waiting for GitHub sign-in".to_string());
                }
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_code() {
        assert_eq!(
            parse_redirect("GET /?code=abc123&state=xyz HTTP/1.1").unwrap(),
            "abc123",
        );
    }

    #[test]
    fn url_decodes_the_code() {
        assert_eq!(
            parse_redirect("GET /?code=a%2Fb%2Bc HTTP/1.1").unwrap(),
            "a/b+c",
        );
    }

    #[test]
    fn surfaces_oauth_error_description() {
        let err = parse_redirect(
            "GET /?error=access_denied&error_description=User%20declined HTTP/1.1",
        )
        .unwrap_err();
        assert!(err.contains("declined"), "got: {err}");
    }

    #[test]
    fn missing_code_is_an_error() {
        assert!(parse_redirect("GET / HTTP/1.1").is_err());
    }
}
