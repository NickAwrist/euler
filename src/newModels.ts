export const NEW_MODEL_DAYS = 21;

export function isNewModel(created: number, now = Date.now()): boolean {
  const age = now / 1000 - created;
  return age >= 0 && age <= NEW_MODEL_DAYS * 24 * 60 * 60;
}
