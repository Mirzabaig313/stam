//! Tokens, hashes, signed cookies, PKCE and link-token encryption.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).expect("randomness");
    bytes
}

/// 32 random bytes, base64url: session and link tokens, OAuth state, ids.
pub fn random_token() -> String {
    URL_SAFE_NO_PAD.encode(random_bytes::<32>())
}

/// A short random id (16 bytes, base64url) for users and links.
pub fn random_id() -> String {
    URL_SAFE_NO_PAD.encode(random_bytes::<16>())
}

/// What the database keeps instead of a token.
pub fn sha256_b64(value: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(value.as_bytes()))
}

fn mac(value: &str, secret: &str) -> Hmac<Sha256> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("any key length");
    mac.update(value.as_bytes());
    mac
}

/// `value.signature`, HMAC-SHA256 with `secret`.
pub fn sign(value: &str, secret: &str) -> String {
    let signature = URL_SAFE_NO_PAD.encode(mac(value, secret).finalize().into_bytes());
    format!("{value}.{signature}")
}

/// The value of a `sign`ed string, if the signature matches (constant-time).
pub fn verify(signed: &str, secret: &str) -> Option<String> {
    let (value, signature) = signed.rsplit_once('.')?;
    let signature = URL_SAFE_NO_PAD.decode(signature).ok()?;
    mac(value, secret).verify_slice(&signature).ok()?;
    Some(value.to_owned())
}

/// A PKCE verifier and its S256 challenge.
pub fn pkce_pair() -> (String, String) {
    let verifier = random_token();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

fn cipher(key_b64: &str) -> Option<Aes256Gcm> {
    let key = STANDARD.decode(key_b64).ok()?;
    Aes256Gcm::new_from_slice(&key).ok()
}

/// AES-256-GCM with a random 12-byte nonce in front, base64url. `key_b64` is 32 bytes, base64.
pub fn encrypt(plain: &str, key_b64: &str) -> Option<String> {
    let nonce = random_bytes::<12>();
    let sealed = cipher(key_b64)?
        .encrypt(&Nonce::from(nonce), plain.as_bytes())
        .ok()?;
    Some(URL_SAFE_NO_PAD.encode([nonce.as_slice(), &sealed].concat()))
}

pub fn decrypt(sealed: &str, key_b64: &str) -> Option<String> {
    let bytes = URL_SAFE_NO_PAD.decode(sealed).ok()?;
    let (nonce, body) = bytes.split_at_checked(12)?;
    let nonce: [u8; 12] = nonce.try_into().ok()?;
    let plain = cipher(key_b64)?.decrypt(&Nonce::from(nonce), body).ok()?;
    String::from_utf8(plain).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "c3RhbS10ZXN0LWxpbmsta2V5LTMyLWJ5dGVzLWxvbmc=";

    #[test]
    fn tokens_are_random_and_url_safe() {
        let (a, b) = (random_token(), random_token());
        assert_ne!(a, b);
        assert_eq!(a.len(), 43);
        assert!(
            a.bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        );
    }

    #[test]
    fn signatures_verify_and_tampering_fails() {
        let signed = sign("payload", "secret");
        assert_eq!(verify(&signed, "secret").as_deref(), Some("payload"));
        assert_eq!(verify(&signed, "other"), None);
        assert_eq!(
            verify(&signed.replace("payload", "paylaod"), "secret"),
            None
        );
        assert_eq!(verify("nodot", "secret"), None);
    }

    #[test]
    fn pkce_challenge_is_the_s256_of_the_verifier() {
        let (verifier, challenge) = pkce_pair();
        assert_eq!(challenge, sha256_b64(&verifier));
    }

    #[test]
    fn encryption_round_trips_and_detects_tampering() {
        let sealed = encrypt("link-token", KEY).unwrap();
        assert_ne!(sealed, encrypt("link-token", KEY).unwrap(), "random nonce");
        assert_eq!(decrypt(&sealed, KEY).as_deref(), Some("link-token"));
        let mut bytes = URL_SAFE_NO_PAD.decode(&sealed).unwrap();
        *bytes.last_mut().unwrap() ^= 1;
        assert_eq!(decrypt(&URL_SAFE_NO_PAD.encode(bytes), KEY), None);
        assert_eq!(decrypt("short", KEY), None);
    }
}
