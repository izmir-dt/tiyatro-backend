const { google } = require("googleapis");

const SPREADSHEET_ID = "1sIzswZnMkyRPJejAsE_ylSKzAF0RmFiACP4jYtz-AE0";

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

async function getSheetData(sheets, sheetName) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
  });

  const values = result.data.values || [];
  const headers = values[0] || [];
  const rows = values.slice(1);

  return { headers, rows };
}

module.exports = async function handler(req, res) {
  // ----- CORS -----
  const origin = req.headers.origin || "";
  const allowedOrigins = ["https://izmir-dt.github.io"];

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.replace(/^\/api\/sheets\/?/, "").split("/");

  const sheetName = pathParts[0] ? decodeURIComponent(pathParts[0]) : null;
  const action = pathParts[1];

  try {
    const sheets = await getSheetsClient();

    // LIST SHEETS
    if (!sheetName && req.method === "GET") {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
      });

      const names = (meta.data.sheets || []).map(
        (s) => s.properties?.title || ""
      );

      return res.json({ sheets: names });
    }

    // GET SHEET DATA
    if (sheetName && !action && req.method === "GET") {
      const data = await getSheetData(sheets, sheetName);
      return res.json(data);
    }

    // UPDATE CELL
    if (sheetName && action === "cell" && (req.method === "PUT" || req.method === "POST")) {
      const { row, col, value } = req.body;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!${col}${row}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[value]] },
      });

      return res.json({ success: true });
    }

    // APPEND ROW
    if (sheetName && action === "row" && req.method === "POST") {
      const body = req.body;

      // Eğer frontend tek satır array gönderiyorsa
      const values = Array.isArray(body.values[0])
        ? body.values
        : [body.values];

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: sheetName,
        valueInputOption: "USER_ENTERED",
        requestBody: { values },
      });

      return res.json({ success: true });
    }

    // DELETE ROW
    if (sheetName && action === "row" && pathParts[2] && req.method === "DELETE") {
      const rowIndex = parseInt(pathParts[2]);

      const meta = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
      });

      const sheet = meta.data.sheets.find(
        (s) => s.properties.title === sheetName
      );

      const sheetId = sheet.properties.sheetId;

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: rowIndex - 1,
                  endIndex: rowIndex,
                },
              },
            },
          ],
        },
      });

      return res.json({ success: true });
    }

    return res.status(404).json({ error: "Not found" });

  } catch (err) {
    console.error("API Error:", err);
    return res.status(500).json({ error: err.message });
  }
};
