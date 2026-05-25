import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { NextRequest } from "next/server";
import { getAllChunks, getChunksByDocumentIds } from "@/lib/document-store";
import { findRelevantChunks, buildContext } from "@/lib/rag";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { messages, activeDocumentIds } = await req.json();

  if (!messages || !Array.isArray(messages)) {
    return new Response("Invalid request", { status: 400 });
  }

  // Retrieve latest user message for RAG search
  const lastUserMessage = [...messages]
    .reverse()
    .find((m: { role: string }) => m.role === "user");
  const query = lastUserMessage?.content ?? "";

  // Build RAG context
  let systemPrompt =
    "あなたは社内向けのAIアシスタントです。丁寧かつ正確に質問に答えてください。";

  if (query) {
    const chunks =
      activeDocumentIds && activeDocumentIds.length > 0
        ? getChunksByDocumentIds(activeDocumentIds)
        : getAllChunks();

    if (chunks.length > 0) {
      const relevant = findRelevantChunks(query, chunks, 5);
      const context = buildContext(relevant);

      if (context) {
        systemPrompt += `

以下の社内文書の内容を参考にして回答してください。文書に関係する質問には、必ず文書の内容に基づいて回答してください。文書に記載されていない情報については、その旨を明示してください。

=== 参考文書 ===
${context}
=== 参考文書ここまで ===`;
      }
    }
  }

  const anthropic = createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const result = await streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: systemPrompt,
    messages,
    maxTokens: 4096,
  });

  return result.toDataStreamResponse();
}
