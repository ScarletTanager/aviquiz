-- Apply as schema owner after 0002_invitations.sql, before enabling invitations.
GRANT SELECT, INSERT, UPDATE ON app_invitations TO aviquiz_runtime;
GRANT SELECT, UPDATE ON app_invitation_lock TO aviquiz_runtime;
