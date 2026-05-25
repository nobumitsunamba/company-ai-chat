/**
 * Simple RAG (Retrieval-Augmented Generation) using TF-IDF cosine similarity.
 * No external embedding API required — pure in-process computation.
 */

import type { DocumentChunk } from "@/types";

// ─── Tokenization ────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    // Keep Japanese characters, alphanumeric, and separators
    .replace(/[^\w\s　-鿿＀-￯]/g, " ")
    .split(/[\s　]+/)
    .filter((w) => w.length > 1);
}

// ─── TF-IDF ──────────────────────────────────────────────────────────────────

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  // Normalize by doc length
  for (const [term, count] of tf) {
    tf.set(term, count / tokens.length);
  }
  return tf;
}

function buildIDF(chunks: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  const N = chunks.length;

  for (const tokens of chunks) {
    const seen = new Set(tokens);
    for (const term of seen) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1);
  }
  return idf;
}

function tfidfVector(
  tf: Map<string, number>,
  idf: Map<string, number>
): Map<string, number> {
  const vec = new Map<string, number>();
  for (const [term, tfVal] of tf) {
    const idfVal = idf.get(term) ?? 1;
    vec.set(term, tfVal * idfVal);
  }
  return vec;
}

function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>
): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, valA] of a) {
    const valB = b.get(term) ?? 0;
    dot += valA * valB;
    normA += valA * valA;
  }
  for (const [, valB] of b) {
    normB += valB * valB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ScoredChunk {
  chunk: DocumentChunk;
  score: number;
}

/**
 * Find the top-k most relevant chunks for a query.
 */
export function findRelevantChunks(
  query: string,
  chunks: DocumentChunk[],
  topK = 5
): ScoredChunk[] {
  if (chunks.length === 0) return [];

  const chunkTokens = chunks.map((c) => tokenize(c.content));
  const idf = buildIDF(chunkTokens);

  const queryTokens = tokenize(query);
  const queryTF = termFrequency(queryTokens);
  const queryVec = tfidfVector(queryTF, idf);

  const scored: ScoredChunk[] = chunks.map((chunk, i) => {
    const chunkTF = termFrequency(chunkTokens[i]);
    const chunkVec = tfidfVector(chunkTF, idf);
    const score = cosineSimilarity(queryVec, chunkVec);
    return { chunk, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter((s) => s.score > 0);
}

/**
 * Build a context string from retrieved chunks to inject into the prompt.
 */
export function buildContext(chunks: ScoredChunk[]): string {
  if (chunks.length === 0) return "";

  const parts = chunks.map(({ chunk }, i) => {
    return `【参考資料 ${i + 1}: ${chunk.documentName}】\n${chunk.content}`;
  });

  return parts.join("\n\n---\n\n");
}
