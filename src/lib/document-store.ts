/**
 * /tmp-backed document store.
 *
 * Vercel serverless functions can only write to /tmp.
 * We persist document metadata and chunks there so that
 * data survives multiple requests within the same container.
 *
 * Layout:
 *   /tmp/company-ai-chat/documents.json      ← Document[] metadata
 *   /tmp/company-ai-chat/chunks-{id}.json    ← DocumentChunk[] per doc
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "fs";
import type { Document, DocumentChunk } from "@/types";

const BASE_DIR = "/tmp/company-ai-chat";
const DOCS_PATH = `${BASE_DIR}/documents.json`;
const chunksPath = (id: string) => `${BASE_DIR}/chunks-${id}.json`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureBaseDir(): void {
  if (!existsSync(BASE_DIR)) {
    mkdirSync(BASE_DIR, { recursive: true });
  }
}

// ─── Documents ───────────────────────────────────────────────────────────────

/** In-memory cache: populated from /tmp on first access. */
let docsCache: Map<string, Document> | null = null;

function getDocsCache(): Map<string, Document> {
  if (docsCache !== null) return docsCache;
  try {
    ensureBaseDir();
    if (existsSync(DOCS_PATH)) {
      const arr: Document[] = JSON.parse(readFileSync(DOCS_PATH, "utf-8"));
      docsCache = new Map(arr.map((d) => [d.id, d]));
      return docsCache;
    }
  } catch (e) {
    console.error("[document-store] Failed to load documents from /tmp:", e);
  }
  docsCache = new Map();
  return docsCache;
}

function persistDocs(): void {
  try {
    ensureBaseDir();
    const arr = Array.from(getDocsCache().values());
    writeFileSync(DOCS_PATH, JSON.stringify(arr), "utf-8");
  } catch (e) {
    console.error("[document-store] Failed to persist documents to /tmp:", e);
  }
}

// ─── Chunks ──────────────────────────────────────────────────────────────────

function loadChunks(documentId: string): DocumentChunk[] {
  const p = chunksPath(documentId);
  try {
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, "utf-8"));
    }
  } catch (e) {
    console.error(`[document-store] Failed to load chunks for ${documentId}:`, e);
  }
  return [];
}

function persistChunks(documentId: string, chunks: DocumentChunk[]): void {
  try {
    ensureBaseDir();
    writeFileSync(chunksPath(documentId), JSON.stringify(chunks), "utf-8");
  } catch (e) {
    console.error(`[document-store] Failed to persist chunks for ${documentId}:`, e);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function addDocument(doc: Document, chunks: DocumentChunk[]): void {
  getDocsCache().set(doc.id, doc);
  persistDocs();
  persistChunks(doc.id, chunks);
}

export function getDocument(id: string): Document | undefined {
  return getDocsCache().get(id);
}

export function getAllDocuments(): Document[] {
  return Array.from(getDocsCache().values()).sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );
}

export function deleteDocument(id: string): boolean {
  const cache = getDocsCache();
  const existed = cache.has(id);
  if (existed) {
    cache.delete(id);
    persistDocs();
    // Remove chunks file from /tmp
    try {
      const p = chunksPath(id);
      if (existsSync(p)) unlinkSync(p);
    } catch {
      // ignore cleanup errors
    }
  }
  return existed;
}

export function getChunks(documentId: string): DocumentChunk[] {
  return loadChunks(documentId);
}

export function getAllChunks(): DocumentChunk[] {
  const all: DocumentChunk[] = [];
  getDocsCache().forEach((_, id) => {
    all.push(...loadChunks(id));
  });
  return all;
}

export function getChunksByDocumentIds(documentIds: string[]): DocumentChunk[] {
  const result: DocumentChunk[] = [];
  for (const id of documentIds) {
    result.push(...loadChunks(id));
  }
  return result;
}
