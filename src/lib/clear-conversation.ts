/**
 * Pure gate for the AI tutor's "Clear conversation" control.
 *
 * "Something to clear" = the current thread has at least one real persisted
 * `ai_messages` turn, OR the course still has a prior conversation on record
 * (so clearing after "New chat" is not needed but also not lost). A
 * placeholder / welcome / empty-state has no `ai_messages` row and no
 * `ai_conversations` row, so it never counts.
 *
 * Uses the conversation state that already exists in `useAiConversation`
 * (`messages` + the latest-conversation query) — no separate message counter.
 */
export function hasClearableConversation(input: {
  /** `messages.length` from useAiConversation — real user/assistant turns. */
  messageCount: number;
  /** The latest-conversation query returned a conversation id for this course. */
  hasLatestConversation: boolean;
}): boolean {
  return input.messageCount > 0 || input.hasLatestConversation;
}
