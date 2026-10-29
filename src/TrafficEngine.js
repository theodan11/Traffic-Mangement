export const PHASES = {
    NORTH_SOUTH_GREEN: "NORTH_SOUTH_GREEN",
    NORTH_SOUTH_YELLOW: "NORTH_SOUTH_YELLOW",
    ALL_RED: "ALL_RED",
    EAST_WEST_GREEN: "EAST_WEST_GREEN",
    EAST_WEST_YELLOW: "EAST_WEST_YELLOW"
}

export const VEHICLE_PRIORITIES = {
    EMERGENCY: 1000,
    TRUCK: 10,
    FORKLIFT: 5,
    EMPLOYEE_VEHICLE: 1
}

export class TrafficEngine {
    constructor(id, savedStatus = null) {
        this.id = id
        this.mode = savedStatus?.mode || "AUTOMATIC"
        this.phase = savedStatus?.phase || PHASES.ALL_RED
        this.controllerStatus = savedStatus?.controllerStatus || "ONLINE"

        this.desiredSignals = {
            NORTH: "RED",
            SOUTH: "RED",
            EAST: "RED",
            WEST: "RED",
        }
        this.actualSignals = {
            NORTH: "RED",
            SOUTH: "RED",
            EAST: "RED",
            WEST: "RED",
        }

        this.vehicles = {
            NORTH: [],
            SOUTH: [],
            EAST: [],
            WEST: [],
        }
        this.queues = savedStatus?.queues || {
            NORTH: 0,
            SOUTH: 0,
            EAST: 0,
            WEST: 0,
        }

        this.phaseTimeRemaining = 0
        this.manualOverrideTimeout = 0
        this.targetNextPhase = null
    }

    addVehicle(direction, vehicleType, vehicleId) {
        if (!this.vehicles[direction]) throw new Error(`Invalid direction: ${direction}`)

        this.vehicles[direction].push({
            vehicleId,
            vehicleType,
            arrivedAt: Date.now()
        })

        this.queues[direction] = this.vehicles[direction].length

        if (vehicleType === "EMERGENCY") {
            this.triggerEmergency(direction)
        }
    }

    clearVehicle(direction, vehicleId) {
        if (!this.vehicles[direction]) throw new Error(`Invalid direction: ${direction}`)

        const index = this.vehicles[direction].findIndex(v => v.vehicleId === vehicleId)
        if (index !== -1) {
            this.vehicles[direction].splice(index, 1)
        } else if (this.vehicles[direction].length > 0) {
            this.vehicles[direction].shift()
        }
        this.queues[direction] = Math.max(0, this.vehicles[direction].length)
    }

    calculateScore(directions) {
        let score = 0
        const now = Date.now()

        for (const d of directions) {
            for (const v of this.vehicles[d]) {
                const priorityWeight = VEHICLE_PRIORITIES[v.vehicleType] || 1
                const weightScore = (now - v.arrivedAt) / 1000
                score += priorityWeight + (weightScore * 0.5)
            }
        }

        return score
    }

    triggerEmergency(direction) {
        this.mode = "EMERGENCY"
        const emergencyPhase = (direction === "NORTH" || direction === "SOUTH") ? PHASES.NORTH_SOUTH_GREEN : PHASES.EAST_WEST_GREEN

        if (this.phase !== emergencyPhase) {
            this.startTransition(emergencyPhase)
        }
    }

    startTransition(targetPhase) {
        this.targetNextPhase = targetPhase

        if (this.phase === PHASES.NORTH_SOUTH_GREEN) {
            this.phase = PHASES.NORTH_SOUTH_YELLOW
            this.phaseTimeRemaining = 5
            this.desiredSignals = {
                NORTH: "YELLOW",
                SOUTH: "YELLOW",
                EAST: "RED",
                WEST: "RED",
            }
        } else if (this.phase === PHASES.EAST_WEST_GREEN) {
            this.phase = PHASES.EAST_WEST_YELLOW
            this.phaseTimeRemaining = 5
            this.desiredSignals = {
                NORTH: "RED",
                SOUTH: "RED",
                EAST: "YELLOW",
                WEST: "YELLOW",
            }
        } else {
            this.phase = PHASES.ALL_RED
            this.desiredSignals = {
                NORTH: "RED",
                SOUTH: "RED",
                EAST: "RED",
                WEST: "RED",
            }
            this.phaseTimeRemaining = 2
        }
    }


    requestManualGreen(direction) {
        this.mode = "MANUAL"
        this.manualOverrideTimeout = 30
        const target = (direction === "NORTH" || direction === "SOUTH") ? PHASES.NORTH_SOUTH_GREEN : PHASES.EAST_WEST_GREEN

        if (this.phase !== target) {
            this.startTransition(target)
        }

    }

    returnToAutomatic() {
        this.mode = "AUTOMATIC"
        this.manualOverrideTimeout = 0
    }

    tick() {
        if (this.mode === "MANUAL") {
            this.manualOverrideTimeout--
            if (this.manualOverrideTimeout <= 0) {
                this.returnToAutomatic()
            }
        }

        if (this.phaseTimeRemaining > 0) {
            this.phaseTimeRemaining--
            return
        }

        if (this.phase === PHASES.NORTH_SOUTH_YELLOW || this.phase === PHASES.EAST_WEST_YELLOW) {
            this.phase = PHASES.ALL_RED
            this.phaseTimeRemaining = 2
            this.desiredSignals = {
                NORTH: "RED",
                SOUTH: "RED",
                EAST: "RED",
                WEST: "RED",
            }

            return
        }

        if (this.phase === PHASES.ALL_RED && this.targetNextPhase) {
            this.phase = this.targetNextPhase
            this.targetNextPhase = null
            if (this.phase === PHASES.NORTH_SOUTH_GREEN) {
                this.desiredSignals = {
                    NORTH: "GREEN",
                    SOUTH: "GREEN",
                    EAST: "RED",
                    WEST: "RED",
                }
            } else {
                this.desiredSignals = {
                    NORTH: "RED",
                    SOUTH: "RED",
                    EAST: "GREEN",
                    WEST: "GREEN",
                }
            }
            this.phaseTimeRemaining = 10
        }

        if (this.mode === "AUTOMATIC") {
            const nsScore = this.calculateScore(["NORTH", "SOUTH"])
            const ewScore = this.calculateScore(["EAST", "WEST"])

            if (this.phase === PHASES.NORTH_SOUTH_GREEN && ewScore > nsScore && ewScore > 0) {
                this.startTransition(PHASES.EAST_WEST_GREEN)
            } else if (this.phase === PHASES.EAST_WEST_GREEN && nsScore > ewScore && nsScore > 0) {
                this.startTransition(PHASES.NORTH_SOUTH_GREEN)
            } else if (this.phase === PHASES.ALL_RED && !this.targetNextPhase) {
                this.startTransition(ewScore > nsScore ? PHASES.EAST_WEST_GREEN : PHASES.NORTH_SOUTH_GREEN);
            }
        }
    }
}