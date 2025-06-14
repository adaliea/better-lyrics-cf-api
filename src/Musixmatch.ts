// Types for our responses and data
import { awaitLists } from './index';
import { Diff, diffArrays } from 'diff';
import { LyricsResponse, parseLrc } from './LyricUtils';



interface MusixmatchResponse {
    message: Message;
}

export interface Message {
    header: Header;
    body: Body;
}

export interface Header {
    status_code: number;
    execute_time: number;
    confidence: number;
    mode: string;
    cached: number;
}

export interface Body {
    richsync: any;
    subtitle: any;
    track: Track,
    user_token: string
}

export interface Track {
    track_id: number;
    track_mbid: string;
    track_isrc: string;
    commontrack_isrcs: string[][];
    track_spotify_id: string;
    commontrack_spotify_ids: string[];
    commontrack_itunes_ids: number[];
    track_soundcloud_id: number;
    track_xboxmusic_id: string;
    track_name: string;
    track_name_translation_list: any[];
    track_rating: number;
    track_length: number;
    commontrack_id: number;
    instrumental: number;
    explicit: number;
    has_lyrics: number;
    has_lyrics_crowd: number;
    has_subtitles: number;
    has_richsync: number;
    has_track_structure: number;
    num_favourite: number;
    lyrics_id: number;
    subtitle_id: number;
    album_id: number;
    album_name: string;
    album_vanity_id: string;
    artist_id: number;
    artist_mbid: string;
    artist_name: string;
    album_coverart_100x100: string;
    album_coverart_350x350: string;
    album_coverart_500x500: string;
    album_coverart_800x800: string;
    track_share_url: string;
    track_edit_url: string;
    commontrack_vanity_id: string;
    restricted: number;
    first_release_date: string;
    updated_time: string;
    primary_genres: PrimaryGenres;
    secondary_genres: SecondaryGenres;
}

export interface PrimaryGenres {
    music_genre_list: MusicGenreList[];
}

export interface MusicGenreList {
    music_genre: MusicGenre;
}

export interface MusicGenre {
    music_genre_id: number;
    music_genre_parent_id: number;
    music_genre_name: string;
    music_genre_name_extended: string;
    music_genre_vanity: string;
}

export interface SecondaryGenres {
    music_genre_list: any[];
}

export interface RichSyncBody {
    /**
     * Start Time (s)
     */
    ts: number;
    /**
     * End Time (s)
     */
    te: number;
    l:  TimedWord[];
    /**
     * Lyric Text (s)
     */
    x:  string;
}

export interface TimedWord {
    /**
     * Word (can be a space/similar)
     */
    c: string;
    /**
     * Offset in s from the lyric start time
     */
    o: number;
}


export interface MatchingTimedWord {
    /**
     * Word (can be a space/similar)
     */
    word: string;
    wordTime: number;
}


export class Musixmatch {
    private token: string | null = null;
    private cookies: { key: string, cookie: string }[] = [];
    private readonly ROOT_URL = 'https://apic-desktop.musixmatch.com/ws/1.1/';

    private cache = caches.default;

    private async _get(action: string, query: [string, string][], noCache = false): Promise<Response> {
        query.push(['app_id', 'web-desktop-app-v1.0']);
        if (this.token) {
            query.push(['usertoken', this.token]);
        }


        let url = new URL(this.ROOT_URL + action);
        query.forEach(([key, value]) => url.searchParams.set(key, value));

        let cacheUrl = url.toString();
        let cachedResponse = await this.cache.match(cacheUrl);
        if (cachedResponse) {
            if (noCache) {
                console.log('deleting cache for: ' + cacheUrl);
                awaitLists.add(this.cache.delete(cacheUrl));
            } else {
                console.log('cache hit for: ' + cacheUrl);
                return cachedResponse;
            }
        } else {
            console.log("cache miss for: " + cacheUrl)
        }

        const t = Date.now().toString();
        url.searchParams.set("t", t)
        let response;
        let loopCount = 0;

        do {
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Origin': 'https://www.musixmatch.com',
                'Referer': 'https://www.musixmatch.com/',
            } as Record<string, string>;

            if (this.cookies.length > 0) {
                headers['Cookie'] = this.cookies.map(({ key, cookie }) => {
                    return key + "=" + cookie;
                }).join(";");
            }

            console.log('cookie', headers['Cookie']);

            response = await fetch(url, {
                headers,
                redirect: "manual",
            });

            // Store any new cookies
            const newCookies = response.headers.getAll('Set-Cookie');
            newCookies.forEach((cookieStr) => {
                    let splitIndex = cookieStr.indexOf('=');
                    if (splitIndex > -1) {
                        let key = cookieStr.substring(0, splitIndex);
                        let cookie = cookieStr.substring(splitIndex + 1, cookieStr.length).split(";")[0];
                        this.cookies.push({ key, cookie });
                    }
                },
            );
            const location = response.headers.get('Location');
            url = new URL("https://apic-desktop.musixmatch.com" + location);
            loopCount += 1;
            if (loopCount > 5) {
                throw new Error("too many redirects");
            }
        } while ((response.status === 302 || response.status === 301));
        if (response.body === null) {
            return Promise.reject("Body is missing");
        }

        let teeBody = response.body.tee();
        response = new Response(teeBody[1], response); // make mutable
        let keys = [...response.headers.keys()];
        keys.forEach((key) => response.headers.delete(key));


        if (response.status === 200) {
            if (action === 'token.get') {
                response.headers.set('Cache-control', 'public; max-age=3600');
            } else {
                response.headers.set('Cache-control', 'public; max-age=86400');
            }
            awaitLists.add(this.cache.put(cacheUrl, response));
        }

        return new Response(teeBody[0], response);
    }

    async getToken(): Promise<void> {
        let response;
        if (this.token) {
            this.token = null;
            response = await this._get('token.get', [['user_language', 'en']], false);
        } else {
            response = await this._get('token.get', [['user_language', 'en']]);
        }
        const data = await response.json() as MusixmatchResponse;

        console.log('token status: ' + data.message.header.status_code);
        if (data.message.header.status_code === 401) {
            throw Error("Failed to get token");
        }

        console.log('token: ' + data.message.body.user_token);

        this.token = data.message.body.user_token;
    }

    private formatTime(timeInSeconds: number): string {
        const minutes = Math.floor(timeInSeconds / 60);
        const seconds = Math.floor(timeInSeconds % 60);
        const hundredths = Math.floor((timeInSeconds % 1) * 100);

        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
    }

    private async getLrcWordByWord(trackId: string | number, lrcLyrics: Promise<LyricsResponse | null> | null):
        Promise<LyricsResponse | null> {


        let musixmatchBasicLyrics: Promise<LyricsResponse | null> = this.getLrcById(trackId);
        let basicLrcPromise: Promise<LyricsResponse | null>;
        if (lrcLyrics !== null) {
            basicLrcPromise = lrcLyrics;
        } else {
            basicLrcPromise = musixmatchBasicLyrics;
        }
        const response = await this._get('track.richsync.get', [['track_id', String(trackId)]]);
        const data = await response.json() as MusixmatchResponse;
        console.log('response data' + JSON.stringify(data));
        let mean, variance;

        if (!response.ok || data.message.header.status_code !== 200) {
            return null;
        }

        const richSyncBody = JSON.parse(data.message.body.richsync.richsync_body) as RichSyncBody[];

        let lrcStr = '';
        let richSyncTokenArray: MatchingTimedWord[] = [];

        for (const item of richSyncBody) {
            lrcStr += `[${this.formatTime(item.ts)}] `;

            for (const lyric of item.l) {
                const time = this.formatTime(item.ts + lyric.o);
                lrcStr += `<${time}> ${lyric.c} `;

                for (let i = 0; i < lyric.c.length; i++) {
                    let char = lyric.c[i];
                    if (i === 0) {
                        richSyncTokenArray.push({
                            word: char, wordTime: item.ts + lyric.o
                        });
                    } else {
                        richSyncTokenArray.push({
                            word: char, wordTime: -1
                        });
                    }
                }
            }
            richSyncTokenArray.push({
                word: '\n', wordTime: -1
            });

            const endTime = this.formatTime(item.te);
            lrcStr += `<${endTime}>\n`;
        }



        let basicLrc = await basicLrcPromise;
        if (basicLrc && basicLrc.synced) {
            let basicLrcOffset = [] as number[];
            let diffDebug: { op: string, text: string }[] = [];

            let parsedLrc = parseLrc(basicLrc.synced);
            let parsedLrcTokenArray: MatchingTimedWord[] = [];
            parsedLrc.forEach(({startTimeMs, words}, index) => {
                for (let i = 0; i < words.length; i++) {
                    let char = words[i];
                    if (i === 0) {
                        parsedLrcTokenArray.push({
                            word: char, wordTime: startTimeMs / 1000.0
                        });
                    } else {
                        parsedLrcTokenArray.push({
                            word: char, wordTime: -1
                        });
                    }
                }
                if (index < parsedLrc.length - 1) {
                    parsedLrcTokenArray.push({
                        word: '\n', wordTime: -1
                    });
                }
            });

            let diff = diffArrays(parsedLrcTokenArray, richSyncTokenArray, { comparator: (left, right) => left.word.toLowerCase() === right.word.toLowerCase() });

            let leftIndex = 0;
            let rightIndex = 0;
            diff.forEach(change => {
                if (!change.removed && !change.added && change.value && change.count !== undefined) {
                    for (let i = 0; i < change.count; i++) {
                        let leftToken = parsedLrcTokenArray[leftIndex];
                        let rightToken = richSyncTokenArray[rightIndex];

                        if (leftToken.wordTime !== -1 && rightToken.wordTime !== -1) {
                            basicLrcOffset.push(rightToken.wordTime - leftToken.wordTime);
                            // console.log('found matching char with time', leftToken, rightToken);
                        }
                        leftIndex++;
                        rightIndex++;
                    }
                    diffDebug.push({ op: 'MATCH', text: change.value.map(word => word.word).join('') });
                    // console.log('found match', leftIndex, rightIndex, change.value.map(word => word.word).join('') + '\n');
                } else {
                    if (!change.added && change.count !== undefined) {
                        leftIndex += change.count;
                        diffDebug.push({ op: 'REMOVED', text: change.value.map(word => word.word).join('') });
                    }
                    if (!change.removed && change.count !== undefined) {
                        rightIndex += change.count;
                        diffDebug.push({ op: 'ADDED', text: change.value.map(word => word.word).join('') });
                    }
                }
            });

            let meanVar = meanAndVariance(basicLrcOffset);
            mean = meanVar.mean;
            variance = meanVar.variance;
            if (variance < 1.5) {
                lrcStr = `[offset:${addPlusSign(mean)}]\n` + lrcStr;
                return {
                    richSynced: lrcStr, synced: (await musixmatchBasicLyrics)?.synced, unsynced: null, debugInfo: {
                        lyricMatchingStats: { mean, variance, samples: basicLrcOffset, diff: diffDebug }
                    }
                };
            } else {
                if (lrcLyrics) {
                    return {
                        richSynced: null, synced: (await musixmatchBasicLyrics)?.synced, unsynced: null, debugInfo: {
                            lyricMatchingStats: { mean, variance, samples: basicLrcOffset, diff: diffDebug },
                            comment: 'basic lyrics matched but variance is too high; using basic lyrics instead'
                        }
                    };
                } else {
                    return {
                        richSynced: null, synced: (await musixmatchBasicLyrics)?.synced, unsynced: null, debugInfo: {
                            lyricMatchingStats: { mean, variance, samples: basicLrcOffset, diff: diffDebug },
                            comment: 'basic lyrics matched but variance is too high; using basic lyrics instead'
                        }
                    };
                }

            }
        }

        return {
            richSynced: lrcStr, synced: null, unsynced: null, debugInfo: {
                comment: 'no synced basic lyrics found'
            }
        };


    }

    private async getLrcById(trackId: string | number): Promise<LyricsResponse | null> {
        // Get the main subtitles
        const response = await this._get('track.subtitle.get', [
            ['track_id', String(trackId)],
            ['subtitle_format', 'lrc'],
        ]);

        if (!response.ok) {
            return null;
        }

        const data = await response.json() as MusixmatchResponse;
        if (!data.message.body?.subtitle?.subtitle_body) {
            return null;
        }

        let lrcStr = data.message.body.subtitle.subtitle_body;

        return { richSynced: null, synced: lrcStr, unsynced: null, debugInfo: null };
    }

    async getLrc(artist: string, track: string, album: string | null, enhanced: boolean, lrcLyrics: Promise<LyricsResponse | null> | null):
        Promise<LyricsResponse | null> {

        let query: [string, string][] = [
            ['q_track', track],
            ['q_artist', artist],
            ['page_size', '1'],
            ['page', '1'],
        ];
        if (album) {
            // @ts-ignore
            query.push(['album', album]);
        }
        const response = await this._get('matcher.track.get', query);

        let data = await response.json() as MusixmatchResponse;
        console.log(data, data.message.header.status_code);
        if (data.message.header.status_code === 401) {
            this.cookies = [];
            await this.getToken();
            // try again
            const response = await this._get('matcher.track.get', query);
            data = await response.json() as MusixmatchResponse;
        }
        if (data.message.header.status_code !== 200) {
            console.error('didn\'t get 200 for message', data.message.header.status_code);
            return null;
        }

        const trackId = data.message.body.track.track_id;
        const hasRichLyrics = data.message.body.track.has_richsync;
        const hasSubtitles = data.message.body.track.has_subtitles;
        const hasLyrics = data.message.body.track.has_lyrics;
        console.log('hasRichLyrics', hasRichLyrics, "hasSubtitles", hasSubtitles, "hasLyrics", hasLyrics);
        if (hasRichLyrics && enhanced) {
            return this.getLrcWordByWord(trackId, lrcLyrics);
        } else if (hasSubtitles) {
            return this.getLrcById(trackId);
        }
        return null;
    }
}



function meanAndVariance(arr: number[]) {
    const mean = arr.reduce((acc, val) => acc + val, 0) / arr.length;
    const variance = arr.reduce((acc, val) => acc + (val - mean) ** 2, 0) / arr.length;
    return { mean, variance };
}


function addPlusSign(num: number) {
    if (num > 0) {
        return `+${num}`;
    } else {
        return `${num}`;
    }
}
