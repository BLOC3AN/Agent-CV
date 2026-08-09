import type { ChatMessage } from './chat-store'

export type AssistantWorkspaceState = 'idle' | 'active'

/**
 * The first user turn opens the live CV beside the conversation. An assistant
 * reply alone must not open the workspace: this keeps the initial state stable
 * while a restored or streamed conversation is being attached.
 */
export function assistantWorkspaceState(
  messages: Pick<ChatMessage, 'role'>[],
  drawer: 'chat' | 'history' | null,
  focusPath?: string | null,
): AssistantWorkspaceState {
  const hasUserMessage = messages.some((message) => message.role === 'user')
  return hasUserMessage || drawer !== 'chat' || Boolean(focusPath) ? 'active' : 'idle'
}
