// Sentinel Neural Engine — Phase A barrel.
// See docs/neural-engine/PHASE_A_CONFLICTS.md for what's real vs. deferred.

export * as knowledgeService from "./knowledge-service";
export * as experienceService from "./experience-service";
export * as evaluationService from "./evaluation-service";
export * as learningService from "./learning-service";
export * as agentProfileService from "./agent-profile-service";
export * as contradictionService from "./contradiction-service";
export * as skillService from "./skill-service";
export * as temporalService from "./temporal-service";
export * as eventService from "./event-service";
export * as policyService from "./policy-service";
// retrieval-planner intentionally NOT re-exported here — importing it
// directly makes the Phase C NotImplementedYet boundary explicit at the
// call site rather than hidden behind a barrel.

export * from "./types";
