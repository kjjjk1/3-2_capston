ALTER TABLE meeting_history ADD COLUMN calculation_mode TEXT NOT NULL DEFAULT 'api' CHECK(calculation_mode IN ('api','estimated'));
