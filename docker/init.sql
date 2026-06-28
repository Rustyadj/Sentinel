-- Run once by the postgres superuser on first DB initialization.
-- Creates the pgvector extension required by the Memory model.
CREATE EXTENSION IF NOT EXISTS vector;
