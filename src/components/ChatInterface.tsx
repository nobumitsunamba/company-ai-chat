"use client";

import { useChat } from "ai/react";
import { useEffect, useRef, useState, useCallback } from "react";
import { Send, Loader2, Trash2, ChevronDown, AlertTriangle, X } from "lucide-react";
import MessageBubble from "./MessageBubble";
import DocumentSidebar from "./DocumentSidebar";
import { findRelevantChunks, buildContext } from "@/lib/rag";
import type { StoredDocument, UploadError } from "@/types";
import clsx from "clsx";

// ─── 定数 ────────────────────────────────────────────────────────────────────

/** localStorage のキー */
const LS_DOCS_KEY = "company-ai-chat-documents";
const LS_ACTIVE_KEY = "company-ai-chat-active-ids";

/** チャット時に送る関連チャンクの最大数 */
const TOP_K_CHUNKS = 6;

// ─── localStorage ユーティリティ ──────────────────────────────────────────────

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("[storage] Failed to save:", e);
  }
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

export default function ChatInterface() {
  // ── ドキュメント状態（localStorage に永続化） ──
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [activeDocumentIds, setActiveDocumentIds] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<UploadError | null>(null);
  const [showErrorStack, setShowErrorStack] = useState(false);

  // ── localStorage から初期化 ──
  useEffect(() => {
    setDocuments(loadFromStorage<StoredDocument[]>(LS_DOCS_KEY, []));
    setActiveDocumentIds(loadFromStorage<string[]>(LS_ACTIVE_KEY, []));
  }, []);

  // ── 変更を localStorage に保存 ──
  useEffect(() => {
    saveToStorage(LS_DOCS_KEY, documents);
  }, [documents]);

  useEffect(() => {
    saveToStorage(LS_ACTIVE_KEY, activeDocumentIds);
  }, [activeDocumentIds]);

  // ── クライアント側 RAG：アクティブ文書からコンテキスト文字列を生成 ──
  const buildClientContext = useCallback(
    (query: string): string => {
      const activeDocs = documents.filter((d) =>
        activeDocumentIds.includes(d.id)
      );
      if (activeDocs.length === 0) return "";

      const allChunks = activeDocs.flatMap((d) => d.chunks);
      if (allChunks.length === 0) return "";

      const relevant = findRelevantChunks(query, allChunks, TOP_K_CHUNKS);
      return buildContext(relevant);
    },
    [documents, activeDocumentIds]
  );

  // ── チャット ──────────────────────────────────────────────────────────────
  const { messages, input, handleInputChange, handleSubmit, isLoading, setMessages, error } =
    useChat({ api: "/api/chat" });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 末尾に自動スクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // テキストエリアの高さを自動調整
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  // ── カスタム送信ハンドラ（クライアント RAG コンテキストを付与） ──
  const onSubmit = useCallback(
    (e: React.FormEvent | React.KeyboardEvent) => {
      e.preventDefault();
      if (!input.trim() || isLoading) return;

      const context = buildClientContext(input.trim());

      handleSubmit(e as React.FormEvent, {
        body: {
          // クライアント側で RAG 済みのコンテキスト文字列を送る。
          // サーバーはこれをそのままシステムプロンプトに注入するだけなので、
          // Vercel のインスタンス間状態共有問題が発生しない。
          context: context || undefined,
          activeDocumentIds,
        },
      });
    },
    [input, isLoading, handleSubmit, buildClientContext, activeDocumentIds]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      onSubmit(e);
    }
  };

  // ── ドキュメント操作ハンドラ ──────────────────────────────────────────────

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setUploadError(null);
    setShowErrorStack(false);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setUploadError({
          message: data.error ?? "アップロードに失敗しました",
          detail: data.detail,
          stack: data.stack,
        });
        return;
      }

      // ── チャンクを含む文書をローカルに保存 ──
      // サーバーレス環境ではインスタンス間で状態が共有されないため、
      // チャンクはブラウザ側（localStorage）で管理する。
      const newDoc: StoredDocument = {
        id: data.id,
        name: data.name,
        type: data.type,
        size: data.size,
        uploadedAt: data.uploadedAt,
        chunkCount: data.chunkCount,
        chunks: data.chunks ?? [],
      };

      setDocuments((prev) => [newDoc, ...prev]);
      setActiveDocumentIds((prev) =>
        prev.includes(data.id) ? prev : [...prev, data.id]
      );

      if (data.warning) {
        setUploadError({ message: data.warning });
      }
    } catch (err) {
      setUploadError({
        message: "ネットワークエラーが発生しました",
        detail: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDocument = (id: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    setActiveDocumentIds((prev) => prev.filter((i) => i !== id));
    // サーバー側の /tmp も掃除（ベストエフォート）
    fetch(`/api/documents?id=${id}`, { method: "DELETE" }).catch(() => {});
  };

  const handleToggleDocument = (id: string) => {
    setActiveDocumentIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const clearChat = () => setMessages([]);

  // サイドバーには chunks を渡さない（表示に不要なため型変換）
  const docsForSidebar = documents.map(({ chunks: _chunks, ...doc }) => doc);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-gray-100">
      {/* ── サイドバー ── */}
      <div className="w-72 shrink-0 flex flex-col">
        <DocumentSidebar
          documents={docsForSidebar}
          activeDocumentIds={activeDocumentIds}
          onToggleDocument={handleToggleDocument}
          onDelete={handleDeleteDocument}
          onUpload={handleUpload}
          isUploading={isUploading}
        />
      </div>

      {/* ── メインチャットエリア ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ヘッダー */}
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

        {/* ── エラーバナー ── */}
        {uploadError && (
          <div className="shrink-0 bg-red-50 border-b border-red-200 px-6 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <AlertTriangle
                  size={16}
                  className="text-red-500 shrink-0 mt-0.5"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-red-700">
                    {uploadError.message}
                  </p>

                  {/* detail（エラーの詳細メッセージ）*/}
                  {uploadError.detail && (
                    <p className="mt-1 text-xs text-red-600 font-mono break-all">
                      {uploadError.detail}
                    </p>
                  )}

                  {/* スタックトレース（展開可能） */}
                  {uploadError.stack && (
                    <div className="mt-2">
                      <button
                        onClick={() => setShowErrorStack((v) => !v)}
                        className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
                      >
                        <ChevronDown
                          size={12}
                          className={clsx(
                            "transition-transform",
                            showErrorStack && "rotate-180"
                          )}
                        />
                        {showErrorStack
                          ? "スタックトレースを隠す"
                          : "スタックトレースを表示"}
                      </button>
                      {showErrorStack && (
                        <pre className="mt-1 text-xs text-red-500 font-mono overflow-x-auto max-h-40 p-2 bg-red-100 rounded border border-red-200">
                          {uploadError.stack}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={() => {
                  setUploadError(null);
                  setShowErrorStack(false);
                }}
                className="shrink-0 text-red-400 hover:text-red-600"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* チャット API エラー */}
        {error && (
          <div className="shrink-0 bg-red-50 border-b border-red-200 px-6 py-2 flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-500 shrink-0" />
            <p className="text-sm text-red-600">
              チャットエラー: {error.message}
            </p>
          </div>
        )}

        {/* ── メッセージ一覧 ── */}
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
              <div className="flex flex-wrap gap-2 justify-center">
                {[
                  "この会社のルールについて教えて",
                  "文書の要約をお願いします",
                  "〇〇の手順を説明して",
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() =>
                      handleInputChange({
                        target: { value: s },
                      } as React.ChangeEvent<HTMLTextAreaElement>)
                    }
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
                      <span
                        className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0ms" }}
                      />
                      <span
                        className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: "150ms" }}
                      />
                      <span
                        className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: "300ms" }}
                      />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* ── 入力エリア ── */}
        <div className="shrink-0 bg-white border-t border-gray-200 px-4 py-3">
          <form
            onSubmit={onSubmit}
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
