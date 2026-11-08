-- One place, one consistent taxonomy/processing version, inclusive local
-- month-day window, optionally wrapping across New Year (e.g. 12-15 to 01-15).
-- For recurrence, dates on either side of New Year belong to the same season.
WITH effort AS (
  SELECT e.*,
    e.observation_year - CASE WHEN :start_md > :end_md
      AND substr(e.observation_date, 6) <= :end_md THEN 1 ELSE 0 END AS season_year
  FROM ebd_effort_day e
  JOIN ebd_partition p USING (place_id, observation_year)
  JOIN ebd_release r USING (release_id)
  WHERE e.place_id = :place_id
    AND e.observation_year BETWEEN :first_year AND :last_year
    AND r.taxonomy_version = :taxonomy_version AND r.processing_version = :processing_version
    AND (CASE WHEN :start_md <= :end_md THEN substr(e.observation_date, 6) BETWEEN :start_md AND :end_md
              ELSE substr(e.observation_date, 6) >= :start_md OR substr(e.observation_date, 6) <= :end_md END)
), coverage AS (
  SELECT SUM(checklist_count) AS sampled_checklists, COUNT(*) AS sampled_days,
    COUNT(DISTINCT season_year) AS sampled_seasons FROM effort
), detected AS (
  SELECT d.taxon_key, SUM(d.checklist_count) AS reporting_checklists,
    COUNT(*) AS reporting_days, COUNT(DISTINCT e.season_year) AS reporting_seasons,
    SUM(1.0 * d.checklist_count / e.checklist_count) AS daily_fraction_sum,
    MAX(d.observation_date) AS last_detected
  FROM ebd_detection_day d JOIN effort e USING (place_id, observation_year, observation_date)
  WHERE d.taxonomy_version = :taxonomy_version
  GROUP BY d.taxon_key
)
SELECT t.taxon_key, t.common_name, t.scientific_name, d.reporting_checklists, c.sampled_checklists,
  d.reporting_days, c.sampled_days, d.reporting_seasons, c.sampled_seasons,
  d.last_detected, 1.0 * d.reporting_checklists / c.sampled_checklists AS checklist_rate,
  d.daily_fraction_sum / c.sampled_days AS day_balanced_rate,
  CASE WHEN c.sampled_seasons < 2 THEN 'insufficient_seasons'
       WHEN d.reporting_seasons = 1 THEN 'single_season'
       ELSE 'recurring' END AS evidence
FROM detected d CROSS JOIN coverage c
JOIN ebd_taxon t ON t.taxonomy_version = :taxonomy_version AND t.taxon_key = d.taxon_key
ORDER BY CASE evidence WHEN 'recurring' THEN 0 ELSE 1 END, day_balanced_rate DESC, t.taxon_key;
