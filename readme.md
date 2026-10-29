# Industrial Garment Factory Traffic Management System (Junction A)

Autonomous, event-driven traffic signal management system for an industrial garment factory campus. Built with Node.js, Express, SQLite (`better-sqlite3`), and vanilla JavaScript.

---

## 1. Setup and Run Instructions

### Prerequisites
* **Node.js**: v18.0.0 or higher
* **npm**: v9.0.0 or higher

### Installation
1. Clone or extract the repository:
   ```bash
   cd factory-traffic-control
   ```

2. Install runtime and development dependencies:
   ```bash
   npm install
   ```

   *Core dependencies: `express`, `cors`, `dotenv`, `better-sqlite3`, `p-queue`.*

3. Set up environment variables (optional, defaults provided):
   Create a `.env` file in the project root:
   ```env
   PORT=3000
   ```

### Running the Application
* **Start the server:**
  ```bash
  npm start
  # Or: node src/server.js
  ```
* **Development mode (auto-reload):**
  ```bash
  npm run dev
  ```
* **Access Dashboard:**
  Open your web browser and navigate to:
  ```
  http://localhost:3000
  ```

---

## 2. Database Schema & Persistence

The project uses embedded SQLite via `better-sqlite3` with Write-Ahead Logging (`WAL` mode) for reliable transactional persistence. Database file: `traffic_system.db`.

```sql
-- Idempotency table: tracks processed sensor events to discard duplicates
CREATE TABLE IF NOT EXISTS processed_events (
    event_id TEXT PRIMARY KEY,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Junction persistent state table
CREATE TABLE IF NOT EXISTS junctions (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    phase TEXT NOT NULL,
    controller_status TEXT NOT NULL,
    desired_signals TEXT NOT NULL,  -- JSON serialized object
    actual_signals TEXT NOT NULL,   -- JSON serialized object
    queues TEXT NOT NULL,           -- JSON serialized object
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Append-only audit trail
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    junction_id TEXT NOT NULL,
    event_type TEXT NOT NULL, 
    details TEXT NOT NULL,          -- JSON serialized payload
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. API Documentation

### 3.1 Junction Endpoints
* **`GET /api/junctions`**
  * Returns a list of all active junction IDs.
* **`GET /api/junctions/:id/status`**
  * Returns real-time junction diagnostic state, including `phase`, `mode`, `controller_status`, `desired_signals`, `actual_signals`, and `queues`.
* **`GET /api/junctions/:id/history?limit=50`**
  * Retrieves the most recent append-only audit trail logs.

### 3.2 Sensor Ingestion (Idempotent)
* **`POST /api/sensor-events`**
  * **Headers:** `Content-Type: application/json`
  * **Payload:**
    ```json
    {
      "event_id": "evt-101",
      "junction_id": "A",
      "direction": "NORTH",
      "event_type": "VEHICLE_ARRIVED",
      "vehicle_id": "VH-502",
      "vehicle_type": "TRUCK"
    }
    ```
  * **Supported `vehicle_type`:** `EMERGENCY` (1000), `TRUCK` (10), `FORKLIFT` (5), `EMPLOYEE_VEHICLE` (1).
  * **Supported `event_type`:** `VEHICLE_ARRIVED`, `VEHICLE_CLEARED`.
  * **Behavior:** Re-submitting an identical `event_id` returns HTTP 200 with an idempotency acknowledgment and does not alter internal queues.

### 3.3 Administrative Override
* **`POST /api/junctions/:id/commands`**
  * **Payload (Manual Green):**
    ```json
    {
      "command": "MANUAL_GREEN_REQUEST",
      "direction": "NORTH"
    }
    ```
  * **Payload (Return to Auto):**
    ```json
    {
      "command": "RETURN_TO_AUTOMATIC"
    }
    ```

### 3.4 Hardware Controller Interface
* **`POST /api/controller-events`**
  * **Payload:**
    ```json
    {
      "command_id": "cmd-173019300-512",
      "junction_id": "A",
      "status": "ACK",
      "actual_state": {
        "NORTH": "GREEN",
        "SOUTH": "GREEN",
        "EAST": "RED",
        "WEST": "RED"
      }
    }
    ```

---

## 4. Traffic-Control Algorithm

The signal selection uses a dynamic, priority-weighted queue scoring formula:

$$\text{Score}(\text{Axis}) = \sum_{v \in \text{Axis Vehicles}} \left( \text{PriorityWeight}(v) + 0.5 \times \text{WaitTimeSeconds}(v) \right)$$

1. **Priority Weights**:
   * `EMERGENCY`: $1000$ (Instant preemption)
   * `TRUCK`: $10$ (High factory throughput)
   * `FORKLIFT`: $5$ (Internal logistics)
   * `EMPLOYEE_VEHICLE`: $1$ (Standard commuter)
2. **Anti-Starvation**:
   * Every second a vehicle waits, it earns $+0.5$ points. Low-priority vehicles waiting prolonged periods will eventually outscore newly arrived high-priority vehicles, preventing lockouts.
3. **Emergency Preemption**:
   * When an `EMERGENCY` vehicle arrives on an axis, the engine immediately initiates a transition toward that axis, truncating the minimum green timer while preserving physical clearance buffers.

---

## 5. Traffic-State Transitions

Transitions strictly enforce physical clearance rules to eliminate vehicle collision risks:

```
[ NORTH_SOUTH_GREEN ] (Min green: 10s)
         │
         ▼ (Opposing queue demands passage)
[ NORTH_SOUTH_YELLOW ] (Mandatory 5s buffer)
         │
         ▼
[ ALL_RED ] (Mandatory 2s clearance buffer)
         │
         ▼
[ EAST_WEST_GREEN ] (Min green: 10s)
         │
         ▼
[ EAST_WEST_YELLOW ] (Mandatory 5s buffer)
         │
         ▼
[ ALL_RED ] (Mandatory 2s clearance buffer)
```

* **No direct switches:** The engine strictly forbids transitioning directly from `GREEN` $\to$ `GREEN` across opposing directions.
* **Degraded Fallback:** If the physical hardware controller fails to acknowledge an instruction within 5 seconds, the watchdog shifts the mode to `DEGRADED` and locks all signals to `ALL_RED`.

---

## 6. Demonstration Scenarios

Launch `http://localhost:3000` to run these scenarios through the interactive dashboard:

### Scenario 1: Autonomous Dynamic Transition
1. Observe the default state: `NORTH_SOUTH` or `EAST_WEST` green.
2. Select **Heavy Delivery Truck (Priority 10)** from the dropdown.
3. Click **`+ East`**.
4. Observe the state transition:
   * Current green axis turns `YELLOW` for 5 seconds.
   * All directions enter `ALL_RED` for 2 seconds.
   * `EAST_WEST` receives `GREEN`.

### Scenario 2: Emergency Vehicle Preemption
1. While `EAST_WEST` is green, select **Emergency Vehicle (Priority 1000)**.
2. Click **`+ North`**.
3. Observe immediate preemption: `EAST_WEST` shifts to `YELLOW` (5s), enters `ALL_RED` (2s), and grants `GREEN` to North/South.
4. Click **`- North`** to clear the emergency vehicle; the system returns to `AUTOMATIC` evaluation.

### Scenario 3: Watchdog Timeout & Degraded Fallback
1. Uncheck **"Auto-Acknowledge Hardware Commands"**.
2. Click **`+ East`** to trigger a signal change request.
3. Do not acknowledge. Wait 5 seconds.
4. Observe:
   * Watchdog timer fires `ACK_TIMEOUT`.
   * Controller status changes to `OFFLINE`.
   * Mode transitions to `DEGRADED`.
   * All directions drop into safe `ALL_RED`.

### Scenario 4: Idempotent Event Delivery
1. Open terminal and run duplicate curl commands:
   ```bash
   curl -X POST http://localhost:3000/api/sensor-events \
     -H "Content-Type: application/json" \
     -d '{"event_id":"duplicate-test-1","junction_id":"A","direction":"NORTH","event_type":"VEHICLE_ARRIVED","vehicle_id":"VH-1"}'
   ```
2. Send the exact same command a second time.
3. Observe terminal / audit log: The second call returns `Duplicate event ignored (idempotent)` and queue count increases by only 1.

---

## 7. Testing

Automated integration tests can be executed via Node.js test runner:

```bash
npm test
```

### Key Test Scenarios Covered
* **Safety Invariant Check:** Conflicting phases (`NORTH` and `EAST`) are never simultaneously green.
* **Yellow Buffer Enforcement:** Verified 5-second hold before `ALL_RED`.
* **All-Red Clearance Hold:** Verified 2-second hold before the next green phase.
* **Idempotency Verification:** Submitting identical `event_id` values does not cause duplicate queue mutations.
* **Watchdog Timeout:** System switches to `DEGRADED` and `ALL_RED` when ACK is missing after 5000ms.

---

## 8. Assumptions / Questions / Requirement Issues

1. **Junction Scope:** Core requirements centered on Junction A. The architecture uses dynamic coordinator maps (`junction_map.get(id)`), allowing Junctions B, C, and D to be added without domain refactoring.
2. **Network Protocol (REST vs. MQTT):** In an industrial facility, edge sensors frequently publish over MQTT. For this web evaluation, HTTP REST endpoints were chosen to provide a frictionless local setup without requiring a dedicated Mosquitto/RabbitMQ broker.
3. **Clock Granularity:** A 1-second discrete clock pulse (`tick()`) was implemented, balancing responsive UI feedback and state countdown precision without unnecessary CPU load.

---

## 9. Major Architectural Decisions

* **Hexagonal Architecture (Ports and Adapters):**
  * `TrafficEngine.js`: Pure deterministic state machine. No database or HTTP dependencies.
  * `Coordinator.js`: Application orchestrator handling serialization and hardware timeouts.
  * `db.js`: Persistence layer using SQLite for atomic persistence.
  * `server.js`: Thin HTTP controller routing external requests to domain adapters.
* **Single-Queue Concurrency Serialization (`p-queue`):**
  * Node.js is single-threaded, but concurrent asynchronous I/O can cause race conditions during state evaluation. Setting `concurrency: 1` per junction serializes all mutations, completely preventing race conditions.
* **Closed-Loop Hardware ACKs (Split-Brain Prevention):**
  * Distinguishes `desiredSignals` (intent) from `actualSignals` (hardware-confirmed reality). The backend never assumes an intersection is green until the physical controller returns a verified `command_id` ACK.

---

## 10. AI / Tool Usage

* **Model Used:** Gemini 3 Flash.
* **Usage Summary:** 
  * Brainstorming state-machine transition structures.
  * Refining the mathematical starvation scoring equation.
  * Debugging SQLite UPSERT syntax and `p-queue` integration.
  * Generating testing edge-case checklists.