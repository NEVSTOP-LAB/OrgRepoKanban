/**
 * GitHub Actions secrets encryption utility.
 *
 * GitHub encrypts secret values with libsodium sealed boxes before they
 * are sent to the API.  This module provides the pure encryption helper.
 */
import _sodium from 'libsodium-wrappers'

// ── Encryption ──────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext secret value using a repository's (or org's) public
 * key.  Mirrors the algorithm documented at:
 * https://docs.github.com/en/rest/actions/secrets#create-or-update-a-repository-secret
 *
 * Returns the base64-encoded encrypted value ready for the PUT body.
 */
export async function encryptSecret(
  plaintext: string,
  publicKeyBase64: string,
): Promise<string> {
  await _sodium.ready

  const publicKeyBytes = _sodium.from_base64(publicKeyBase64, _sodium.base64_variants.ORIGINAL)
  const messageBytes = _sodium.from_string(plaintext)

  const encryptedBytes = _sodium.crypto_box_seal(messageBytes, publicKeyBytes)

  return _sodium.to_base64(encryptedBytes, _sodium.base64_variants.ORIGINAL)
}

// ── Batch execution types & helpers ─────────────────────────────────────────

export interface SecretOpResult {
  repoName: string
  secretName: string
  action: 'set' | 'delete'
  success: boolean
  error?: string
}
