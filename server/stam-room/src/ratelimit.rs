/// A token bucket: `capacity` tokens, refilled at `per_second`.
#[derive(Clone, Debug)]
pub struct Bucket {
    tokens: f64,
    at_ms: f64,
}

pub const OPS_PER_SECOND: f64 = 30.0;
pub const OPS_BURST: f64 = 60.0;

impl Bucket {
    pub fn new(now_ms: f64) -> Self {
        Self {
            tokens: OPS_BURST,
            at_ms: now_ms,
        }
    }

    /// Takes a token if there is one.
    pub fn take(&mut self, now_ms: f64) -> bool {
        let elapsed = (now_ms - self.at_ms).max(0.0) / 1000.0;
        self.tokens = (self.tokens + elapsed * OPS_PER_SECOND).min(OPS_BURST);
        self.at_ms = now_ms;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}
