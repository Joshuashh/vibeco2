import type { ChatRow } from "../types/chat";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface PermissionRequest {
  requestId: string;
  chatId: string;
  toolName: string;
  input: unknown;
}

// Mounted once near the app root. Only ever shows the head of the queue —
// simultaneous requests from two chats (or two tool calls in one turn)
// queue up rather than stacking dialogs.
export function PermissionPrompt({
  requests,
  chats,
  onAnswer,
}: {
  requests: PermissionRequest[];
  chats: ChatRow[];
  onAnswer: (requestId: string, allow: boolean) => void;
}) {
  const request = requests[0];
  if (!request) return null;

  const chatTitle = chats.find((c) => c.id === request.chatId)?.title ?? "Untitled chat";

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Allow "{request.toolName}"?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <div>
                Requested in <span className="font-medium text-text-primary">{chatTitle}</span>.
              </div>
              <pre className="text-[0.75em] bg-bg-tertiary rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(request.input, null, 2)}
              </pre>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onAnswer(request.requestId, false)}>Deny</AlertDialogCancel>
          <AlertDialogAction onClick={() => onAnswer(request.requestId, true)}>Allow</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
