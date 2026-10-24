//! The parts of `src/core/dates/fuzzy.ts` the commands use.

use std::cmp::Ordering;

use crate::model::FuzzyDate;

/// A date without a year cannot be ordered, so it counts as no date.
pub fn dated_year(date: Option<&FuzzyDate>) -> Option<&FuzzyDate> {
    date.filter(|d| d.year.is_some())
}

fn sort_key(d: &FuzzyDate) -> [i64; 3] {
    [
        d.year.unwrap_or(0),
        d.month.unwrap_or(0),
        d.day.unwrap_or(0),
    ]
}

/// TS `compareFuzzyDate`: a missing date sorts first only against another missing one.
pub fn compare_fuzzy_date(a: Option<&FuzzyDate>, b: Option<&FuzzyDate>) -> Ordering {
    match (a, b) {
        (Some(a), Some(b)) => sort_key(a).cmp(&sort_key(b)),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

pub fn same_fuzzy_date(a: Option<&FuzzyDate>, b: Option<&FuzzyDate>) -> bool {
    a == b
}

/// JS `String.prototype.trim`: JS whitespace and line terminators, which differ from Rust's
/// `char::is_whitespace` (JS trims U+FEFF, Rust trims U+0085).
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| {
        matches!(
            c,
            '\u{9}'
                | '\u{A}'
                | '\u{B}'
                | '\u{C}'
                | '\u{D}'
                | ' '
                | '\u{A0}'
                | '\u{1680}'
                | '\u{2000}'
                ..='\u{200A}'
                    | '\u{2028}'
                    | '\u{2029}'
                    | '\u{202F}'
                    | '\u{205F}'
                    | '\u{3000}'
                    | '\u{FEFF}'
        )
    })
}
