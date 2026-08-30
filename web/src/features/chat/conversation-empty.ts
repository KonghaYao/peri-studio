export function isConversationEmpty(input: {
  runtimeDocsHydrated: boolean;
  entryCount: number;
  turnActive: boolean;
  hasSubmission: boolean;
  restoring: boolean;
  chatLoading: boolean;
}): boolean {
  return input.runtimeDocsHydrated
    && input.entryCount === 0
    && !input.turnActive
    && !input.hasSubmission
    && !input.restoring
    && !input.chatLoading;
}
