import { safeStorage } from "../lib/safeStorage";
import { getOrCreateUserId } from "./userIdentity";

export function needsOnboarding(): boolean {
  return (
    safeStorage.getItem(`euler:onboarding:${getOrCreateUserId()}`) === "pending"
  );
}
export function completeOnboarding(): void {
  if (
    !safeStorage.setItem(`euler:onboarding:${getOrCreateUserId()}`, "complete")
  ) {
    throw new Error(
      "Could not save setup progress in this browser. Please allow browser storage and try again.",
    );
  }
}
