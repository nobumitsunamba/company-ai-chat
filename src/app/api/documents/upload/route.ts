import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { extractText, splitIntoChunks } from "@/lib/text-extractor";
import { addDocument } from "@/lib/document-store";
import type { DocumentChunk } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 1ドキュメントあたりのチャンク上限（レスポンスサイズ制御） */
const MAX_CHUNKS = 500;

/** エラーを JSON シリアライズ可能な形式に変換 */
function serializeError(err: unknown): { detail: string; stack?: string } {
  if (err instanceof Error) {
    return { detail: err.message, stack: err.stack };
  }
  return { detail: String(err) };
}

export async function POST(req: NextRequest) {
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
          detail: `MIMEタイプ: "${file.type}", 拡張子: ".${ext}"`,
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

    // ── Buffer に変換（/tmp への不要な書き込みは行わない） ────────────────
    const buffer = Buffer.from(await file.arrayBuffer());

    // ── テキスト抽出 ─────────────────────────────────────────────────────
    let text: string;
    try {
      text = await extractText(buffer, file.type, file.name);
    } catch (err) {
      console.error("[upload] Text extraction error:", err);
      return NextResponse.json(
        {
          error:
            "ファイルのテキスト抽出に失敗しました。ファイルが破損していないか確認してください。",
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
            "テキストレイヤーがないか、暗号化されている可能性があります。",
        },
        { status: 422 }
      );
    }

    // ── チャンク分割 ─────────────────────────────────────────────────────
    const rawChunks = splitIntoChunks(text);
    const truncated = rawChunks.length > MAX_CHUNKS;
    const usedChunks = truncated ? rawChunks.slice(0, MAX_CHUNKS) : rawChunks;

    const documentId = randomUUID();
    const chunks: DocumentChunk[] = usedChunks.map((content, index) => ({
      id: `${documentId}-${index}`,
      documentId,
      documentName: file.name,
      content,
      index,
    }));

    const doc = {
      id: documentId,
      name: file.name,
      type: file.type || `application/${ext}`,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      chunkCount: chunks.length,
    };

    // ── Vercel KV に保存（フォールバック：インメモリ） ────────────────────
    await addDocument(doc, chunks);

    // ── レスポンス：チャンクをクライアントに返す ──────────────────────────
    // クライアント (localStorage) がチャンクを保持することで
    // KV 未設定時もブラウザ側 RAG が確実に動作する。
    return NextResponse.json({
      ...doc,
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
  }
}
