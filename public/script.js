let lastDesiredSignature = '';
let lastAckedCommandId = null;

// Update light visual bulb
function updateLightBulb(dir, color) {
    ['RED', 'YELLOW', 'GREEN'].forEach(c => {
        const el = document.getElementById(`${dir}-${c}`);
        if (el) {
            el.className = (c === color) ? `lamp active-${c.toLowerCase()}` : 'lamp';
        }
    });
}

// Fetch and sync UI with backend
async function refreshStatus() {
    try {
        const res = await fetch('/api/junctions/A/status');
        if (!res.ok) return;
        const data = await res.json();

        // 1. Metadata badges
        document.getElementById('badge-mode').innerText = data.mode;
        document.getElementById('val-phase').innerText = data.phase;

        const ctrlBadge = document.getElementById('badge-ctrl');
        ctrlBadge.innerText = 'CONTROLLER: ' + data.controller_status;
        ctrlBadge.className = data.controller_status === 'ONLINE' ? 'badge badge-online' : 'badge badge-offline';

        // 2. Queue tags
        document.getElementById('badge-qN').innerText = 'Q: ' + data.queues.NORTH;
        document.getElementById('badge-qS').innerText = 'Q: ' + data.queues.SOUTH;
        document.getElementById('badge-qE').innerText = 'Q: ' + data.queues.EAST;
        document.getElementById('badge-qW').innerText = 'Q: ' + data.queues.WEST;

        // 3. Text diagnostics
        document.getElementById('text-desired').innerText =
            `N:${data.desired_signals.NORTH[0]} S:${data.desired_signals.SOUTH[0]} E:${data.desired_signals.EAST[0]} W:${data.desired_signals.WEST[0]}`;

        document.getElementById('text-actual').innerText =
            `N:${data.actual_signals.NORTH[0]} S:${data.actual_signals.SOUTH[0]} E:${data.actual_signals.EAST[0]} W:${data.actual_signals.WEST[0]}`;

        // 4. Update physical bulbs
        updateLightBulb('N', data.actual_signals.NORTH);
        updateLightBulb('S', data.actual_signals.SOUTH);
        updateLightBulb('E', data.actual_signals.EAST);
        updateLightBulb('W', data.actual_signals.WEST);

        // 5. Hardware Controller Auto-ACK Simulator
        const currentSignature = JSON.stringify(data.desired_signals);
        const autoAckEnabled = document.getElementById('auto-ack-toggle').checked;

        if (autoAckEnabled && currentSignature !== lastDesiredSignature && data.pending_commands_count > 0) {
            lastDesiredSignature = currentSignature;
            simulateControllerAck();
        }

    } catch (err) {
        console.error('Error syncing status:', err);
    }
}

// Emulate physical traffic signal confirming desired light change
async function simulateControllerAck() {
    try {
        const logRes = await fetch('/api/junctions/A/history');
        if (!logRes.ok) return;
        const logs = await logRes.json();
        const latestCmd = logs.find(l => l.event_type === 'SIGNAL_REQUESTED');

        if (latestCmd) {
            const details = JSON.parse(latestCmd.details);
            // Skip if this command has already been ACKed to prevent duplicate command errors
            if (details.commandId === lastAckedCommandId) return;

            lastAckedCommandId = details.commandId;
            await fetch('/api/controller-events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    command_id: details.commandId,
                    junction_id: 'A',
                    status: 'ACK',
                    actual_state: details.desired
                })
            });
        }
    } catch (e) {
        console.error('Failed to ACK controller command:', e);
    }
}

// Fetch and render DB audit logs
async function refreshLogs() {
    try {
        const res = await fetch('/api/junctions/A/history');
        if (!res.ok) return;
        const logs = await res.json();
        const formatted = logs.map(l => `[${l.timestamp}] ${l.event_type.padEnd(25)} -> ${l.details}`).join('\n');
        document.getElementById('audit-log').innerText = formatted || 'No events recorded yet.';
    } catch (err) {
        console.error('Error fetching logs:', err);
    }
}

// --- ACTION DISPATCHERS ---

async function addVehicle(direction) {
    const vehicleTypeSelect = document.getElementById('vehicle-type');
    const vehicleType = vehicleTypeSelect ? vehicleTypeSelect.value : 'EMPLOYEE_VEHICLE';
    const eventId = 'evt-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const vehicleId = 'VH-' + Math.floor(Math.random() * 900 + 100);

    await fetch('/api/sensor-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            event_id: eventId,
            junction_id: 'A',
            direction: direction,
            event_type: 'VEHICLE_ARRIVED',
            vehicle_id: vehicleId,
            vehicle_type: vehicleType,
            sequence_no: Date.now(),
            timestamp: new Date().toISOString()
        })
    });

    refreshStatus();
    refreshLogs();
}

async function clearVehicle(direction) {
    const eventId = 'clr-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

    await fetch('/api/sensor-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            event_id: eventId,
            junction_id: 'A',
            direction: direction,
            event_type: 'VEHICLE_CLEARED',
            sequence_no: Date.now(),
            timestamp: new Date().toISOString()
        })
    });

    refreshStatus();
    refreshLogs();
}

async function requestManual(direction) {
    await fetch('/api/junctions/A/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            command: 'MANUAL_GREEN_REQUEST',
            direction: direction
        })
    });

    refreshStatus();
    refreshLogs();
}

async function returnAuto() {
    await fetch('/api/junctions/A/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            command: 'RETURN_TO_AUTOMATIC'
        })
    });

    refreshStatus();
    refreshLogs();
}

// Event Listeners for clean DOM separation
document.addEventListener('DOMContentLoaded', () => {
    // Vehicle additions
    document.getElementById('btn-add-north').addEventListener('click', () => addVehicle('NORTH'));
    document.getElementById('btn-add-south').addEventListener('click', () => addVehicle('SOUTH'));
    document.getElementById('btn-add-east').addEventListener('click', () => addVehicle('EAST'));
    document.getElementById('btn-add-west').addEventListener('click', () => addVehicle('WEST'));

    // Vehicle removals
    document.getElementById('btn-clear-north').addEventListener('click', () => clearVehicle('NORTH'));
    document.getElementById('btn-clear-south').addEventListener('click', () => clearVehicle('SOUTH'));
    document.getElementById('btn-clear-east').addEventListener('click', () => clearVehicle('EAST'));
    document.getElementById('btn-clear-west').addEventListener('click', () => clearVehicle('WEST'));

    // Manual actions
    document.getElementById('btn-manual-north').addEventListener('click', () => requestManual('NORTH'));
    document.getElementById('btn-manual-east').addEventListener('click', () => requestManual('EAST'));
    document.getElementById('btn-auto-return').addEventListener('click', returnAuto);

    // Sync intervals
    setInterval(refreshStatus, 1000);
    setInterval(refreshLogs, 2500);

    refreshStatus();
    refreshLogs();
});