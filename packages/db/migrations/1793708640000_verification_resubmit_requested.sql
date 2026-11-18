-- Up Migration

ALTER TABLE client_verification DROP CONSTRAINT client_verification_state_check;

ALTER TABLE client_verification ADD CONSTRAINT client_verification_state_check
  CHECK (state IN ('unverified', 'pending', 'verified', 'rejected', 'resubmit_requested'));
