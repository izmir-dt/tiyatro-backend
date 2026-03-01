import { google } from "googleapis";

const SPREADSHEET_ID = "1sIzswZnMkyRPJejAsE_ylSKzAF0RmFiACP4jYtz-AE0";

function getAuthClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
}

async function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getAuthClient() });
}

async function getSheetData(sheets, sheetName) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: sheetName });
  const values = res.data.values || [];
  if (values.length === 0) return { headers: [], rows: [] };
  return { headers: values[0].map((h) => String(h)), rows: values.slice(1) };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const sheets = await getSheetsClient();
    const butunOyunlar = await getSheetData(sheets, "BÜTÜN OYUNLAR");
    const FIGURAN_SHEET = "FİGÜRAN LİSTESİ";

    const isFiguranKat = (k) => { const l = k.toLowerCase().trim(); return l.includes("figüran") || l.includes("figuran"); };
    const headers = butunOyunlar.headers.map((h) => h.trim().toLowerCase());
    const idxKisi = headers.findIndex((v) => v === "kişi" || v.startsWith("kişi"));
    const idxKat = headers.findIndex((v) => v === "kategori" || v.startsWith("kategori"));

    const figuranNames = new Set();
    butunOyunlar.rows.forEach((row) => {
      if (!isFiguranKat(String(row[idxKat] ?? ""))) return;
      String(row[idxKisi] ?? "").split(",").forEach((k) => { if (k.trim()) figuranNames.add(k.trim()); });
    });

    let listeData = { headers: [], rows: [] };
    try { listeData = await getSheetData(sheets, FIGURAN_SHEET); } catch {}

    const listeHeaders = listeData.headers.length ? listeData.headers : ["Kişi", "Kategori", "Oyunlar"];
    const existingNames = new Set(listeData.rows.map((r) => String(r[0] ?? "").trim()).filter(Boolean));
    const toAdd = Array.from(figuranNames).filter((n) => !existingNames.has(n));

    if (toAdd.length === 0) return res.json({ success: true, added: 0, message: "Tüm figüranlar zaten listede" });

    const newRows = toAdd.map((name) => { const row = listeHeaders.map(() => ""); row[0] = name; return row; });

    const doAppend = async () => {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID, range: FIGURAN_SHEET, valueInputOption: "USER_ENTERED",
        requestBody: { values: newRows },
      });
    };

    try {
      await doAppend();
    } catch (appendErr) {
      const msg = appendErr?.message || "";
      if (msg.includes("Unable to parse range") || appendErr?.code === 400) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: { requests: [{ addSheet: { properties: { title: FIGURAN_SHEET } } }] },
        });
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID, range: `${FIGURAN_SHEET}!A1`, valueInputOption: "USER_ENTERED",
          requestBody: { values: [listeHeaders] },
        });
        await doAppend();
      } else throw appendErr;
    }

    res.json({ success: true, added: toAdd.length, names: toAdd });
  } catch (err) {
    console.error("Sync figuran error:", err);
    res.status(500).json({ error: err.message });
  }
}
