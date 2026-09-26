import "../setup";
import { expect, test } from "bun:test";
import { startTestServer, userHeaders } from "../helpers/server";

test("skills CRUD is validated and scoped to the current user", async () => {
  const { url, close } = await startTestServer();
  const otherUser = "22222222-2222-4222-8222-222222222222";
  try {
    const invalid = await fetch(`${url}/api/skills`, {
      method: "POST",
      headers: userHeaders(undefined, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        name: "Bad Skill",
        description: "Invalid name",
        instructions: "Do the thing.",
      }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message:
          "name must use lowercase letters, numbers, and single hyphens only",
      },
    });

    const create = await fetch(`${url}/api/skills`, {
      method: "POST",
      headers: userHeaders(undefined, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        name: "release-notes",
        description: "Draft release notes from merged changes.",
        instructions: "Group changes by user impact.",
      }),
    });
    expect(create.status).toBe(201);
    const skill = (await create.json()) as { id: string; name: string };
    expect(skill).toMatchObject({
      name: "release-notes",
      user_invocable: true,
      disable_model_invocation: false,
    });

    const ownList = await fetch(`${url}/api/skills`, {
      headers: userHeaders(),
    });
    expect(await ownList.json()).toMatchObject({
      skills: [{ id: skill.id, name: "release-notes" }],
    });

    const otherList = await fetch(`${url}/api/skills`, {
      headers: userHeaders(otherUser),
    });
    expect(await otherList.json()).toEqual({ skills: [] });

    const update = await fetch(`${url}/api/skills/${skill.id}`, {
      method: "PUT",
      headers: userHeaders(undefined, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        name: "release-notes",
        description: "Draft concise release notes.",
        instructions: "Lead with user-visible changes.",
        disable_model_invocation: true,
      }),
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({
      id: skill.id,
      instructions: "Lead with user-visible changes.",
      user_invocable: true,
      disable_model_invocation: true,
    });

    const forbiddenDelete = await fetch(`${url}/api/skills/${skill.id}`, {
      method: "DELETE",
      headers: userHeaders(otherUser),
    });
    expect(forbiddenDelete.status).toBe(404);

    const remove = await fetch(`${url}/api/skills/${skill.id}`, {
      method: "DELETE",
      headers: userHeaders(),
    });
    expect(remove.status).toBe(200);
  } finally {
    await close();
  }
});
