export const welcomeQuestions = [
  "What are we working on today?",
  "What's on your mind?",
  "Where should we start?",
  "What would you like to figure out?",
  "What would you like a hand with?",
  "What would you like to explore?",
] as const;

export const WELCOME_QUESTION_KEY = "euler:welcomeQuestion";

export function welcomeFirstName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes("@")) return null;
  return trimmed.split(/\s+/)[0] || null;
}

export function chooseWelcomeQuestion(
  firstName: string | null,
  previous: string | null,
  random = Math.random,
): { question: (typeof welcomeQuestions)[number]; personalized: boolean } {
  // Start with the preferred default, including after an obsolete stored value.
  if (!welcomeQuestions.some((question) => question === previous)) {
    return { question: welcomeQuestions[0], personalized: false };
  }
  const personalized = firstName !== null && random() < 0.25;
  const candidates = (
    personalized ? welcomeQuestions.slice(1, 4) : welcomeQuestions
  ).filter((question) => question !== previous);
  return {
    question: candidates[Math.floor(random() * candidates.length)]!,
    personalized,
  };
}
