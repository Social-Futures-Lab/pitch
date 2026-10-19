interface ParticipantListProps {
  members: { id: string; name: string }[];
  onlineUserIds: string[];
  typingUsers: string[];
  currentUserId?: string;
  onEndConversation?: () => void;
  ending?: boolean;
}

export default function ParticipantList({
  members,
  onlineUserIds,
  typingUsers,
  currentUserId,
  onEndConversation,
  ending,
}: ParticipantListProps) {
  if (members.length === 0) return null;

  const onlineSet = new Set(onlineUserIds);
  const typingSet = new Set(typingUsers);

  const sorted = [...members].sort((a, b) => {
    const aOnline = onlineSet.has(a.id) ? 0 : 1;
    const bOnline = onlineSet.has(b.id) ? 0 : 1;
    if (aOnline !== bOnline) return aOnline - bOnline;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="hidden w-48 shrink-0 border-l border-gray-200 bg-gray-50/50 sm:flex sm:flex-col">
      <div className="px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Participants
          <span className="ml-1 font-normal text-gray-400">
            ({onlineUserIds.length}/{members.length})
          </span>
        </h3>
        <ul className="mt-2 space-y-1.5">
          {sorted.map((member) => {
            const isOnline = onlineSet.has(member.id);
            const isTyping = typingSet.has(member.name);
            const isYou = member.id === currentUserId;

            return (
              <li key={member.id} className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    isOnline ? "bg-emerald-400" : "bg-gray-300"
                  }`}
                />
                <span
                  className={`truncate text-sm ${
                    isOnline ? "text-gray-800" : "text-gray-400"
                  }`}
                >
                  {member.name}
                  {isYou && (
                    <span className="ml-1 text-xs text-gray-400">(you)</span>
                  )}
                </span>
                {isTyping && (
                  <span className="ml-auto flex gap-0.5">
                    <span className="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {onEndConversation && (
        <div className="px-4 pb-3">
          <button
            data-testid="end-conversation-button"
            onClick={onEndConversation}
            disabled={ending}
            className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            {ending ? "Ending..." : "End conversation"}
          </button>
        </div>
      )}
    </div>
  );
}
