import { NextRequest, NextResponse } from "next/server";

const UPSTREAM = "https://primary-production-e6a4.up.railway.app/webhook/affiduser";
// FIXO para evitar erro de env:
const BEARER  = "z3Q7pK1vM8yXnF4$dW9@R0LbV5gT2uH!eSj6Yr&PqXc8ZtB";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let { user_id, user_email } = body || {};

    // normaliza tipos (API espera number ou null)
    if (user_id === "" || user_id === undefined) user_id = null;
    if (typeof user_id === "string" && /^\d+$/.test(user_id)) user_id = Number(user_id);
    if (user_email === "" || user_email === undefined) user_email = null;

    const r = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${BEARER}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id, user_email }),
    });

    const text = await r.text();
    const ct = r.headers.get("content-type") || "application/json; charset=utf-8";
    return new NextResponse(text, { status: r.status, headers: { "Content-Type": ct } });
  } catch (e:any) {
    return NextResponse.json({ error: e?.message ?? "proxy_error" }, { status: 500 });
  }
}
