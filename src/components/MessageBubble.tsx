"use client";

import type { Message } from "ai/react";
import clsx from "clsx";
import { Bot, User } from "lucide-react";

interface Props {
  message: Message;
}

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";

  return (
    <div
      className={clsx(
        "flex gap-3 px-4 py-3",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      <div
        className={clsx(
          "shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold",
          isUser ? "bg-blue-500" : "bg-gray-700"
        )}
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>

      {/* Bubble */}
      <div
        className={clsx(
          "max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words",
          isUser
            ? "bg-blue-600 text-white rounded-tr-sm"
            : "bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm"
        )}
      >
        {message.content}
      </div>
    </div>
  );
}
