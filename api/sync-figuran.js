if (typeof req.body === "string") {
  try {
    req.body = JSON.parse(req.body);
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
}
const handler = require('./_lib/sheets.js');
module.exports = handler;
