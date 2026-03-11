const { google } = require("googleapis");

const SPREADSHEET_ID = "1sIzswZnMkyRPJejAsE_ylSKzAF0RmFiACP4jYtz-AE0";

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowedOrigins = [
    "https://izmir-dt.github.io",
    "http://localhost:5173",
    "http://localhost:3000",
  ];
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "https://izmir-dt.github.io");
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function getAuthClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetsClient() {
  const auth = getAuthClient();
  return google.sheets({ version: "v4", auth });
}

async function getSheetData(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "BİLDİRİMLER",
  });
  const values = res.data.values || [];
  if (values.length === 0) return { headers: [], rows: [] };
  const headers = values[0].map((h) => String(h));
  const rows = values.slice(1);
  return { headers, rows };
}

async function getSheetId(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets?.find(
    (s) => s.properties?.title === "BİLDİRİMLER"
  );
  return sheet?.properties?.sheetId ?? null;
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const isOldest = url.pathname.endsWith("/oldest");

  try {
    const sheets = await getSheetsClient();

    // GET /api/notifications — tüm bildirimleri getir
    if (req.method === "GET" && !isOldest) {
      const data = await getSheetData(sheets);
      return res.json(data);
    }

    // DELETE /api/notifications — tüm bildirimleri sil (başlık satırı hariç)
    if (req.method === "DELETE" && !isOldest) {
      const { rows } = await getSheetData(sheets);
      if (rows.length === 0) return res.json({ success: true, deleted: 0 });

      const sheetId = await getSheetId(sheets);
      if (sheetId === null)
        return res.status(404).json({ error: "BİLDİRİMLER sheet not found" });

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: 1,             // başlık satırını koru
                  endIndex: rows.length + 1,
                },
              },
            },
          ],
        },
      });

      return res.json({ success: true, deleted: rows.length });
    }

    // DELETE /api/notifications/oldest — en eski 20 bildirimi sil
    if (req.method === "DELETE" && isOldest) {
      const { rows } = await getSheetData(sheets);
      if (rows.length === 0) return res.json({ success: true, deleted: 0 });

      const deleteCount = Math.min(20, rows.length);
      const sheetId = await getSheetId(sheets);
      if (sheetId === null)
        return res.status(404).json({ error: "BİLDİRİMLER sheet not found" });

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: 1,              // başlık sonrasından başla
                  endIndex: 1 + deleteCount,  // ilk N satırı sil
                },
              },
            },
          ],
        },
      });

      return res.json({ success: true, deleted: deleteCount });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Notifications API Error:", err);
    return res.status(500).json({ error: err.message });
  }
};
