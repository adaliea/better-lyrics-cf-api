// src/auth.ts

interface TurnstileVerificationResponse {
    'success': boolean;
    'error-codes'?: string[];
    'challenge_ts'?: string;
    'hostname'?: string;
    'action'?: string;
    'cdata'?: string;
}

/**
 * Verifies a Turnstile token with Cloudflare's siteverify endpoint.
 * @param token The Turnstile token from the client.
 * @param secretKey Your Turnstile secret key.
 * @returns True if the token is valid, false otherwise.
 */
export async function verifyTurnstileToken(token: string, secretKey: string): Promise<boolean> {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            secret: secretKey,
            response: token
        })
    });

    const data: TurnstileVerificationResponse = await response.json();
    return data.success;
}

// --- JWT HELPER FUNCTIONS ---

// Helper function to encode a string to a URL-safe Base64 string
function base64UrlEncode(str: string): string {
    return btoa(str)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * Creates a new JWT.
 * @param secretKey The secret to sign the token with.
 * @returns A promise that resolves with the JWT string.
 */
export async function createJwt(secretKey: string): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 1) // 24-hour expiration
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));

    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secretKey),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
    );

    const encodedSignature = base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));

    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

/**
 * Verifies an incoming JWT.
 * @param token The JWT from the Authorization header.
 * @param secretKey The secret key to verify the signature with.
 * @returns True if the token is valid and not expired, false otherwise.
 */
export async function verifyJwt(token: string, secretKey: string): Promise<boolean> {
    try {
        const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
        const payload = JSON.parse(atob(encodedPayload));

        // Check if the token has expired
        if (payload.exp && Date.now() / 1000 > payload.exp) {
            console.log('JWT has expired');
            return false;
        }

        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(secretKey),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );

        const signature = Uint8Array.from(atob(encodedSignature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

        return await crypto.subtle.verify(
            'HMAC',
            key,
            signature,
            new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
        );
    } catch (e) {
        console.error('JWT verification error:', e);
        return false;
    }
}
