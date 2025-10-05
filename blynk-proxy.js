// This is your Netlify Function, located at /api/blynk-proxy.js

// These environment variables MUST be set in your Netlify project settings.
const BLYNK_AUTH_TOKEN = process.env.BLYNK_AUTH_TOKEN;
const BLYNK_SERVER = process.env.BLYNK_SERVER || 'blynk.cloud'; // Default to blynk.cloud

// Map virtual pins to friendly names for clarity
const VPIN_MAP = {
    valve_control: 'V0',
    heartbeat: 'V1',
    flow_rate: 'V2',
    liters: 'V3'
};

/**
 * Main handler for all incoming requests.
 */
export default async (request, context) => {
    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ status: 'error', details: 'Method Not Allowed' }), { status: 405 });
    }
    if (!BLYNK_AUTH_TOKEN) {
        return new Response(JSON.stringify({ status: 'error', details: 'CRITICAL: Blynk auth token is not configured on the server.' }), { status: 500 });
    }

    try {
        const { action, payload } = await request.json();

        if (action === 'send_valve_command') {
            await handleUpdatePin(VPIN_MAP.valve_control, payload);
            return new Response(JSON.stringify({ status: 'success', details: 'Command sent.' }), { status: 200 });

        } else if (action === 'get_system_status') {
            const data = await handleGetSystemStatus();
            return new Response(JSON.stringify({ status: 'success', data }), { status: 200 });

        } else {
            return new Response(JSON.stringify({ status: 'error', details: 'Invalid action specified.' }), { status: 400 });
        }
    } catch (error) {
        console.error('[PROXY_ERROR]', error.message);
        return new Response(JSON.stringify({ status: 'error', details: error.message }), { status: 500 });
    }
};

/**
 * Updates a specific virtual pin with a given value.
 */
async function handleUpdatePin(pin, value) {
    const url = `https://${BLYNK_SERVER}/external/api/update?token=${BLYNK_AUTH_TOKEN}&${pin}=${value}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Blynk API error when updating ${pin}: HTTP ${response.status}`);
    }
}

/**
 * Fetches the last value from a given virtual pin.
 */
async function getPinData(pin) {
    const url = `https://${BLYNK_SERVER}/external/api/get?token=${BLYNK_AUTH_TOKEN}&${pin}`;
    try {
        const apiResponse = await fetch(url);
        if (!apiResponse.ok) {
            // Blynk returns 400 for invalid pin, which we treat as no data
            if (apiResponse.status === 400) return null; 
            throw new Error(`Blynk API request for '${pin}' failed with status ${apiResponse.status}`);
        }
        
        // As of recent Blynk API changes, we need to also fetch metadata for timestamp
        const metaUrl = `https://${BLYNK_SERVER}/external/api/data/get?token=${BLYNK_AUTH_TOKEN}&pins=${pin}`;
        const metaResponse = await fetch(metaUrl);
        let timestamp = new Date().toISOString(); // Fallback to now
        if (metaResponse.ok) {
            const metaData = await metaResponse.json();
            if (metaData[pin] && metaData[pin].length > 0) {
                 timestamp = metaData[pin][0].ts ? new Date(metaData[pin][0].ts).toISOString() : timestamp;
            }
        }

        const value = await apiResponse.json();
        return { value, timestamp };
    } catch (e) {
        console.error(`Error fetching data for pin ${pin}:`, e.message);
        throw e;
    }
}

/**
 * Fetches the status from all relevant virtual pins.
 */
async function handleGetSystemStatus() {
    const pinsToFetch = Object.entries(VPIN_MAP);

    const results = await Promise.allSettled(
        pinsToFetch.map(([key, pin]) => getPinData(pin))
    );

    const data = {};
    pinsToFetch.forEach(([key, pin], index) => {
        if (results[index].status === 'fulfilled') {
            data[key] = results[index].value;
        } else {
            data[key] = null; // Mark as null on error
        }
    });

    return data;
}
