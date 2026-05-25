/**
 * Vercel KV (Upstash Redis) バックエンドのドキュメントストア。
 *
 * 環境変数 KV_URL または KV_REST_API_URL が設定されていれば KV を使用。
 * 設定されていない場合（ローカル開発時）はインメモリにフォールバック。
 *
 * KV キー設計:
 *   cai:docs:index          → 文書 ID の Sorted Set（score = uploadedAt timestamp）
 *   cai:doc:{id}            → Document メタデータ（JSON）
 *   cai:chunks:{id}         → DocumentChunk[] （JSON）
 *
 * 注意：
 *   クライアント（ブラウザ）も localStorage にチャンクを保持しており、
 *   チャット送信時はクライアント側で TF-IDF 検索した結果を context 文字列として
 *   送信するため、KV はあくまで「サーバー側フォールバック」として機能する。
 */

import type { Document, DocumentChunk } from "@/types";

// ─── KV キー ─────────────────────────────────────────────────────────────────

const P = "cai"; // キープレフィックス
const INDEX_KEY = `${P}:docs:index`;
const docKey = (id: string) => `${P}:doc:${id}`;
const chunksKey = (id: string) => `${P}:chunks:${id}`;

// ─── KV 可用性チェック ────────────────────────────────────────────────────────

function isKVReady(): boolean {
  return !!(
    process.env.KV_URL ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  );
}

/** KV クライアントを取得（未設定時は null） */
async function tryGetKV() {
  if (!isKVReady()) return null;
  try {
    const { kv } = await import("@vercel/kv");
    return kv;
  } catch (e) {
    console.error("[document-store] @vercel/kv import failed:", e);
    return null;
  }
}

// ─── インメモリフォールバック（ローカル開発 / KV 未設定時） ────────────────────

const mem = {
  docs: new Map<string, Document>(),
  chunks: new Map<string, DocumentChunk[]>(),
};

// ─── Public API（全て非同期） ─────────────────────────────────────────────────

export async function addDocument(
  doc: Document,
  chunks: DocumentChunk[]
): Promise<void> {
  const kv = await tryGetKV();

  if (kv) {
    try {
      await Promise.all([
        kv.set(docKey(doc.id), doc),
        kv.set(chunksKey(doc.id), chunks),
        // Sorted Set にドキュメント ID を登録（score = アップロード時刻 ms）
        kv.zadd(INDEX_KEY, {
          score: new Date(doc.uploadedAt).getTime(),
          member: doc.id,
        }),
      ]);
      return;
    } catch (e) {
      console.error("[document-store] KV write failed, using in-memory:", e);
    }
  } else {
    console.warn("[document-store] KV not configured, using in-memory store");
  }

  // インメモリフォールバック
  mem.docs.set(doc.id, doc);
  mem.chunks.set(doc.id, chunks);
}

export async function getAllDocuments(): Promise<Document[]> {
  const kv = await tryGetKV();

  if (kv) {
    try {
      // Sorted Set から ID を新しい順（降順）で取得
      const ids = (await kv.zrange(INDEX_KEY, 0, -1, {
        rev: true,
      })) as string[];
      if (ids.length === 0) return [];

      const docs = await Promise.all(
        ids.map((id) => kv.get<Document>(docKey(id)))
      );
      return docs.filter((d): d is Document => d !== null);
    } catch (e) {
      console.error("[document-store] KV read failed:", e);
    }
  }

  return Array.from(mem.docs.values()).sort(
    (a, b) =>
      new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );
}

export async function deleteDocument(id: string): Promise<boolean> {
  const kv = await tryGetKV();

  if (kv) {
    try {
      const [delDoc, , delIndex] = await Promise.all([
        kv.del(docKey(id)),
        kv.del(chunksKey(id)),
        kv.zrem(INDEX_KEY, id),
      ]);
      return delDoc > 0 || (delIndex as number) > 0;
    } catch (e) {
      console.error("[document-store] KV delete failed:", e);
    }
  }

  const existed = mem.docs.has(id);
  mem.docs.delete(id);
  mem.chunks.delete(id);
  return existed;
}

export async function getChunks(documentId: string): Promise<DocumentChunk[]> {
  const kv = await tryGetKV();

  if (kv) {
    try {
      const chunks = await kv.get<DocumentChunk[]>(chunksKey(documentId));
      return chunks ?? [];
    } catch (e) {
      console.error("[document-store] KV chunk read failed:", e);
    }
  }

  return mem.chunks.get(documentId) ?? [];
}

export async function getAllChunks(): Promise<DocumentChunk[]> {
  const docs = await getAllDocuments();
  const nested = await Promise.all(docs.map((d) => getChunks(d.id)));
  return nested.flat();
}

export async function getChunksByDocumentIds(
  documentIds: string[]
): Promise<DocumentChunk[]> {
  const nested = await Promise.all(documentIds.map((id) => getChunks(id)));
  return nested.flat();
}
