module.exports = async function handler(req, res) {

  // ---- CORS ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ---- BODY FIX (Vercel) ----
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ ok:false, error:"json_parse_failed" });
    }
  }

  try {

    if (!body) {
      return res.status(400).json({ ok:false, error:"empty_body" });
    }

    // BURADA ESKİ KODUNDA NE YAPIYORSAN AYNI ŞEYİ YAPACAĞIZ
    // sadece req.body yerine body kullan

    // örnek:
    // const ad = body.ad;

    // GEÇİCİ TEST CEVABI (Google'a ulaşabiliyor mu anlayacağız)
    return res.status(200).json({ ok:true, debug:"api_working" });

  } catch (err) {
    console.error("SYNC FIGURAN ERROR:", err);
    return res.status(500).json({ ok:false, error:String(err) });
  }
};
