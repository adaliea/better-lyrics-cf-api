// Define the shape of the combined D1 query result for type safety
import { awaitLists, observe } from './index';
import pako from 'pako';
import { env } from 'cloudflare:workers';

interface D1CombinedResult {
    track_id: number;
    last_accessed_at: number;
    format: LyricType | null;
    r2_object_key: string | null;
}

export interface SaveLyricsData {
    source_platform: SourcePlatform;
    source_track_id: string;
    musixmatch_track_id: number;
    lyric_content: string; // The raw, uncompressed content
    lyric_format: LyricType;
}

export interface D1Track {
    id: number;
}

export interface Lyric {
    format: LyricType;
    content: string;
}

type LyricType = 'rich_sync' | 'normal_sync';

type SourcePlatform = 'youtube_music' | 'spotify' | 'apple_music';

/**
 * Fetches and uncompresses lyrics from the D1/R2 cache.
 * @param source_platform - The platform name (e.g., 'youtube_music').
 * @param source_track_id - The unique track ID from the source platform.
 * @param env - The Cloudflare Worker environment object.
 * @returns An array of lyric objects or null if not found.
 */
export async function getLyricsFromCache(
    source_platform: SourcePlatform,
    source_track_id: string,
): Promise<Lyric[] | null> {
    // 1. Execute a single JOIN query to get all data at once.
    const stmt = env.DB.prepare(`
    SELECT
      t.id as track_id,
      t.last_accessed_at,
      l.format,
      l.r2_object_key
    FROM track_mappings AS tm
    JOIN tracks AS t ON tm.track_id = t.id
    LEFT JOIN lyrics AS l ON t.id = l.track_id
    WHERE tm.source_platform = ?1 AND tm.source_track_id = ?2
  `);
    const { results } = await stmt.bind(source_platform, source_track_id).all<D1CombinedResult>();

    // 2. If no results, it's a cache miss.
    if (!results || results.length === 0) {
        observe({"musixMatchCacheLookup": {source_platform, source_track_id, internalTrackId: null, lastAccessedAt: null}});
        return null;
    }

    const firstResult = results[0];
    const internalTrackId = firstResult.track_id;
    const lastAccessedAt = firstResult.last_accessed_at;
    observe({"musixMatchCacheLookup": {source_platform, source_track_id, internalTrackId, lastAccessedAt}});

    // 3. Asynchronously update the access time, but only if it's been more than a day.
    const now = Math.floor(Date.now() / 1000);
    let updateTimestampPromise: Promise<any> = Promise.resolve();
    if (now - lastAccessedAt > 86400) { // 86400 seconds = 1 day
        observe({'musixmatchCacheTimestampUpdate': {updatedAt: now, internalTrackId}});
        updateTimestampPromise = env.DB.prepare(
            "UPDATE tracks SET last_accessed_at = ?1 WHERE id = ?2"
        ).bind(now, internalTrackId).run();
        awaitLists.add(updateTimestampPromise);
    } else {
        observe({'musixmatchCacheTimestampUpdate': {updatedAt: -1, internalTrackId}});
    }

    // 4. Fetch and decompress all lyric objects from R2 concurrently.
    const lyricsPromises: Promise<Lyric | null>[] = results
        .filter(row => row.r2_object_key && row.format)
        .map(async (meta) => {
            const object = await env.LYRICS_BUCKET.get(meta.r2_object_key!);
            if (!object) {
                console.error(`CACHE ERROR: R2 object not found for key: ${meta.r2_object_key}`);
                return null;
            }
            const compressedContent = await object.arrayBuffer();

            const content = pako.inflate(compressedContent, { to: 'string' });

            return { format: meta.format!, content };
        });

    // Wait for R2 fetches and the potential DB update to complete.
    const lyricsWithNulls = await Promise.all(lyricsPromises);

    observe({musixMatchCacheLookupSuccess: {
            tracks: lyricsWithNulls,
            internalTrackId
        }})
    return lyricsWithNulls.filter((lyric): lyric is Lyric => lyric !== null);
}


/**
 * Saves new lyrics and their metadata to the D1/R2 cache using TypeScript.
 * @param data - An object containing all necessary data.
 * @returns True on success, false on failure.
 */
export async function saveLyricsToCache(data: SaveLyricsData): Promise<boolean> {
    try {
        const compressedContent: Uint8Array = pako.deflate(data.lyric_content);

        // Generate a unique key for the R2 object.
        const r2ObjectKey = `${data.musixmatch_track_id}/${data.lyric_format}.gz`;

        // Upload the COMPRESSED data to R2.
        await env.LYRICS_BUCKET.put(r2ObjectKey, compressedContent);
        observe({musixmatchCacheSavedCompressedObject: {r2ObjectKey}})

        // Get the internal track ID, creating the track record if it doesn't exist.
        const insertTrackStmt = env.DB.prepare(
            "INSERT INTO tracks (musixmatch_track_id, last_accessed_at) VALUES (?1, ?2) ON CONFLICT(musixmatch_track_id) DO NOTHING"
        ).bind(data.musixmatch_track_id, Math.floor(Date.now() / 1000));
        await insertTrackStmt.run();

        const getTrackStmt = env.DB.prepare(
            "SELECT id FROM tracks WHERE musixmatch_track_id = ?1"
        ).bind(data.musixmatch_track_id);
        const track = await getTrackStmt.first<D1Track>();

        if (!track) {
            throw new Error(`Failed to find or create track for musixmatch_track_id: ${data.musixmatch_track_id}`);
        }
        const internalTrackId = track.id;

        // Prepare and execute the final inserts for lyrics and mappings in a batch.
        const finalStmts = [
            env.DB.prepare(
                "INSERT INTO lyrics (track_id, format, r2_object_key) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING"
            ).bind(internalTrackId, data.lyric_format, r2ObjectKey),

            env.DB.prepare(
                "INSERT INTO track_mappings (source_platform, source_track_id, track_id) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING"
            ).bind(data.source_platform, data.source_track_id, internalTrackId)
        ];

        await env.DB.batch(finalStmts);

        observe({musixmatchCacheSave: {success: true, data}})
        return true;

    } catch (error) {
        observe({musixmatchCacheSave: {success: false, data, error}})
        return false;
    }
}
