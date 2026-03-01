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
  res.setHeader("Access-Control-Allow-Methods", "DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });

  const url = new URL(req.url, `http://${req.headers.host}`);
  const isOldest = url.pathname.includes("/oldest");

  try {
    const sheets = await getSheetsClient();
    const data = await getSheetData(sheets, "BİLDİRİMLER");
    if (data.rows.length === 0) return res.json({ success: true, deleted: 0 });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheet = meta.data.sheets?.find((s) => s.properties?.title === "BİLDİRİMLER");
    if (!sheet) return res.status(404).json({ error: "Sheet not found" });
    const sheetId = sheet.properties?.sheetId;

    const deleteCount = isOldest ? Math.min(20, data.rows.length) : data.rows.length;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: deleteCount + 1 } } }] },
    });

    res.json({ success: true, deleted: deleteCount });
  } catch (err) {
    console.error("Notification delete error:", err);
    res.status(500).json({ error: err.message });
  }
}
