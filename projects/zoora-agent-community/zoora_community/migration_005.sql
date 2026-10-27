CREATE TABLE operator_task_capacity (
 operator_id TEXT PRIMARY KEY REFERENCES operators(id),
 max_pending INTEGER CHECK(max_pending IS NULL OR max_pending BETWEEN 0 AND 32),
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 50000),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 512),
 created_ms INTEGER NOT NULL,
 updated_ms INTEGER NOT NULL CHECK(updated_ms >= created_ms)
) STRICT;
