// pages/api/affiduser.ts
import type { NextApiRequest, NextApiResponse } from "next";

const UPSTREAM = "https://primary-production-e6a4.up.railway.app/webhook/affiduser";
// FIXO para evitar erro de env:
const BEARER  = "z3Q7pK1vM8yXnF4$dW9@R0LbV5gT2uH!eSj6Yr&PqXc8ZtB";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let { user_id, user_email } = (req.body || {}) as { user_id?: any; user_email?: any };

    // normaliza como sua versão que funciona
    if (user_id === "" || user_id === undefined) user_id = null;
    if (typeof user_id === "string" && /^\d+$/.test(user_id)) user_id = Number(user_id);
    if (user_email === "" || user_email === undefined) user_email = null;

    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${BEARER}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id, user_email }),
    });

    const text = await upstream.text();
    const ct = upstream.headers.get("content-type") || "application/json; charset=utf-8";

    res.status(upstream.status).setHeader("Content-Type", ct).send(text);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "proxy_error" });
  }
}
