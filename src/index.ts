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
        observabilityData = {};
        awaitLists = new Set<Promise<any>>();
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "https://music.youtube.com",
                    'Access-Control-Allow-Credentials': 'true'
                },
            });
        }

        try {
            let response = await getLyrics(request, env);
            response = new Response(response.body, response);
            response.headers.set('content-type', 'application/json');
            response.headers.set('Access-Control-Allow-Origin', 'https://music.youtube.com');
            response.headers.set('Cache-Control', 'max-age=600, stale-while-revalidate=600');
            response.headers.set('Access-Control-Allow-Credentials', 'true');
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

let observabilityData: Record<string, any[]> = {};

export function observe(data: Record<string, any>): void {
    for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            const value = data[key];

            // If we've never seen this key before, initialize its value as an empty array.
            if (!observabilityData[key]) {
                observabilityData[key] = [];
            }

            // Push the new value into the array for that key.
            observabilityData[key].push(value);
        }
    }
}
