// Client-safe surface: domain types + the pure sample generator.
// The DB projector lives in ./project and must only be imported server-side.
export * from "./types";
export { generateKnowledgeGraph } from "./generate";
