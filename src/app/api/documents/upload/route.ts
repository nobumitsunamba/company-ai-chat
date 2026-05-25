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

function ensureUploadDir(): void {
  if (!existsSync(TMP_UPLOAD_DIR)) {
    mkdirSync(TMP_UPLOAD_DIR, { recursive: true });
  }
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

    // Validate file type
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
        },
        { status: 400 }
      );
    }

    // Size limit: 10 MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "ファイルサイズは10MB以下にしてください。" },
        { status: 400 }
      );
    }

    // ── /tmp に一時保存（Vercel サーバーレスは /tmp のみ書き込み可能） ──
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    ensureUploadDir();
    tmpPath = join(TMP_UPLOAD_DIR, `${randomUUID()}.${ext || "bin"}`);
    await writeFile(tmpPath, buffer);

    // ── テキスト抽出（/tmp から読んだバッファを使用） ────────────────────
    let text: string;
    try {
      text = await extractText(buffer, file.type, file.name);
    } catch (err) {
      console.error("Text extraction error:", err);
      return NextResponse.json(
        {
          error:
            "ファイルのテキスト抽出に失敗しました。ファイルが破損していないか確認してください。",
        },
        { status: 422 }
      );
    }

    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        { error: "ファイルからテキストを抽出できませんでした。" },
        { status: 422 }
      );
    }

    // ── チャンク分割 → /tmp に永続化 ─────────────────────────────────────
    const rawChunks = splitIntoChunks(text);
    const documentId = randomUUID();

    const chunks: DocumentChunk[] = rawChunks.map((content, index) => ({
      id: `${documentId}-${index}`,
      documentId,
      documentName: file.name,
      content,
      index,
    }));

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

    return NextResponse.json({
      id: documentId,
      name: file.name,
      size: file.size,
      chunkCount: chunks.length,
      uploadedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: "アップロード中にエラーが発生しました。" },
      { status: 500 }
    );
  } finally {
    // 一時ファイルを必ず削除
    if (tmpPath) {
      await unlink(tmpPath).catch(() => {});
    }
  }
}
