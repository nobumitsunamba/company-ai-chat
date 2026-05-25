import { NextRequest, NextResponse } from "next/server";
import { getAllDocuments, deleteDocument } from "@/lib/document-store";

export const runtime = "nodejs";

/** GET /api/documents — list all uploaded documents */
export async function GET() {
  const documents = getAllDocuments();
  return NextResponse.json({ documents });
}

/** DELETE /api/documents?id=xxx — remove a document */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id が指定されていません" }, { status: 400 });
  }

  const deleted = deleteDocument(id);

  if (!deleted) {
    return NextResponse.json({ error: "文書が見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
