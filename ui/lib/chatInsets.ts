export const CHAT_LIST_WIDTH = 260;
// Horizontal padding around the chat column, also kept clear of open panels.
const CHAT_PADDING = 20;

type Panel = { width: number; open: boolean; makeRoom: boolean };

export type ChatInsetsInput = {
  viewportWidth: number;
  /** Widest the chat column may grow; Infinity fills the available space. */
  chatMaxWidth: number;
  chatList: Omit<Panel, "width">;
  artifacts: Panel;
};

/**
 * Returns the chat's left and right margins on desktop. Panels slide over
 * empty space beside the chat and nudge the column only as far as needed to
 * clear it. A panel set to make room always reserves its full width.
 */
export function chatInsets({
  viewportWidth,
  chatMaxWidth,
  chatList,
  artifacts,
}: ChatInsetsInput): { left: number; right: number } {
  const listWidth = chatList.open ? CHAT_LIST_WIDTH : 0;
  const artifactsWidth = artifacts.open ? artifacts.width : 0;
  const reservedLeft = chatList.makeRoom ? listWidth : 0;
  const reservedRight = artifacts.makeRoom ? artifactsWidth : 0;

  const region = viewportWidth - reservedLeft - reservedRight;
  const naturalWidth = Math.min(chatMaxWidth, region - 2 * CHAT_PADDING);
  const naturalX = reservedLeft + (region - naturalWidth) / 2;

  const clearLeft = listWidth + CHAT_PADDING;
  const clearRight = viewportWidth - artifactsWidth - CHAT_PADDING;
  const width = Math.min(naturalWidth, clearRight - clearLeft);
  const x = Math.min(Math.max(naturalX, clearLeft), clearRight - width);
  if (width === naturalWidth && x === naturalX)
    return { left: reservedLeft, right: reservedRight };

  // A narrowed column hugs the space between the panels. A nudged column is
  // centered in the widest region around its new position.
  const center = x + width / 2;
  const half =
    width < chatMaxWidth
      ? width / 2 + CHAT_PADDING
      : Math.min(center - reservedLeft, viewportWidth - reservedRight - center);
  return { left: center - half, right: viewportWidth - center - half };
}
