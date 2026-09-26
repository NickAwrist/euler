import { describe, expect, test } from "bun:test";
import { type ChatInsetsInput, chatInsets } from "../../ui/lib/chatInsets";

// A 768px chat column centered in a 1440px window spans 336px to 1104px.
const closed: ChatInsetsInput = {
  viewportWidth: 1440,
  chatMaxWidth: 768,
  chatList: { open: false, makeRoom: false },
  artifacts: { open: false, width: 560, makeRoom: false },
};
const listOpen = { open: true, makeRoom: false };
const artifactsOpen = { open: true, width: 560, makeRoom: false };

describe("chat insets", () => {
  test("panels that fit beside the chat leave it in place", () => {
    expect(chatInsets({ ...closed, chatList: listOpen })).toEqual({
      left: 0,
      right: 0,
    });
    expect(
      chatInsets({
        ...closed,
        viewportWidth: 2560,
        chatList: listOpen,
        artifacts: artifactsOpen,
      }),
    ).toEqual({ left: 0, right: 0 });
  });

  test("a panel that would cover the chat nudges it only far enough to clear it", () => {
    // The panel starts at 880px, so the column must end by 860px: 244px left.
    const insets = chatInsets({ ...closed, artifacts: artifactsOpen });
    expect(insets).toEqual({ left: 0, right: 488 });
    const mainWidth = 1440 - insets.left - insets.right;
    const columnStart = insets.left + (mainWidth - 768) / 2;
    expect(columnStart).toBe(336 - 244);
  });

  test("the column narrows between panels only when it cannot fit", () => {
    expect(
      chatInsets({ ...closed, chatList: listOpen, artifacts: artifactsOpen }),
    ).toEqual({ left: 260, right: 560 });
    expect(
      chatInsets({
        ...closed,
        chatMaxWidth: Number.POSITIVE_INFINITY,
        chatList: listOpen,
      }),
    ).toEqual({ left: 260, right: 0 });
  });

  test("make room reserves the full panel width even when it would fit", () => {
    expect(
      chatInsets({ ...closed, chatList: { open: true, makeRoom: true } }),
    ).toEqual({ left: 260, right: 0 });
    expect(
      chatInsets({
        ...closed,
        chatList: { open: false, makeRoom: true },
        artifacts: { ...artifactsOpen, makeRoom: true },
      }),
    ).toEqual({ left: 0, right: 560 });
  });
});
