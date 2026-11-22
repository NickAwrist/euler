export { getDb, resetDbConnection } from "./connection";
export type { SkillRow } from "./skills/types";
export {
  createSkillRow,
  deleteSkillRow,
  getSkillById,
  getSkillByName,
  listSkills,
  updateSkillRow,
} from "./skills/queries";
export {
  createSessionRow,
  deleteSessionRow,
  getMessagesForSession,
  getSessionById,
  findWorkspaceUser,
  listSessionSummaries,
  patchSessionRow,
  countMessagesForSession,
  appendSessionEvent,
} from "./sessions";
export { ensureUserData } from "./users";
export type {
  SessionRow,
  SessionSummaryRow,
  WireMessage,
  OpenRouterModel,
} from "./types";
export {
  getBraveSearchApiKey,
  setBraveSearchApiKey,
  getOllamaContextWindow,
  getOllamaHost,
  getOpenRouterApiKey,
  getVercelGatewayApiKey,
  setOllamaContextWindow,
  setOllamaHost,
  setOpenRouterApiKey,
  setVercelGatewayApiKey,
} from "./settings";

export {
  listOpenRouterModels,
  getOpenRouterModelByRoute,
} from "./openrouter";
export {
  createImageAttachment,
  deleteAttachment,
  getAttachment,
} from "./attachments";
export type { AttachmentRow } from "./attachments";
