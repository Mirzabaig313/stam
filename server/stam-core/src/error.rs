use serde::Serialize;

/// The TS `CommandErrorCode`s, serialised the same way.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    NotFound,
    Cycle,
    AmbiguousUnion,
    ParentsFull,
    AlreadyLinked,
    Invalid,
    Conflict,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CommandError {
    pub code: ErrorCode,
    /// For CONFLICT: the entity that changed, e.g. `persons/<id>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
}

impl CommandError {
    pub fn new(code: ErrorCode) -> Self {
        Self { code, key: None }
    }
}

pub fn err<T>(code: ErrorCode) -> Result<T, CommandError> {
    Err(CommandError::new(code))
}
