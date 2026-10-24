//! Port of `src/core/commands/opIds.ts`: the ids an op creates are its op id plus a counter.

use crate::error::{CommandError, ErrorCode, err};

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const MAX_IDS: usize = 64 * 64;

pub fn is_op_id(value: &str) -> bool {
    value.len() == 10
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Returns the id generator for `op_id`, or INVALID when it is not an op id.
pub fn op_id_source(
    op_id: &str,
) -> Result<impl FnMut() -> Result<String, CommandError> + use<>, CommandError> {
    if !is_op_id(op_id) {
        return err(ErrorCode::Invalid);
    }
    let op_id = op_id.to_owned();
    let mut n = 0usize;
    Ok(move || {
        if n >= MAX_IDS {
            return err(ErrorCode::Invalid);
        }
        let id = format!(
            "{op_id}{}{}",
            ALPHABET[n >> 6] as char,
            ALPHABET[n & 63] as char
        );
        n += 1;
        Ok(id)
    })
}
