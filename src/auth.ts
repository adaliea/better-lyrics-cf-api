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
        }),
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

// Helper function to decode a URL-safe Base64 string
function base64UrlDecode(str: string): string {
    // Replace URL-safe characters with standard Base64 characters
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    // Pad with '=' signs if necessary
    while (base64.length % 4) {
        base64 += '=';
    }
    return atob(base64);
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
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 1) // 1-hour expiration
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
 * Verifies an incoming JWT by checking its expiration and signature.
 * @param token The JWT from the Authorization header.
 * @param secretKey The secret key to verify the signature with.
 * @returns True if the token is valid and not expired, false otherwise.
 */
export async function verifyJwt(token: string, secretKey: string): Promise<boolean> {
    try {
        const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');

        if (!encodedHeader || !encodedPayload || !encodedSignature) {
            console.error('JWT is malformed. It must have 3 parts.');
            return false;
        }

        // 1. Decode the payload to read the claims
        const payloadStr = base64UrlDecode(encodedPayload);
        const payload = JSON.parse(payloadStr);

        // 2. Check if the token has expired
        // The 'exp' claim is a UNIX timestamp in seconds.
        const nowInSeconds = Date.now() / 1000;
        if (payload.exp && nowInSeconds > payload.exp) {
            console.log('JWT has expired.');
            return false;
        }

        // 3. If not expired, verify the cryptographic signature
        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(secretKey),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );

        const signature = Uint8Array.from(base64UrlDecode(encodedSignature), c => c.charCodeAt(0));

        const isValidSignature = await crypto.subtle.verify(
            'HMAC',
            key,
            signature,
            new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
        );

        if (!isValidSignature) {
            console.log('JWT signature is invalid.');
        }

        return isValidSignature;

    } catch (e) {
        console.error('JWT verification error:', e);
        return false;
    }
}
