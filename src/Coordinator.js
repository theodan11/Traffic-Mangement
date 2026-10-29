import { TrafficEngine } from "./TrafficEngine.js"
import { auditLog, loadJunction, saveJunction } from "./db.js";

import PQueue from 'p-queue';
export class Coordinator {
    constructor(junctionId) {
        this.junctionId = junctionId
        const persistedData = loadJunction(junctionId)
        this.engine = new TrafficEngine(junctionId, persistedData)

        this.queue = new PQueue({ concurrency: 1 })
        this.pendingCommands = new Map()
    }

    async execute(actionFn) {
        return this.queue.add(async () => {
            const prevDesired = JSON.stringify(this.engine.desiredSignals)
            const result = await actionFn(this.engine)

            if (prevDesired !== JSON.stringify(this.engine.desiredSignals)) {
                this.dispatchControllerCommand()
            }

            saveJunction(this.engine)
            return result
        })
    }


    dispatchControllerCommand() {
        const commandId = `cmd-${Date.now()}-${Math.floor(Math.random() * 1000)}`
        auditLog(this.junctionId, 'SIGNAL_REQUESTED', {
            commandId,
            desired: this.engine.desiredSignals
        })

        const timer = setTimeout(() => {
            if (this.pendingCommands.has(commandId)) {
                this.pendingCommands.delete(commandId)
                this.handleCommandTimeout(commandId)
            }
        }, 5000)
        this.pendingCommands.set(commandId, { timer, requested: { ...this.engine.desiredSignals } })
        return commandId
    }

    handleAck(commandId, actualState, status) {
        return this.execute((engine) => {
            const pending = this.pendingCommands.get(commandId);
            if (!pending) {
                auditLog(this.junctionId, "ACK_REJECTED", { commandId, reason: "EXPIRED_OR_UNKNOWN" });
                return { success: false, reason: "EXPIRED_OR_UNKNOWN" };
            }

            clearTimeout(pending.timer);
            this.pendingCommands.delete(commandId);

            if (status === "ACK") {
                engine.controllerStatus = "ONLINE";
                engine.actualSignals = actualState || { ...engine.desiredSignals };
                auditLog(this.junctionId, "SIGNAL_CONFIRMED", { commandId, actualSignals: engine.actualSignals });
                return { success: true };
            } else {
                this.handleFailure("CONTROLLER_REPORTED_FAILURE");
                return { success: false };
            }
        });
    }

    handleCommandTimeout(commandId) {
        this.execute((engine) => {
            auditLog(this.junctionId, "CONTROLLER_TIMEOUT", { commandId })
            this.handleFailure("ACK_TIMEOUT")
        })
    }

    handleFailure(reason) {
        this.engine.mode = "DEGRADED"
        this.engine.controllerStatus = "OFFLINE"

        this.engine.desiredSignals = {
            NORTH: "RED",
            SOUTH: "RED",
            EAST: "RED",
            WEST: "RED",
        }
        this.engine.actualSignals = {
            NORTH: "RED",
            SOUTH: "RED",
            EAST: "RED",
            WEST: "RED",
        }

        auditLog(this.junctionId, "ENTERED_DEGRADED_MODE", { reason })
    }

    tick() {
        return this.execute((engine) => {
            engine.tick()
        })
    }
}