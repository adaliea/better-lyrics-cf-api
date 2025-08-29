/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { getLyrics } from './GetLyrics';

export let awaitLists = new Set<Promise<any>>();
export default {
    async fetch(request, env, ctx): Promise<Response> {
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "https://music.youtube.com",
                },
            });
        }

        try {
            let response = await getLyrics(request, env);
            response = new Response(response.body, response);
            response.headers.set('content-type', 'application/json');
            response.headers.set('Access-Control-Allow-Origin', 'https://music.youtube.com');
            // response.headers.set("Cache-Control", "max-age=604800, stale-while-revalidate=604800");
            for (const awaitList of awaitLists) {
                ctx.waitUntil(awaitList);
            }
            console.log(observabilityData);
            return response;
        } catch (e) {
            console.error(e);
            console.log(observabilityData);
        }

        return new Response(null, { status: 400 });
    },
} satisfies ExportedHandler<Env>;

let observabilityData = new Map<string, any>();

export function observe(data: any) {
    observabilityData.forEach((value, key, map) => {
        if (observabilityData.has(key)) {
            let count = 1;
            while (observabilityData.has(key + count)) {
                count++;
            }
            key = key + count;
        }
        observabilityData.set(key, value);
    });
}
