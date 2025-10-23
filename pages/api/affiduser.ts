// pages/api/affiduser.ts
import type { NextApiRequest, NextApiResponse } from "next";

const RYAN_URL = process.env.RYAN_API_URL || "https://primary-production-e6a4.up.railway.app/webhook/affiduser";
const RYAN_BEARER = process.env.RYAN_BEARER || "";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { user_id = null, user_email = null } = req.body || {};
    if (!user_id && !user_email) {
      return res.status(400).json({ error: "Informe user_id ou user_email" });
    }

    const headers: Record<string,string> = {
      "Content-Type": "application/json",
      "Accept": "application/json"
    };
    // token só se existir
    if (RYAN_BEARER) headers["Authorization"] = `Bearer ${RYAN_BEARER}`;

    // manda snake e camel para máxima compatibilidade
    const body = JSON.stringify({
      user_id, user_email,
      userId: user_id,
      userEmail: user_email
    });

    const upstream = await fetch(RYAN_URL, { method: "POST", headers, body });
    const text = await upstream.text();
    let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }

    let affiliated: boolean | null = null;
    if (typeof data?.user === "boolean") affiliated = data.user;
    else if (typeof data?.affiliated === "boolean") affiliated = data.affiliated;
    else if (typeof data?.is_affiliate === "boolean") affiliated = data.is_affiliate;
    else if (typeof data?.isAffiliated === "boolean") affiliated = data.isAffiliated;
    else if (data?.status === "AFFILIATED" || data?.status === "OK") affiliated = true;
    else if (data?.status === "NOT_AFFILIATED" || data?.status === "NOT_FOUND") affiliated = false;

    return res.status(upstream.ok ? 200 : upstream.status).json({
      ok: upstream.ok,
      user: affiliated,
      upstream: data
    });
  } catch (e:any) {
    return res.status(500).json({ error: "Erro ao validar", detail: String(e?.message || e) });
  }
}
