}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "*");
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
res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

if (req.method === "OPTIONS") return res.status(200).end();

const url = new URL(req.url, `http://${req.headers.host}`);
const pathParts = url.pathname.replace(/^\/api\/sheets\/?/, "").split("/");
const sheetName = pathParts[0] ? decodeURIComponent(pathParts[0]) : null;
  const action = pathParts[1]; // 'cell', 'row', 'meta'
  const action = pathParts[1];

try {
const sheets = await getSheetsClient();

    // GET /api/sheets — list all sheets
if (!sheetName && req.method === "GET") {
const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
const names = (meta.data.sheets || []).map((s) => s.properties?.title || "");
return res.json({ sheets: names });
}

    // GET /api/sheets/:name — get sheet data
if (sheetName && !action && req.method === "GET") {
try {
const data = await getSheetData(sheets, sheetName);
@@ -88,14 +98,12 @@ module.exports = async function handler(req, res) {
}
}

    // GET /api/sheets/:name/meta
if (sheetName && action === "meta" && req.method === "GET") {
const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
const sheet = meta.data.sheets?.find((s) => s.properties?.title === sheetName);
return res.json({ sheet: sheet?.properties || null });
}

    // PUT /api/sheets/:name/cell
if (sheetName && action === "cell" && (req.method === "PUT" || req.method === "POST")) {
const { row, col, value } = req.body;
let oldRowData = null;
@@ -122,7 +130,6 @@ module.exports = async function handler(req, res) {
return res.json({ success: true });
}

    // POST /api/sheets/:name/row — append row
if (sheetName && action === "row" && req.method === "POST" && !pathParts[2]) {
const { values } = req.body;
const doAppend = async () => {
@@ -154,7 +161,6 @@ module.exports = async function handler(req, res) {
return res.json({ success: true });
}

    // POST /api/sheets/:name/row/insert
if (sheetName && action === "row" && pathParts[2] === "insert" && req.method === "POST") {
const { afterRow, values } = req.body;
const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
@@ -174,7 +180,6 @@ module.exports = async function handler(req, res) {
return res.json({ success: true });
}

    // DELETE /api/sheets/:name/row/:rowIndex
if (sheetName && action === "row" && pathParts[2] && req.method === "DELETE") {
const rowIndex = parseInt(pathParts[2]);
let deletedRow = null;
