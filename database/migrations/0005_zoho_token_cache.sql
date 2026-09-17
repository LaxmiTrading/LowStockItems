-- ============================================================================
-- 0005 — Share the Zoho access token across invocations
--
-- The access token was kept only in module memory, on the reasoning that it is
-- short-lived and re-obtainable, so writing it down added a secret at rest to
-- save one HTTP call per cold start.
--
-- It saved far less than that. `netlify dev` loads every function invocation
-- into a fresh worker, so memory never survived a single request, and each
-- Zoho call minted a new token. In production every cold start and every
-- parallel instance does the same on a smaller scale. Zoho allows only a
-- handful of token requests per refresh token in a window, then answers
-- "Access Denied — too many requests" and locks the whole app out of Books for
-- minutes. One page of low-stock items was enough to trip it.
--
-- One row, read by every invocation. The token is encrypted with the same key
-- as the refresh token, so a database dump on its own yields nothing usable,
-- and it is valid for under an hour regardless.
-- ============================================================================

CREATE TABLE IF NOT EXISTS zoho_token_cache (
  id                     SMALLINT    PRIMARY KEY DEFAULT 1,

  -- sha256 of the client id and refresh token that minted this token. A
  -- replaced or rotated credential never reads a token issued to the old one.
  credential_fingerprint TEXT,

  -- AES-256-GCM, via netlify/shared/crypto.mjs.
  access_token_encrypted TEXT,

  -- sha256 of the plaintext token, so a request that got a 401 can clear this
  -- row only if it still holds the token that failed — not a newer one another
  -- request has already put here.
  access_token_hash      TEXT,

  api_domain             TEXT,

  -- Already includes the safety margin, so "expires_at > now" means usable.
  expires_at             TIMESTAMPTZ,

  -- Held by the one invocation refreshing the token; the rest wait for its
  -- result instead of each asking Zoho. Expires by itself, so a caller that
  -- dies mid-refresh cannot wedge everyone.
  refresh_lease_until    TIMESTAMPTZ,

  -- Set when Zoho throttles. Until it passes nobody asks again — every extra
  -- request during a block only lengthens it.
  throttled_until        TIMESTAMPTZ,

  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT zoho_token_cache_single_row CHECK (id = 1)
);

INSERT INTO zoho_token_cache (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE zoho_token_cache IS
  'The current Zoho access token, encrypted, shared by every function invocation so each request does not mint its own and trip Zoho''s token rate limit.';
