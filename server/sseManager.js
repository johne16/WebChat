// sseManager.js - SSE state management (clients, broadcasting, needs-input queue)

// Track connected SSE clients: Set of response objects
const sseClients = new Set();

// Queue for needs_input requests: array of { port, taskId, sessionId, missingFields, timestamp }
const needsInputQueue = [];

// Send event to all connected SSE clients
export function broadcastSSE(event, data) {
	const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
	const failed = [];
	for (const client of sseClients) {
		try {
			client.write(message);
		} catch (err) {
			console.error("[SSE] Error writing to client:", err);
			failed.push(client);
		}
	}
	failed.forEach(c => sseClients.delete(c));
	console.log(`[SSE] Broadcast '${event}' to ${sseClients.size} clients`);
}

export function addSSEClient(res) {
	sseClients.add(res);
}

export function removeSSEClient(res) {
	sseClients.delete(res);
}

export function getSSEClientCount() {
	return sseClients.size;
}

export function closeAllSSEClients() {
	for (const client of sseClients) {
		try {
			client.end();
		} catch (err) {
			// Ignore errors on close
		}
	}
	sseClients.clear();
}

export function getNeedsInputQueue() {
	return needsInputQueue;
}

// Item 5: Consolidated queue removal helper
// Webhook uses port-only predicate (completion clears any entry for that port).
// Provide-input uses port+sessionId predicate (specific to the session being answered).
export function removeFromNeedsInputQueue(predicate) {
	const idx = needsInputQueue.findIndex(predicate);
	if (idx !== -1) {
		needsInputQueue.splice(idx, 1);
		return true;
	}
	return false;
}

export function addToNeedsInputQueue(inputRequest) {
	needsInputQueue.push(inputRequest);
}
