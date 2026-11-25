-- Apply as schema owner after migration 0004. No quiz archive is created.
GRANT SELECT, INSERT, UPDATE ON user_statistics_settings, user_statistics_summary TO aviquiz_runtime;
