// mqtt-proxy.js
// A secure and resilient MQTT to WebSocket proxy.

const http = require('http'); // Use 'https' in production with TLS certificates
const WebSocket = require('ws');
const mqtt = require('mqtt');

// --- Configuration ---
// It is recommended to use environment variables for configuration in production.
const PROXY_PORT = 8080;
const MQTT_BROKER_URL = 'mqtt://localhost:1883'; // e.g., 'mqtt://test.mosquitto.org'
const MQTT_OPTIONS = {
    clientId: `mqtt_proxy_${Math.random().toString(16).slice(2, 10)}`,
    // For a secure broker, add username and password:
    // username: 'your_username',
    // password: 'your_password',
};

// --- Create HTTP Server ---
// In a production environment, this should be an HTTPS server.
// const https = require('https');
// const fs = require('fs');
// const server = https.createServer({
//   cert: fs.readFileSync('/path/to/your/cert.pem'),
//   key: fs.readFileSync('/path/to/your/key.pem')
// });
const server = http.createServer();

// --- Create WebSocket Server ---
const wss = new WebSocket.Server({ server });

console.log(`[Proxy] Starting WebSocket server on port ${PROXY_PORT}`);

// --- MQTT Client Setup ---
console.log(`[Proxy] Connecting to MQTT broker at ${MQTT_BROKER_URL}`);
const mqttClient = mqtt.connect(MQTT_BROKER_URL, MQTT_OPTIONS);

// --- MQTT Event Handlers ---
mqttClient.on('connect', () => {
    console.log(' Connected to broker.');
    // The proxy itself doesn't need to subscribe to anything by default.
    // Subscriptions will be managed based on WebSocket client requests.
});

mqttClient.on('reconnect', () => {
    console.log(' Reconnecting to broker...');
});

mqttClient.on('error', (error) => {
    console.error(' Connection error:', error);
});

mqttClient.on('close', () => {
    console.log(' Connection to broker closed.');
});

// This handler forwards messages from the MQTT broker to the relevant WebSocket clients.
mqttClient.on('message', (topic, message) => {
    console.log(` Received message on topic "${topic}": ${message.toString()}`);
    
    const dataToSend = JSON.stringify({
        topic: topic,
        payload: message.toString(),
    });

    wss.clients.forEach(wsClient => {
        // Check if the WebSocket client is open and has subscribed to this topic.
        if (wsClient.readyState === WebSocket.OPEN && wsClient.subscriptions.has(topic)) {
            wsClient.send(dataToSend, (error) => {
                if (error) {
                    console.error(` Error sending message to client:`, error);
                }
            });
        }
    });
});

// --- WebSocket Connection Handler ---
wss.on('connection', (ws) => {
    console.log(' Client connected.');
    // Attach a set to each client to track its subscriptions.
    ws.subscriptions = new Set();

    ws.on('message', (message) => {
        try {
            const parsedMessage = JSON.parse(message);
            console.log(' Received message from client:', parsedMessage);

            switch (parsedMessage.type) {
                case 'subscribe':
                    if (parsedMessage.topic) {
                        console.log(` Client subscribing to topic: ${parsedMessage.topic}`);
                        ws.subscriptions.add(parsedMessage.topic);
                        mqttClient.subscribe(parsedMessage.topic, (err) => {
                            if (err) {
                                console.error(` Failed to subscribe to topic "${parsedMessage.topic}":`, err);
                            }
                        });
                    }
                    break;

                case 'unsubscribe':
                    if (parsedMessage.topic) {
                        console.log(` Client unsubscribing from topic: ${parsedMessage.topic}`);
                        ws.subscriptions.delete(parsedMessage.topic);
                        // Note: We might not want to unsubscribe from MQTT broker if other clients are still subscribed.
                        // A more advanced implementation would use reference counting for topics.
                        // For simplicity here, we leave the MQTT subscription active.
                    }
                    break;

                case 'publish':
                    if (parsedMessage.topic && parsedMessage.payload!== undefined) {
                        console.log(` Client publishing to topic "${parsedMessage.topic}"`);
                        // Publish with QoS 1 for reliability for commands
                        mqttClient.publish(parsedMessage.topic, parsedMessage.payload, { qos: 1 });
                    }
                    break;

                default:
                    console.warn(` Received unknown message type: ${parsedMessage.type}`);
            }
        } catch (e) {
            console.error(' Error parsing message from client:', e);
        }
    });

    ws.on('close', () => {
        console.log(' Client disconnected.');
        // Clean up subscriptions to prevent memory leaks.
        // As noted above, a simple approach is to leave MQTT subscriptions.
        // A more robust system would check if any other WebSocket client needs the topic before unsubscribing.
        ws.subscriptions.clear();
    });

    ws.on('error', (error) => {
        console.error(' Client error:', error);
    });
});

// --- Start the Server ---
server.listen(PROXY_PORT, () => {
    console.log(`[Proxy] Server is listening on port ${PROXY_PORT}`);
});