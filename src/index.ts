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
        let response = await getLyrics(request, env);
        response = new Response(response.body, response);
        response.headers.set("content-type", "application/json");
        response.headers.set("Access-Control-Allow-Origin", "https://music.youtube.com");
        response.headers.set("Cache-Control", "max-age=604800, stale-while-revalidate=604800");
        await Promise.all(awaitLists);
        return response;
    },
} satisfies ExportedHandler<Env>;
