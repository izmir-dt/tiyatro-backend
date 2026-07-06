const { google } = require("googleapis");

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1sIzswZnMkyRPJejAsE_ylSKzAF0RmFiACP4jYtz-AE0";
const SOURCE_SHEET = "BÜTÜN OYUNLAR";
const ARCHIVE_SHEET = "ARŞİV OYUNLAR";
const ARCHIVE_HEADERS = ["Oyun Adı", "Kategori", "Görev", "Kişi"];

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

function findHeaderIndex(headerArr, candidates) {
  const hn = headerArr.map((x) => String(x || "").trim());
  for (const c of candidates) {
    const idx = hn.indexOf(c);
    if (idx !== -1) return idx;
  }
  const lower = hn.map((x) => x.toLocaleLowerCase("tr-TR"));
  for (const c of candidates) {
    const idx = lower.indexOf(String(c || "").toLocaleLowerCase("tr-TR"));
    if (idx !== -1) return idx;
  }
  return -1;
}

async function writeNotification(sheets, { tur, oyun, kisi, gorev, aciklama }) {
  try {
    const now = new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "BİLDİRİMLER",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[now, tur, oyun || "", kisi || "", gorev || "", aciklama || "Web uygulamasından"]],
      },
    });
  } catch (err) {
    console.error("Notification write error (non-fatal):", err);
  }
}

module.exports = async function handler(req, res) {
  // ----- CORS (sheets.js ile aynı yapı) -----
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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const playName = String(req.body?.playName || "").trim();
  if (!playName) {
    return res.status(400).json({ error: "playName gerekli" });
  }

  try {
    const sheets = await getSheetsClient();

    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheetList = meta.data.sheets || [];

    const sourceSheet = sheetList.find((s) => s.properties?.title === SOURCE_SHEET);
    if (!sourceSheet) {
      return res.status(400).json({ error: `${SOURCE_SHEET} sayfası bulunamadı` });
    }
    const sourceSheetId = sourceSheet.properties.sheetId;

    // ARŞİV OYUNLAR sayfası yoksa oluştur (yönetici arayüzünde de aynı beklenti var)
    const archiveSheet = sheetList.find((s) => s.properties?.title === ARCHIVE_SHEET);
    if (!archiveSheet) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { requests: [{ addSheet: { properties: { title: ARCHIVE_SHEET } } }] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${ARCHIVE_SHEET}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [ARCHIVE_HEADERS] },
      });
    }

    // Kaynak sayfadaki tüm veriyi çek
    const sourceData = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: SOURCE_SHEET,
    });
    const values = sourceData.data.values || [];
    if (values.length < 2) {
      return res.status(404).json({ error: "Oyun bulunamadı" });
    }
    const header = values[0];
    const dataRows = values.slice(1);

    const oyunCol = findHeaderIndex(header, ["Oyun Adı", "Oyun Adi", "Oyun"]);
    const colIdx = oyunCol !== -1 ? oyunCol : 0;
    const targetName = playName.toLocaleLowerCase("tr-TR");

    const matchIndexes = [];
    const matchedRows = [];
    dataRows.forEach((row, idx) => {
      const val = String(row[colIdx] || "").trim().toLocaleLowerCase("tr-TR");
      if (val === targetName) {
        matchIndexes.push(idx);
        matchedRows.push(row);
      }
    });

    if (matchedRows.length === 0) {
      return res.status(404).json({ error: `"${playName}" oyununa ait satır bulunamadı` });
    }

    // 1) Eşleşen satırları ARŞİV OYUNLAR'a ekle
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: ARCHIVE_SHEET,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: matchedRows },
    });

    // 2) BÜTÜN OYUNLAR'dan sil (index kaymaması için büyükten küçüğe sıralı)
    const deleteRequests = [...matchIndexes]
      .sort((a, b) => b - a)
      .map((idx) => ({
        deleteDimension: {
          range: {
            sheetId: sourceSheetId,
            dimension: "ROWS",
            startIndex: idx + 1, // +1: başlık satırı offseti
            endIndex: idx + 2,
          },
        },
      }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: deleteRequests },
    });

    // 3) Bildirim yaz
    const kisiCol = findHeaderIndex(header, ["Kişi", "Kisi"]);
    const gorevCol = findHeaderIndex(header, ["Görev", "Gorev"]);
    await writeNotification(sheets, {
      tur: "ARŞİVLENDİ",
      oyun: playName,
      kisi: kisiCol !== -1 ? String(matchedRows[0][kisiCol] || "") : "",
      gorev: gorevCol !== -1 ? String(matchedRows[0][gorevCol] || "") : "",
      aciklama: `${playName} oyunu (${matchedRows.length} satır) ARŞİV OYUNLAR sayfasına taşındı`,
    });

    return res.json({ success: true, archivedRows: matchedRows.length });
  } catch (err) {
    console.error("ARCHIVE PLAY ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
};
