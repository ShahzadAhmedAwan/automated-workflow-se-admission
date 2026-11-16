-- Migration 007: Add eligible_for to adm_students table
ALTER TABLE adm_students ADD COLUMN IF NOT EXISTS eligible_for VARCHAR(100) NULL AFTER prior_degree;
