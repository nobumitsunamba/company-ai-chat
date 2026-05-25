"use client";

import { useRef, useState } from "react";
import { FileText, Trash2, Upload, X, CheckSquare, Square, BookOpen } from "lucide-react";
import type { Document } from "@/types";
import clsx from "clsx";

interface Props {
  documents: Document[];
  activeDocumentIds: string[];
  onToggleDocument: (id: string) => void;
  onDelete: (id: string) => void;
  onUpload: (file: File) => Promise<void>;
  isUploading: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "📄";
  if (ext === "docx" || ext === "doc") return "📝";
  return "📃";
}

export default function DocumentSidebar({
  documents,
  activeDocumentIds,
  onToggleDocument,
  onDelete,
  onUpload,
  isUploading,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await onUpload(file);
      e.target.value = "";
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await onUpload(file);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    await onDelete(id);
    setDeletingId(null);
  };

  return (
    <aside className="flex flex-col h-full bg-gray-50 border-r border-gray-200">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={18} className="text-blue-600" />
          <h2 className="font-semibold text-gray-800 text-sm">参照文書</h2>
        </div>

        {/* Upload button */}
        <button
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          className={clsx(
            "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all",
            isUploading
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-blue-600 text-white hover:bg-blue-700 active:scale-95"
          )}
        >
          {isUploading ? (
            <>
              <span className="animate-spin">⏳</span>
              <span>アップロード中...</span>
            </>
          ) : (
            <>
              <Upload size={15} />
              <span>文書をアップロード</span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.doc,.txt,.md,.csv"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Supported formats */}
        <p className="mt-2 text-xs text-gray-400 text-center">
          PDF / Word / テキスト（最大10MB）
        </p>
      </div>

      {/* Drop zone (shown when dragging) */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={clsx(
          "mx-3 mt-3 rounded-lg border-2 border-dashed text-center text-xs py-2 transition-all",
          dragging
            ? "border-blue-400 bg-blue-50 text-blue-600"
            : "border-transparent text-transparent h-0 py-0 overflow-hidden"
        )}
      >
        ここにドロップ
      </div>

      {/* Drag overlay */}
      {!dragging && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          className="flex-1 overflow-y-auto"
        >
          {/* Document list */}
          {documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 px-4 text-center">
              <FileText size={32} className="text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">
                文書をアップロードすると
                <br />
                内容を参照して回答します
              </p>
            </div>
          ) : (
            <ul className="p-3 space-y-2">
              {documents.map((doc) => {
                const isActive = activeDocumentIds.includes(doc.id);
                return (
                  <li
                    key={doc.id}
                    className={clsx(
                      "group rounded-lg border p-3 cursor-pointer transition-all",
                      isActive
                        ? "border-blue-300 bg-blue-50"
                        : "border-gray-200 bg-white hover:border-gray-300"
                    )}
                    onClick={() => onToggleDocument(doc.id)}
                  >
                    <div className="flex items-start gap-2">
                      {/* Active toggle */}
                      <div className="mt-0.5 shrink-0">
                        {isActive ? (
                          <CheckSquare size={16} className="text-blue-600" />
                        ) : (
                          <Square size={16} className="text-gray-300" />
                        )}
                      </div>

                      {/* File info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-sm">{fileIcon(doc.name)}</span>
                          <span className="text-xs font-medium text-gray-700 truncate">
                            {doc.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-gray-400">
                            {formatBytes(doc.size)}
                          </span>
                          <span className="text-xs text-gray-300">·</span>
                          <span className="text-xs text-gray-400">
                            {doc.chunkCount}チャンク
                          </span>
                        </div>
                      </div>

                      {/* Delete button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(doc.id);
                        }}
                        disabled={deletingId === doc.id}
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                      >
                        {deletingId === doc.id ? (
                          <X size={13} className="animate-spin" />
                        ) : (
                          <Trash2 size={13} />
                        )}
                      </button>
                    </div>

                    {isActive && (
                      <p className="mt-1.5 ml-6 text-xs text-blue-500 font-medium">
                        参照中
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Drag overlay active */}
      {dragging && (
        <div
          onDragOver={(e) => { e.preventDefault(); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className="flex-1 flex items-center justify-center"
        >
          <div className="text-center">
            <Upload size={32} className="text-blue-400 mx-auto mb-2" />
            <p className="text-sm text-blue-600 font-medium">ここにドロップ</p>
          </div>
        </div>
      )}

      {/* Footer: active count */}
      {documents.length > 0 && (
        <div className="p-3 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            {activeDocumentIds.length > 0
              ? `${activeDocumentIds.length}件の文書を参照中`
              : "チェックした文書を参照します"}
          </p>
        </div>
      )}
    </aside>
  );
}
