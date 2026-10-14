/**
 * The signing key behind session tokens and every emailed one-time code.
 *
 * Resolved lazily, per call, rather than at module scope: `next build` runs with
 * NODE_ENV=production and no secrets, so a module-scope throw would fail the
 * Docker image build rather than the deployment it is meant to guard.
 */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    // Falling back here would sign every session cookie with a value that is
    // sitting in the public source tree — anyone could mint a token for any
    // account. Refuse to run instead.
    throw new Error('Missing required environment variable: "JWT_SECRET"');
  }

  return "fallback_secret_for_local_dev_123456789";
}
