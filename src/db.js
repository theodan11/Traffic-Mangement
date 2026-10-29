import Database from "better-sqlite3";


const db = new Database("traffic_system.db")


db.exec(`
    CREATE TABLE IF NOT EXISTS processed_events (
        event_id TEXT PRIMARY KEY,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS junctions (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        phase TEXT NOT NULL,
        controller_status TEXT NOT NULL,
        desired_signals TEXT NOT NULL,
        actual_signals TEXT NOT NULL,
        queues TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        junction_id TEXT NOT NULL,
        event_type TEXT NOT NULL, 
        details TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`)


export const loadJunction = (id) => {
    const row = db.prepare('SELECT * FROM junctions WHERE id = ?').get(id)
    if (!row) return null

    return {
        id: row.id,
        mode: row.mode,
        phase: row.phase,
        controllerStatus: row.controller_status,
        desiredSignals: JSON.parse(row.desired_signals),
        actualSignals: JSON.parse(row.actual_signals),
        queues: JSON.parse(row.queues)
    }
}

export const markEventProcessed = (eventid) => {
    db.prepare('INSERT INTO processed_events (event_id) VALUES(?)').run(eventid)
}

export const saveJunction = (junction) => {
    const stmt = db.prepare(`
        INSERT INTO junctions (
            id, 
            mode, 
            phase, 
            controller_status, 
            desired_signals,
            actual_signals,
            queues, 
            updated_at
        )

        VALUES(
            @id, 
            @mode, 
            @phase, 
            @controller_status, 
            @desired_signals,
            @actual_signals,
            @queues, 
            CURRENT_TIMESTAMP
        )

        ON CONFLICT(id) DO UPDATE SET
            mode = excluded.mode,
            phase = excluded.phase,
            controller_status = excluded.controller_status,
            desired_signals = excluded.desired_signals,
            actual_signals = excluded.actual_signals,
            queues = excluded.queues,
            updated_at = CURRENT_TIMESTAMP
    `)

    stmt.run({
        id: junction.id,
        mode: junction.mode,
        phase: junction.phase,
        controller_status: junction.controllerStatus,
        desired_signals: JSON.stringify(junction.desiredSignals),
        actual_signals: JSON.stringify(junction.actualSignals),
        queues: JSON.stringify(junction.queues),

    })
}


export const getRecentHistory = (junctionId, limit = 20) => {
    return db.prepare('SELECT * FROM audit_logs WHERE junction_id = ? ORDER BY id DESC LIMIT ?').all(junctionId, limit)
}

export const auditLog = (junctionId, eventType, details) => {
    const stmt = db.prepare(`
        INSERT INTO audit_logs (junction_id, event_type, details)
        VALUES(?, ?, ?)
    `)
    stmt.run(junctionId, eventType, JSON.stringify(details))
}

export const isEventProcessed = (eventId) => {
    const row = db.prepare('SELECT * FROM processed_events WHERE event_id = ? ').get(eventId)
    return !!row
}

export default db
