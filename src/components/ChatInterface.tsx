"use client";

import { useChat } from "ai/react";
import { useEffect, useRef, useState, useCallback } from "react";
import { Send, Loader2, Trash2, RefreshCw } from "lucide-react";
import MessageBubble from "./MessageBubble";
import DocumentSidebar from "./DocumentSidebar";
import type { Document } from "@/types";
import clsx from "clsx";

export default function ChatInterface() {
  // ─── Documents state ────────────────────────────────────────────────
  const [documents, setDocuments] = useState<Document[]>([]);
  const [activeDocumentIds, setActiveDocumentIds] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ─── Chat ────────────────────────────────────────────────────────────
  const { messages, input, handleInputChange, handleSubmit, isLoading, setMessages, error } =
    useChat({
      api: "/api/chat",
      body: { activeDocumentIds },
    });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  // Fetch documents on mount
  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      if (!res.ok) return;
      const data = await res.json();
      setDocuments(data.documents ?? []);
    } catch {
      // silently fail on fetch errors
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // ─── Handlers ────────────────────────────────────────────────────────

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error ?? "アップロードに失敗しました");
        return;
      }
      // Add to documents & auto-activate
      setDocuments((prev) => [data, ...prev]);
      setActiveDocumentIds((prev) => [...prev, data.id]);
    } catch {
      setUploadError("ネットワークエラーが発生しました");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDocument = async (id: string) => {
    try {
      await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      setActiveDocumentIds((prev) => prev.filter((i) => i !== id));
    } catch {
      // silently fail
    }
  };

  const handleToggleDocument = (id: string) => {
    setActiveDocumentIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && input.trim()) {
        handleSubmit(e as unknown as React.FormEvent);
      }
    }
  };

  const clearChat = () => setMessages([]);

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <div className="w-72 shrink-0 flex flex-col">
        <DocumentSidebar
          documents={documents}
          activeDocumentIds={activeDocumentIds}
          onToggleDocument={handleToggleDocument}
          onDelete={handleDeleteDocument}
          onUpload={handleUpload}
          isUploading={isUploading}
        />
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-sm font-bold">AI</span>
            </div>
            <div>
              <h1 className="font-semibold text-gray-900 text-sm">社内AIチャット</h1>
              <p className="text-xs text-gray-400">
                {activeDocumentIds.length > 0
                  ? `${activeDocumentIds.length}件の文書を参照中`
                  : "文書なしで回答中"}
              </p>
            </div>
          </div>

          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-1 rounded hover:bg-gray-100"
            >
              <Trash2 size={13} />
              会話をクリア
            </button>
          )}
        </header>

        {/* Upload error banner */}
        {uploadError && (
          <div className="bg-red-50 border-b border-red-200 px-6 py-2 flex items-center justify-between">
            <p className="text-sm text-red-600">{uploadError}</p>
            <button onClick={() => setUploadError(null)} className="text-red-400 hover:text-red-600 ml-4">
              ✕
            </button>
          </div>
        )}

        {/* Chat error */}
        {error && (
          <div className="bg-red-50 border-b border-red-200 px-6 py-2 flex items-center gap-2">
            <p className="text-sm text-red-600">エラーが発生しました: {error.message}</p>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-8 text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mb-4">
                <span className="text-3xl">💬</span>
              </div>
              <h2 className="text-xl font-semibold text-gray-700 mb-2">
                社内AIチャットへようこそ
              </h2>
              <p className="text-gray-500 text-sm max-w-md mb-6">
                左のサイドバーから文書をアップロードして、
                内容についての質問をしてみましょう。
                文書なしでも一般的な質問に回答できます。
              </p>

              {/* Suggestion chips */}
              <div className="flex flex-wrap gap-2 justify-center">
                {[
                  "この会社のルールについて教えて",
                  "文書の要約をお願いします",
                  "〇〇の手順を説明して",
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      handleInputChange({ target: { value: s } } as React.ChangeEvent<HTMLTextAreaElement>);
                    }}
                    className="text-sm bg-white border border-gray-200 text-gray-600 rounded-full px-4 py-2 hover:border-blue-300 hover:text-blue-600 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              {isLoading && (
                <div className="flex gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
                    <Loader2 size={16} className="text-white animate-spin" />
                  </div>
                  <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                    <div className="flex gap-1 items-center h-5">
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input area */}
        <div className="shrink-0 bg-white border-t border-gray-200 px-4 py-3">
          <form
            onSubmit={handleSubmit}
            className="flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="メッセージを入力… (Shift+Enterで改行)"
              rows={1}
              className="flex-1 bg-transparent resize-none outline-none text-sm text-gray-800 placeholder-gray-400 py-1 max-h-40"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className={clsx(
                "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all",
                isLoading || !input.trim()
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-blue-600 text-white hover:bg-blue-700 active:scale-95"
              )}
            >
              {isLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </form>
          <p className="text-xs text-gray-400 text-center mt-2">
            AIの回答は参考情報です。重要な判断は必ず確認してください。
          </p>
        </div>
      </div>
    </div>
  );
}
