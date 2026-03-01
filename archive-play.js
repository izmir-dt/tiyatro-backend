import { google } from "googleapis";

const SPREADSHEET_ID = "1sIzswZnMkyRPJejAsE_ylSKzAF0RmFiACP4jYtz-AE0";

function getAuthClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
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

async function writeNotification(sheets, { tur, oyun, kisi, gorev, aciklama }) {
  try {
    const now = new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: "BİLDİRİMLER", valueInputOption: "USER_ENTERED",
      requestBody: { values: [[now, tur, oyun || "", kisi || "", gorev || "", aciklama || "Web uygulamasından"]] },
    });
  } catch (err) { console.error("Notification write error:", err); }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { playName } = req.body;
    if (!playName) return res.status(400).json({ error: "playName required" });
    const sheets = await getSheetsClient();

    const sourceData = await getSheetData(sheets, "BÜTÜN OYUNLAR");
    const matchingRows = sourceData.rows
      .map((row, idx) => ({ row, idx }))
      .filter(({ row }) => String(row[0] ?? "").trim() === playName.trim());

    if (matchingRows.length === 0) return res.status(404).json({ error: "Oyun bulunamadı" });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: "ARŞİV OYUNLAR", valueInputOption: "USER_ENTERED",
      requestBody: { values: matchingRows.map(({ row }) => row) },
    });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheet = meta.data.sheets?.find((s) => s.properties?.title === "BÜTÜN OYUNLAR");
    if (!sheet) return res.status(404).json({ error: "Kaynak sayfa bulunamadı" });
    const sheetId = sheet.properties?.sheetId;

    for (const rowIdx of matchingRows.map(({ idx }) => idx + 1).sort((a, b) => b - a)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowIdx, endIndex: rowIdx + 1 } } }] },
      });
    }

    await writeNotification(sheets, { tur: "ARŞİVLENDİ", oyun: playName, aciklama: `${matchingRows.length} satır ARŞİV OYUNLAR'a taşındı` });
    res.json({ success: true, archived: matchingRows.length });
  } catch (err) {
    console.error("Archive error:", err);
    res.status(500).json({ error: err.message });
  }
}
