const { google } = require("googleapis");

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1sIzswZnMkyRPJejAsE_ylSKzAF0RmFiACP4jYtz-AE0";

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

function normalizeText(s) {
  return String(s || "").trim().toLowerCase()
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
    .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/\s+/g, " ");
}

function splitPeopleTokens(text) {
  return String(text || "").replace(/\r/g, "\n").trim()
    .split(/[\n,;]+/g)
    .map(s => s.trim())
    .filter(Boolean);
}

function hasFiguranTag(token) {
  return /\(\s*fig[üu]ran\s*\)/i.test(String(token || ""));
}

function stripFiguranTag(token) {
  return String(token || "")
    .replace(/\(\s*fig[üu]ran\s*\)/ig, "")
    .replace(/^"+|"+$/g, "")
    .trim();
}

function findHeaderIndex(headerArr, candidates) {
  const hn = headerArr.map(x => String(x || "").trim());
  for (const c of candidates) {
    const idx = hn.indexOf(c);
    if (idx !== -1) return idx;
  }
  const lower = hn.map(x => x.toLocaleLowerCase("tr-TR"));
  for (const c of candidates) {
    const idx = lower.indexOf(String(c || "").toLocaleLowerCase("tr-TR"));
    if (idx !== -1) return idx;
  }
  return -1;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://izmir-dt.github.io");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const sheets = await getSheetsClient();

    // Önce spreadsheet metadata'sından sheet ID'lerini al
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    const sheetList = meta.data.sheets || [];
    const butunOyunlarSheet = sheetList.find(s => 
      s.properties.title === "BÜTÜN OYUNLAR" || 
      normalizeText(s.properties.title) === "butun oyunlar"
    );
    const figuranSheet = sheetList.find(s => 
      s.properties.title === "FİGÜRAN LİSTESİ" ||
      normalizeText(s.properties.title) === "figuran listesi"
    );

    if (!butunOyunlarSheet) {
      return res.status(400).json({ ok: false, error: "BÜTÜN OYUNLAR sayfası bulunamadı" });
    }
    if (!figuranSheet) {
      return res.status(400).json({ ok: false, error: "FİGÜRAN LİSTESİ sayfası bulunamadı" });
    }

    const butunOyunlarGid = butunOyunlarSheet.properties.sheetId;
    const figuranGid = figuranSheet.properties.sheetId;
    const butunOyunlarTitle = butunOyunlarSheet.properties.title;
    const figuranTitle = figuranSheet.properties.title;

    // batchGet ile veriyi çek - ranges array kullan
    const result = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges: [butunOyunlarTitle],
    });

    const allRows = result.data.valueRanges?.[0]?.values || [];
    if (allRows.length < 2) {
      return res.json({ ok: true, guncellenen: 0, mesaj: "Veri yok" });
    }

    const header = allRows[0].map(h => String(h || "").trim());
    const dataRows = allRows.slice(1);

    const colOyun     = findHeaderIndex(header, ["Oyun Adı", "Oyun Adi", "Oyun"]);
    const colKategori = findHeaderIndex(header, ["Kategori"]);
    const colGorev    = findHeaderIndex(header, ["Görev", "Gorev"]);
    const colKisi     = findHeaderIndex(header, ["Kişi", "Kisi"]);

    if ([colOyun, colKategori, colGorev, colKisi].some(i => i === -1)) {
      return res.status(400).json({ ok: false, error: 'Kolonlar bulunamadı. Başlıklar: "Oyun Adı", "Kategori", "Görev", "Kişi" bekleniyor.' });
    }

    const map = new Map();

    for (const row of dataRows) {
      const oyun        = String(row[colOyun]     || "").trim();
      const kategoriRaw = String(row[colKategori] || "").trim();
      const gorevRaw    = String(row[colGorev]    || "").trim();
      const kisiRaw     = String(row[colKisi]     || "").trim();

      if (!kisiRaw) continue;

      const katNorm = normalizeText(kategoriRaw);
      const isEmekli  = katNorm.includes("kurumdan emekli");
      const isFiguran = katNorm.includes("figuran");

      if (!isEmekli && !isFiguran) continue;

      const tokens = splitPeopleTokens(kisiRaw);
      if (!tokens.length) continue;

      let selectedPeople = [];

      if (isEmekli) {
        selectedPeople = tokens.map(stripFiguranTag).filter(Boolean);
      } else {
        if (tokens.length === 1) {
          selectedPeople = [stripFiguranTag(tokens[0])].filter(Boolean);
        } else {
          const tagged = tokens.filter(hasFiguranTag).map(stripFiguranTag).filter(Boolean);
          selectedPeople = tagged.length ? tagged : tokens.map(stripFiguranTag).filter(Boolean);
        }
      }

      if (!selectedPeople.length) continue;

      for (const kisi of selectedPeople) {
        if (!map.has(kisi)) {
          map.set(kisi, { kategoriler: new Set(), gorevler: new Set(), oyunlar: new Set() });
        }
        const obj = map.get(kisi);
        obj.kategoriler.add(isEmekli ? "Kurumdan Emekli Sanatçı" : "Figüran");
        if (gorevRaw) obj.gorevler.add(gorevRaw);
        if (oyun)     obj.oyunlar.add(oyun);
      }
    }

    const peopleSorted = Array.from(map.keys()).sort((a, b) => a.localeCompare(b, "tr"));

    const outputRows = peopleSorted.map((kisi, index) => {
      const obj = map.get(kisi);
      return [
        index + 1,
        kisi,
        Array.from(obj.kategoriler).join(", "),
        Array.from(obj.gorevler).join(", "),
        Array.from(obj.oyunlar).join(", "),
      ];
    });

    // FİGÜRAN LİSTESİ'ni temizle ve yaz - batchUpdate kullan
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${figuranTitle}!A2:Z10000`,
    });

    if (outputRows.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${figuranTitle}!A2`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: outputRows },
      });
    }

    return res.json({
      ok: true,
      guncellenen: outputRows.length,
      mesaj: `${outputRows.length} figüran güncellendi`,
    });

  } catch (err) {
    console.error("SYNC FIGURAN ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
