import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { extractText, splitIntoChunks } from "@/lib/text-extractor";
import { addDocument } from "@/lib/document-store";
import type { DocumentChunk } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "ファイルが指定されていません" }, { status: 400 });
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
        { error: "対応していないファイル形式です。PDF、Word、テキストファイルをアップロードしてください。" },
        { status: 400 }
      );
    }

    // Size limit: 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "ファイルサイズは10MB以下にしてください。" },
        { status: 400 }
      );
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Extract text
    let text: string;
    try {
      text = await extractText(buffer, file.type, file.name);
    } catch (err) {
      console.error("Text extraction error:", err);
      return NextResponse.json(
        { error: "ファイルのテキスト抽出に失敗しました。ファイルが破損していないか確認してください。" },
        { status: 422 }
      );
    }

    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        { error: "ファイルからテキストを抽出できませんでした。" },
        { status: 422 }
      );
    }

    // Split into chunks
    const rawChunks = splitIntoChunks(text);
    const documentId = randomUUID();

    const chunks: DocumentChunk[] = rawChunks.map((content, index) => ({
      id: `${documentId}-${index}`,
      documentId,
      documentName: file.name,
      content,
      index,
    }));

    // Store document metadata + chunks
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
  }
}
