import express from 'express'
import cors from 'cors'
import { Coordinator } from './Coordinator.js'
import dotenv from 'dotenv'
import { auditLog, getRecentHistory, isEventProcessed, markEventProcessed } from "./db.js";
dotenv.config()
const app = express()

app.use(cors())
app.use(express.json())
app.use(express.static('public'))


const junctionA = new Coordinator("A")


setInterval(() => {
    junctionA.tick()
}, 1000)

app.get('/api/junctions/:id/status', async (req, res) => {
    const { params } = req
    const status = await junctionA.execute(engine => {
        return {
            junction_id: engine.id,
            mode: engine.mode,
            phase: engine.phase,
            controller_status: engine.controllerStatus,
            desired_signals: engine.desiredSignals,
            actual_signals: engine.actualSignals,
            queues: engine.queues,
            manual_timeout_remaining: engine.manualOverrideTimeout,
            pending_commands_count: junctionA.pendingCommands.size
        }
    })

    res.json(status)
})

app.post('/api/sensor-events', async (req, res) => {
    const { event_id, junction_id, direction, event_type, vehicle_id, vehicle_type } = req.body;
    if (!event_id || !direction || !event_type) {
        return res.status(400).json({ error: 'Missing required event fields' });
    }

    if (isEventProcessed(event_id)) {
        auditLog(junction_id || 'A', 'DUPLICATE_EVENT_DROPPED', { event_id });
        return res.status(200).json({ message: 'Duplicate event ignored (idempotent)', event_id });
    }

    try {
        await junctionA.execute(engine => {
            if (event_type === 'VEHICLE_ARRIVED') {
                engine.addVehicle(direction, vehicle_type || 'EMPLOYEE_VEHICLE', vehicle_id || 'VH-UNKNOWN');
                auditLog(junction_id || 'A', 'VEHICLE_ARRIVED', { vehicle_id, vehicle_type, direction });
            } else if (event_type === 'VEHICLE_CLEARED') {
                engine.clearVehicle(direction, vehicle_id);
                auditLog(junction_id || 'A', 'VEHICLE_CLEARED', { vehicle_id, direction });
            }
        });

        markEventProcessed(event_id);
        res.status(201).json({ success: true, event_id });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
})


app.post('/api/junctions/:id/commands', async (req, res) => {
    try {
        const { command, actual_state, direction } = req.body;
        await junctionA.execute(engine => {
            if (command === 'MANUAL_GREEN_REQUEST') {
                if (!direction) throw new Error('Direction required for MANUAL_GREEN_REQUEST');
                engine.requestManualGreen(direction);
                auditLog(engine.id, 'MANUAL_OVERRIDE_TRIGGERED', { direction });
            } else if (command === 'RETURN_TO_AUTOMATIC') {
                engine.returnToAutomatic();
                auditLog(engine.id, 'RETURN_TO_AUTOMATIC', {});
            } else {
                throw new Error(`Unsupported command: ${command}`);
            }
        });
        res.json({ success: true, command });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});


app.post('/api/controller-events', async (req, res) => {
    const { command_id, status, actual_state } = req.body;

    const result = await junctionA.handleAck(command_id, actual_state, status || 'ACK');
    res.json(result);
});


app.get('/api/junctions/:id/history', (req, res) => {
    const logs = getRecentHistory(req.params.id);
    res.json(logs);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Running at http://localhost:${PORT}`);
});