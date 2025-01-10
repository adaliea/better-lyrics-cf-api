// Types for our responses and data
interface LyricsResponse {
    synced: string | null;
    unsynced: string | null;
}

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


export class Musixmatch {
    private token: string | null = null;
    private cookies: { key: string, cookie: string }[] = [];
    private readonly ROOT_URL = 'https://apic-desktop.musixmatch.com/ws/1.1/';


    private async _get(action: string, query: [string, string][]): Promise<Response> {
        if (action !== 'token.get' && !this.token) {
            await this.getToken();
        }

        query.push(['app_id', 'web-desktop-app-v1.0']);
        if (this.token) {
            query.push(['usertoken', this.token]);
        }

        const t = Date.now().toString();
        query.push(['t', t]);

        let url = new URL(this.ROOT_URL + action);
        query.forEach(([key, value]) => url.searchParams.set(key, value));

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

            console.log(headers["Cookie"]);

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
        {
        }

        return response;
    }

    async getToken(): Promise<void> {
        const response = await this._get('token.get', [['user_language', 'en']]);
        const data = await response.json() as MusixmatchResponse;

        if (data.message.header.status_code === 401) {
            throw Error("Failed to get token");
        }

        this.token = data.message.body.user_token;
    }

    private formatTime(timeInSeconds: number): string {
        const minutes = Math.floor(timeInSeconds / 60);
        const seconds = Math.floor(timeInSeconds % 60);
        const hundredths = Math.floor((timeInSeconds % 1) * 100);

        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
    }

    private async getLrcWordByWord(trackId: string | number): Promise<LyricsResponse | null> {
        const response = await this._get('track.richsync.get', [['track_id', String(trackId)]]);
        const data = await response.json() as MusixmatchResponse;

        if (!response.ok || data.message.header.status_code !== 200) {
            return null;
        }

        const lrcRaw = JSON.parse(data.message.body.richsync.richsync_body);
        let lrcStr = '';

        for (const item of lrcRaw) {
            lrcStr += `[${this.formatTime(item.ts)}] `;

            for (const lyric of item.l) {
                const time = this.formatTime(item.ts + parseFloat(lyric.o));
                lrcStr += `<${time}> ${lyric.c} `;
            }

            const endTime = this.formatTime(parseFloat(item.te));
            lrcStr += `<${endTime}>\n`;
        }

        return { synced: lrcStr, unsynced: null };
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

        return { synced: lrcStr, unsynced: null };
    }

    async getLrc(artist: string, track: string, album: string | null): Promise<LyricsResponse | null> {

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

        const data = await response.json() as MusixmatchResponse;
        console.log("Musixmatch Search: " + JSON.stringify(data, null, 2));
        if (data.message.header.status_code !== 200) {
            return null;
        }

        const trackId = data.message.body.track.track_id;
        const hasRichLyrics = data.message.body.track.has_richsync;
        const hasSubtitles = data.message.body.track.has_subtitles;
        const hasLyrics = data.message.body.track.has_lyrics;
        console.log('hasRichLyrics', hasRichLyrics, "hasSubtitles", hasSubtitles, "hasLyrics", hasLyrics);
        if (hasRichLyrics) {
            return this.getLrcWordByWord(trackId);
        } else if (hasSubtitles) {
            return this.getLrcById(trackId);
        }
        return null;
    }
}
