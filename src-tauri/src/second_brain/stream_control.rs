//! Shared cancellation state for message and Pulse streaming flows.
//!
//! The state is intentionally small and process-local. We keep separate buckets for
//! session/request ids and message/output ids because the frontend can cancel either
//! a whole generation or a single streamed output.

use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
};

static SB_STREAM_CANCEL_BY_SESSION: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static SB_STREAM_CANCEL_BY_MESSAGE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn canceled_sessions_slot() -> &'static Mutex<HashSet<String>> {
    SB_STREAM_CANCEL_BY_SESSION.get_or_init(|| Mutex::new(HashSet::new()))
}

fn canceled_messages_slot() -> &'static Mutex<HashSet<String>> {
    SB_STREAM_CANCEL_BY_MESSAGE.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Records a cancellation request for the next stream tick.
pub(super) fn request_stream_cancel(session_id: &str, message_id: Option<&str>) {
    if let Some(id) = message_id {
        if !id.trim().is_empty() {
            if let Ok(mut canceled_messages) = canceled_messages_slot().lock() {
                canceled_messages.insert(id.to_string());
            }
            return;
        }
    }
    if let Ok(mut canceled_sessions) = canceled_sessions_slot().lock() {
        canceled_sessions.insert(session_id.to_string());
    }
}

/// Consumes one pending cancellation signal for a given stream tick.
pub(super) fn consume_stream_cancel(session_id: &str, message_id: &str) -> bool {
    if let Ok(mut canceled_messages) = canceled_messages_slot().lock() {
        if canceled_messages.remove(message_id) {
            return true;
        }
    }
    if let Ok(mut canceled_sessions) = canceled_sessions_slot().lock() {
        if canceled_sessions.remove(session_id) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_cancel_is_consumed_once() {
        request_stream_cancel("session-a", Some("message-a"));
        assert!(consume_stream_cancel("session-a", "message-a"));
        assert!(!consume_stream_cancel("session-a", "message-a"));
    }

    #[test]
    fn session_cancel_is_consumed_once() {
        request_stream_cancel("session-b", None);
        assert!(consume_stream_cancel("session-b", "message-b"));
        assert!(!consume_stream_cancel("session-b", "message-b"));
    }

    #[test]
    fn message_cancel_has_priority_over_session_cancel() {
        request_stream_cancel("session-c", None);
        request_stream_cancel("session-c", Some("message-c"));
        assert!(consume_stream_cancel("session-c", "message-c"));
        assert!(consume_stream_cancel("session-c", "different-message"));
    }
}
