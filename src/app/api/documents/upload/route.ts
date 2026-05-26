import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { extractText, splitIntoChunks } from "@/lib/text-extractor";
import { addDocument } from "@/lib/document-store";
import type { DocumentChunk } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;
// キャッシュを無効化し、常に動的にルートを処理する
export const dynamic = "force-dynamic";

// ─── プロセスクラッシュ防止 ────────────────────────────────────────────────────
//
// PDF ライブラリ（pdf-parse が内包する pdfjs）の非同期クリーンアップは
// unhandledRejection を発生させることがある。
//
// タイミングの問題:
//   1ファイル目の処理後に pdfjs が 50ms 以上後にクリーンアップタイマーを発火
//   → スコープ付きハンドラのウィンドウを外れて unhandledRejection が素通りする
//   → Node.js 15+ はデフォルトで unhandledRejection をプロセス終了扱い
//   → 2ファイル目の処理中にプロセスがクラッシュ → 500 HTML が返る
//
// 解決: モジュールロード時に一度だけ永続的なハンドラをインストールして
//       プロセスのクラッシュを防ぐ。ハンドラはエラーをログに記録して継続する。
// ────────────────────────────────────────────────────────────────────────────────
(function installCrashGuard() {
  // 多重インストールを防ぐ（モジュールキャッシュがある限り1回だけ実行される）
  if (process.listenerCount("unhandledRejection") > 0) return;

  process.on("unhandledRejection", (reason: unknown) => {
    // pdfjs / pdf-parse のクリーンアップ由来の rejection はログに残して継続
    console.error(
      "[upload] unhandledRejection (PDF クリーンアップ由来の可能性):",
      reason instanceof Error ? reason.message : String(reason)
    );
    // process.exit() を呼ばない → プロセスを維持して次リクエストを処理できるようにする
  });

  process.on("uncaughtException", (err: Error) => {
    // 通常は発生しないが、念のためログに残して継続
    console.error("[upload] uncaughtException:", err.message);
    // 致命的な例外は再スローしない → プロセスを維持する
  });
})();

/** 1ドキュメントあたりのチャンク上限 */
const MAX_CHUNKS = 500;

/** エラーを JSON シリアライズ可能な形式に変換 */
function serializeError(err: unknown): { detail: string; stack?: string } {
  if (err instanceof Error) {
    return { detail: err.message, stack: err.stack };
  }
  return { detail: String(err) };
}

/** 常に JSON を返すラッパー（HTML エラーページを防ぐ） */
function jsonError(
  error: string,
  extra: Record<string, unknown> = {},
  status = 500
): NextResponse {
  return NextResponse.json({ error, ...extra }, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 最外殻 try-catch：何があっても JSON を返す ─────────────────────────
  try {
    return await handleUpload(req);
  } catch (err) {
    // handleUpload 内の try-catch を抜けた例外（あってはならないが念のため）
    console.error("[upload] Unhandled error:", err);
    return jsonError(
      "アップロード中に予期せぬエラーが発生しました。",
      serializeError(err),
      500
    );
  }
}

async function handleUpload(req: NextRequest): Promise<NextResponse> {
  // ── FormData パース ──────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    return jsonError("リクエストの解析に失敗しました。", serializeError(err), 400);
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return jsonError("ファイルが指定されていません", {}, 400);
  }

  // ── ファイル形式チェック ──────────────────────────────────────────────────
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const allowedTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "text/plain",
    "text/markdown",
    "text/csv",
  ];
  const allowedExts = ["pdf", "docx", "doc", "txt", "md", "csv"];

  if (!allowedTypes.includes(file.type) && !allowedExts.includes(ext)) {
    return jsonError(
      "対応していないファイル形式です。PDF・Word・テキストファイルをアップロードしてください。",
      { detail: `受け取ったMIMEタイプ: "${file.type}", 拡張子: ".${ext}"` },
      400
    );
  }

  // ── サイズチェック ───────────────────────────────────────────────────────
  if (file.size > 10 * 1024 * 1024) {
    return jsonError(
      "ファイルサイズは10MB以下にしてください。",
      { detail: `受け取ったサイズ: ${(file.size / 1024 / 1024).toFixed(2)} MB` },
      400
    );
  }

  // ── Buffer 変換 ──────────────────────────────────────────────────────────
  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch (err) {
    return jsonError("ファイルの読み込みに失敗しました。", serializeError(err), 422);
  }

  // ── テキスト抽出 ─────────────────────────────────────────────────────────
  let text: string;
  try {
    text = await extractText(buffer, file.type, file.name);
  } catch (err) {
    console.error("[upload] Text extraction error:", err);
    return jsonError(
      "ファイルのテキスト抽出に失敗しました。ファイルが破損していないか確認してください。",
      serializeError(err),
      422
    );
  }

  if (!text || text.trim().length === 0) {
    return jsonError(
      "ファイルからテキストを抽出できませんでした。",
      { detail: "テキストレイヤーがないか、暗号化されている可能性があります。" },
      422
    );
  }

  // ── チャンク分割 ─────────────────────────────────────────────────────────
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

  // ── Vercel KV / インメモリ に保存（失敗してもレスポンスは返す） ───────────
  try {
    await addDocument(doc, chunks);
  } catch (err) {
    // KV 保存失敗はログに残すが、クライアント側 localStorage があるため続行
    console.error("[upload] addDocument failed (non-fatal):", err);
  }

  // ── 成功レスポンス ────────────────────────────────────────────────────────
  // chunks をクライアントに返す → ブラウザ localStorage で保持 → チャット時に送信
  return NextResponse.json({
    ...doc,
    chunks,
    ...(truncated && {
      warning: `文書が大きいため、先頭 ${MAX_CHUNKS} チャンクのみ使用されます。`,
    }),
  });
}
