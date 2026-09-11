-- ============================================================================
-- 0003 — Make the login limit real, and make attempts visible
--
-- The rate limiter this replaces was a Map in module scope. On Netlify that is
-- per warm instance, and a burst of logins is spread across instances that do
-- not share memory, so in practice the counter was almost always at 1 and the
-- limit never fired. Twelve wrong passwords in a row from one address were all
-- answered 401, none 429. A counter that lives in the database is shared by
-- every instance, which is the only place this can be counted honestly.
--
-- The same table doubles as the audit trail. Without it there is no way to
-- answer the question that matters after a failed sign-in appears from an
-- unexpected country: did they get in, how many times did they try, and is it
-- still happening.
-- ============================================================================

CREATE TABLE IF NOT EXISTS login_attempts (
  id         BIGSERIAL   PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- As submitted, lowercased. Deliberately not a foreign key to profiles: an
  -- attempt against an address that has no account is exactly the event worth
  -- recording, and it must survive the account being deleted.
  email      TEXT,

  ip         TEXT,
  country    TEXT,
  city       TEXT,
  user_agent TEXT,

  -- success | bad_password | no_account | disabled | not_activated | blocked
  outcome    TEXT        NOT NULL,

  CONSTRAINT login_attempts_outcome_known CHECK (
    outcome IN ('success', 'bad_password', 'no_account', 'disabled', 'not_activated', 'blocked')
  )
);

-- The limiter counts recent failures by address and by account, so both need
-- an index that leads with the thing being counted and orders by time.
CREATE INDEX IF NOT EXISTS login_attempts_ip_at_idx
  ON login_attempts (ip, at DESC);

CREATE INDEX IF NOT EXISTS login_attempts_email_at_idx
  ON login_attempts (email, at DESC);

-- For the administrator's "recent sign-in activity" list.
CREATE INDEX IF NOT EXISTS login_attempts_at_idx
  ON login_attempts (at DESC);

COMMENT ON TABLE login_attempts IS
  'Every sign-in attempt, successful or not. Backs the distributed rate limit and the sign-in activity list. Pruned to 90 days.';

-- ---------------------------------------------------------------------------
-- Session revocation
--
-- Sessions are stateless JWTs, so until now there was no way to end one early.
-- Changing your password did not sign anybody else out — which is the first
-- thing you would want to do if you thought someone else had got in.
--
-- Every token carries `iat`. Moving this timestamp forward invalidates every
-- token issued before it, in one write, with no session table to maintain.
-- ---------------------------------------------------------------------------

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS sessions_valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN profiles.sessions_valid_from IS
  'Tokens issued before this instant are refused. Moved forward by a password change or by an administrator ending the account''s sessions.';
