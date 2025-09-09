-- Migration number: 0002 	 2025-09-09T19:08:34.421Z

-- Index 1: Speeds up the initial lookup.
-- This composite index is for the WHERE clause that finds a track mapping
-- based on the source platform (e.g., 'youtube_music') and its unique track ID.
-- This is the most critical index for cache-hit performance.
CREATE INDEX IF NOT EXISTS idx_mappings_source_lookup
    ON track_mappings (source_platform, source_track_id);


-- Index 2: Speeds up the JOIN operation.
-- This index is on the `lyrics.track_id` foreign key. It makes the
-- JOIN from the `tracks` table to the `lyrics` table efficient, avoiding
-- a slow full-table scan when retrieving lyric metadata.
CREATE INDEX IF NOT EXISTS idx_lyrics_track_id
    ON lyrics (track_id);
