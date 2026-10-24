export const WAKE_PHRASE = "Hey Hawkeye";

// "Hey Hawkeye" (speech-to-text also writes "hawk eye" or "hawkeyes"); the earlier "Hey World" still wakes it.
const WAKE = /\b(?:hey|hi|hay|okay|ok)[\s,.!-]*(?:hawk[\s-]*eyes?|worlds?(?:[\s-]*state)?)\b[\s,.!?-]*/i;

export function matchWake(text: string): { woke: boolean; rest: string } {
  const match = WAKE.exec(text);
  if (!match) return { woke: false, rest: "" };
  return { woke: true, rest: text.slice(match.index + match[0].length).trim() };
}

export function hasWords(text: string, min = 2) {
  return text.split(/\s+/).filter((word) => /\p{L}/u.test(word)).length >= min;
}
