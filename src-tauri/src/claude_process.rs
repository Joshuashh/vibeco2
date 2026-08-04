use portable_pty::{native_pty_system, MasterPty, PtySize};

pub fn open_pty() -> Result<Box<dyn MasterPty + Send>, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open pty: {e}"))?;
    disable_echo(&*pair.master)?;
    Ok(pair.master)
}

/// termios ECHO must be cleared on the pty (settable via either end's fd —
/// we use the master's, since portable-pty's SlavePty trait doesn't expose
/// one) or writes to stdin echo back into the stream we're parsing as JSON
/// (see Claude Code GUI decisions.md: "PTY echo disabled").
fn disable_echo(master: &dyn MasterPty) -> Result<(), String> {
    #[cfg(unix)]
    {
        if let Some(fd) = master.as_raw_fd() {
            unsafe {
                let mut term: libc::termios = std::mem::zeroed();
                if libc::tcgetattr(fd, &mut term) != 0 {
                    return Err("tcgetattr failed".into());
                }
                term.c_lflag &= !libc::ECHO;
                if libc::tcsetattr(fd, libc::TCSANOW, &term) != 0 {
                    return Err("tcsetattr failed".into());
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_pty_succeeds() {
        let result = open_pty();
        assert!(result.is_ok(), "expected PTY to open: {:?}", result.err());
    }
}
