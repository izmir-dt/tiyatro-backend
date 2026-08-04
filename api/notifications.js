const { google } = require("googleapis");

const SPREADSHEET_ID = "1sIzswZnMkyRPJejAsE_ylSKzAF0RmFiACP4jYtz-AE0";

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed =
    origin === "https://izmir-dt.github.io" ||
    /^http:\/\/localhost:\d+$/.test(origin) ||
    /\.lovable\.app$/.test(origin.replace(/^https?:\/\//, "").split("/")[0] || "");
  res.setHeader(
    "Access-Control-Allow-Origin",
    allowed && origin ? origin : "https://izmir-dt.github.io"
  );
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

async function deleteRows(sheets, startIndex, endIndex) {
  const sheetId = await getSheetId(sheets);
  if (sheetId === null) return false;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex, endIndex },
          },
        },
      ],
    },
  });
  return true;
}

function norm(v) {
  return String(v ?? "").trim();
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      return {};
    }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

/**
 * Tek bir bildirim satırını içeriğine göre bulup siler.
 * Böylece silme işlemi tüm cihazlarda geçerli olur.
 */
async function deleteMatchingRow(sheets, payload) {
  const { headers, rows } = await getSheetData(sheets);
  if (!rows.length) return 0;

  const lower = headers.map((h) =>
    String(h)
      .replace(/İ/g, "i")
      .replace(/I/g, "ı")
      .toLowerCase()
      .trim()
  );
  const ix = (k) => lower.findIndex((h) => h.startsWith(k));
  const turIx = [ix("işlem"), ix("tür"), ix("tur"), ix("islem")].find((i) => i >= 0);
  const cols = {
    tarih: Math.max(0, ix("tarih")),
    tur: turIx === undefined ? -1 : turIx,
    oyun: ix("oyun"),
    kisi: ix("kişi"),
    gorev: ix("görev"),
    aciklama: ix("açıklama"),
  };

  const keys = ["tarih", "tur", "oyun", "kisi", "gorev", "aciklama"];
  const target = rows.findIndex((row) =>
    keys.every((k) => {
      const c = cols[k];
      if (c < 0) return true;
      if (payload[k] === undefined) return true;
      return norm(row[c]) === norm(payload[k]);
    })
  );

  if (target < 0) return 0;
  const rowIndex = target + 1; // başlık satırı offset
  const ok = await deleteRows(sheets, rowIndex, rowIndex + 1);
  return ok ? 1 : 0;
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const isOldest = url.pathname.endsWith("/oldest");
  const isDeleteRow = url.pathname.endsWith("/delete-row");

  try {
    const sheets = await getSheetsClient();

    // POST /api/notifications/delete-row — tek bildirimi herkes için sil
    if (isDeleteRow && (req.method === "POST" || req.method === "DELETE")) {
      const payload = await readBody(req);
      const deleted = await deleteMatchingRow(sheets, payload);
      return res.json({ success: true, deleted });
    }

    // GET /api/notifications — tüm bildirimleri getir
    if (req.method === "GET" && !isOldest && !isDeleteRow) {
      const data = await getSheetData(sheets);
      res.setHeader("Cache-Control", "no-store");
      return res.json(data);
    }

    // DELETE /api/notifications — tüm bildirimleri sil (başlık satırı hariç)
    if (req.method === "DELETE" && !isOldest && !isDeleteRow) {
      const { rows } = await getSheetData(sheets);
      if (rows.length === 0) return res.json({ success: true, deleted: 0 });
      const ok = await deleteRows(sheets, 1, rows.length + 1);
      if (!ok) return res.status(404).json({ error: "BİLDİRİMLER sheet not found" });
      return res.json({ success: true, deleted: rows.length });
    }

    // DELETE /api/notifications/oldest — en eski 20 bildirimi sil
    if (req.method === "DELETE" && isOldest) {
      const { rows } = await getSheetData(sheets);
      if (rows.length === 0) return res.json({ success: true, deleted: 0 });
      const deleteCount = Math.min(20, rows.length);
      const ok = await deleteRows(sheets, 1, 1 + deleteCount);
      if (!ok) return res.status(404).json({ error: "BİLDİRİMLER sheet not found" });
      return res.json({ success: true, deleted: deleteCount });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Notifications API Error:", err);
    return res.status(500).json({ error: err.message });
  }
};
