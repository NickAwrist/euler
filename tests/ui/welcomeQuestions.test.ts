import { expect, test } from "bun:test";
import {
  chooseWelcomeQuestion,
  welcomeFirstName,
  welcomeQuestions,
} from "../../ui/components/welcomeQuestions";

test("welcome uses the first name, preserving spelling and rejecting empty names and emails", () => {
  expect(welcomeFirstName("  Nick   Wrist ")).toBe("Nick");
  expect(welcomeFirstName("Anne-Marie Smith")).toBe("Anne-Marie");
  expect(welcomeFirstName("李")).toBe("李");
  expect(welcomeFirstName(" \t ")).toBeNull();
  expect(welcomeFirstName("nick@example.com")).toBeNull();
});

test("welcome starts with the preferred default and recovers from unknown stored values", () => {
  for (const previous of [null, "obsolete"]) {
    expect(chooseWelcomeQuestion("Nick", previous)).toEqual({
      question: welcomeQuestions[0],
      personalized: false,
    });
  }
});

test("welcome avoids repeating a question across both named and unnamed variants", () => {
  for (const previous of welcomeQuestions) {
    for (const value of [0, 0.24, 0.25, 0.5, 0.999]) {
      for (const name of [null, "Nick"]) {
        const result = chooseWelcomeQuestion(name, previous, () => value);
        expect(result.question).not.toBe(previous);
        expect(result.personalized).toBe(name !== null && value < 0.25);
        if (result.personalized)
          expect(welcomeQuestions.slice(1, 4)).toContain(result.question);
      }
    }
  }
});
