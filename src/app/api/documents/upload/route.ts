import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { writeFile, unlink } from "fs/promises";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { extractText, splitIntoChunks } from "@/lib/text-extractor";
import { addDocument } from "@/lib/document-store";
import type { DocumentChunk } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Vercel でファイル書き込み可能な /tmp 配下の一時ディレクトリ */
const TMP_UPLOAD_DIR = "/tmp/company-ai-chat-uploads";

/** 1ドキュメントあたりのチャンク上限（レスポンスサイズ制御） */
const MAX_CHUNKS = 500;

function ensureUploadDir(): void {
  if (!existsSync(TMP_UPLOAD_DIR)) {
    mkdirSync(TMP_UPLOAD_DIR, { recursive: true });
  }
}

/**
 * エラーオブジェクトを JSON シリアライズ可能な形式に変換する。
 */
function serializeError(err: unknown): { detail: string; stack?: string } {
  if (err instanceof Error) {
    return {
      detail: err.message,
      stack: err.stack,
    };
  }
  return { detail: String(err) };
}

export async function POST(req: NextRequest) {
  let tmpPath: string | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "ファイルが指定されていません" },
        { status: 400 }
      );
    }

    // ── ファイル形式チェック ──────────────────────────────────────────────
    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "text/plain",
      "text/markdown",
      "text/csv",
    ];
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const allowedExts = ["pdf", "docx", "doc", "txt", "md", "csv"];

    if (!allowedTypes.includes(file.type) && !allowedExts.includes(ext)) {
      return NextResponse.json(
        {
          error:
            "対応していないファイル形式です。PDF、Word、テキストファイルをアップロードしてください。",
          detail: `受け取ったMIMEタイプ: "${file.type}", 拡張子: ".${ext}"`,
        },
        { status: 400 }
      );
    }

    // ── サイズチェック ───────────────────────────────────────────────────
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        {
          error: "ファイルサイズは10MB以下にしてください。",
          detail: `受け取ったサイズ: ${(file.size / 1024 / 1024).toFixed(2)} MB`,
        },
        { status: 400 }
      );
    }

    // ── Buffer 化 → /tmp に一時保存 ─────────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    ensureUploadDir();
    tmpPath = join(TMP_UPLOAD_DIR, `${randomUUID()}.${ext || "bin"}`);
    await writeFile(tmpPath, buffer);

    // ── テキスト抽出 ─────────────────────────────────────────────────────
    let text: string;
    try {
      text = await extractText(buffer, file.type, file.name);
    } catch (err) {
      console.error("[upload] Text extraction error:", err);
      return NextResponse.json(
        {
          error: "ファイルのテキスト抽出に失敗しました。ファイルが破損していないか確認してください。",
          ...serializeError(err),
        },
        { status: 422 }
      );
    }

    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        {
          error: "ファイルからテキストを抽出できませんでした。",
          detail:
            "ファイルにテキストレイヤーがないか、暗号化されている可能性があります。",
        },
        { status: 422 }
      );
    }

    // ── チャンク分割 ─────────────────────────────────────────────────────
    const rawChunks = splitIntoChunks(text);
    const truncated = rawChunks.length > MAX_CHUNKS;
    const usedChunks = truncated ? rawChunks.slice(0, MAX_CHUNKS) : rawChunks;

    if (truncated) {
      console.warn(
        `[upload] "${file.name}": ${rawChunks.length} chunks truncated to ${MAX_CHUNKS}`
      );
    }

    const documentId = randomUUID();
    const chunks: DocumentChunk[] = usedChunks.map((content, index) => ({
      id: `${documentId}-${index}`,
      documentId,
      documentName: file.name,
      content,
      index,
    }));

    // ── サーバー側ストアにも保存（同一インスタンス内のフォールバック用） ──
    addDocument(
      {
        id: documentId,
        name: file.name,
        type: file.type || `application/${ext}`,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        chunkCount: chunks.length,
      },
      chunks
    );

    // ── レスポンス：チャンクをクライアントに返す ──────────────────────────
    // Vercel サーバーレスではインスタンス間で /tmp が共有されないため、
    // クライアント (localStorage) がチャンクを保持し、チャット時に送り返す。
    return NextResponse.json({
      id: documentId,
      name: file.name,
      type: file.type || `application/${ext}`,
      size: file.size,
      chunkCount: chunks.length,
      uploadedAt: new Date().toISOString(),
      chunks,
      ...(truncated && {
        warning: `文書が大きいため、先頭 ${MAX_CHUNKS} チャンクのみ使用されます。`,
      }),
    });
  } catch (err) {
    console.error("[upload] Unexpected error:", err);
    return NextResponse.json(
      {
        error: "アップロード中に予期せぬエラーが発生しました。",
        ...serializeError(err),
      },
      { status: 500 }
    );
  } finally {
    // 一時ファイルを必ず削除
    if (tmpPath) {
      await unlink(tmpPath).catch(() => {});
    }
  }
}
