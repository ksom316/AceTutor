/**
 * FIX 3 — "Clear conversation" is disabled when there is nothing to clear.
 *
 * Run: node --experimental-strip-types --import ./scripts/node-test-alias-loader.mjs --test src/lib/clear-conversation.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasClearableConversation } from "@/lib/clear-conversation";

test("16. no conversation (empty thread, no history) -> nothing to clear", () => {
  assert.equal(hasClearableConversation({ messageCount: 0, hasLatestConversation: false }), false);
});

test("17. conversation content exists -> clearable", () => {
  assert.equal(hasClearableConversation({ messageCount: 3, hasLatestConversation: false }), true);
  assert.equal(hasClearableConversation({ messageCount: 0, hasLatestConversation: true }), true);
});

test("18. after clearing (thread empty + no latest conversation) -> disabled again", () => {
  assert.equal(hasClearableConversation({ messageCount: 0, hasLatestConversation: false }), false);
});

/* ---------------- structural ---------------- */

const hookSrc = readFileSync(
  fileURLToPath(new URL("../hooks/use-ai-conversation.ts", import.meta.url)),
  "utf8",
);
const chatSrc = readFileSync(
  fileURLToPath(new URL("../components/course/CourseTutorChat.tsx", import.meta.url)),
  "utf8",
);

test("the button is gated on the hook's own conversation state, not a new counter", () => {
  assert.match(hookSrc, /hasClearableConversation\(\{/);
  assert.match(hookSrc, /messageCount: messagesQuery\.data\?\.length \?\? 0/);
  assert.match(hookSrc, /hasConversationContent/);
  // clear onSuccess flips the flag immediately
  assert.match(hookSrc, /setQueryData\(\["ai-conversation", user\?\.id, courseId\], null\)/);
});

test("Clear conversation button is disabled + keyboard-inaccessible when empty", () => {
  assert.match(
    chatSrc,
    /disabled=\{!hasConversationContent \|\| clearCourseConversations\.isPending\}/,
  );
  assert.match(chatSrc, /aria-disabled=\{!hasConversationContent/);
  assert.match(chatSrc, /disabled:pointer-events-none/);
  // the existing confirm dialog is preserved
  assert.match(chatSrc, /AlertDialog open=\{confirmClear\}/);
});
