// @financial-os/shared
// Shared TS types/constants used by all three apps (ARCHITECTURE.md §7.1).
//
// Document shapes (Transaction, Account, Connection) deliberately are NOT
// re-exported here — those live with their schemas in packages/db, and
// duplicating them would give the repo two competing definitions to drift
// apart. What belongs here is the contract between apps that must not
// import each other: queue names and job payloads, and (XFER-7)
// transferMatching.ts's pure candidate-matching logic, needed by both
// apps/worker's batch job and a new apps/api route.
export * from "./queues.js";
export * from "./transferMatching.js";
