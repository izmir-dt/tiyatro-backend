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

// ---- HELPERS (App Script mantığının birebir JS karşılığı) ----

function normalizeText(s) {
  return String(s || "").trim().toLowerCase()
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
    .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/\s+/g, " ");
}

// Kişi hücresini virgül / noktalı virgül / yeni satır ile böl
function splitPeopleTokens(text) {
  return String(text || "").replace(/\r/g, "\n").trim()
    .split(/[\n,;]+/g)
    .map(s => s.trim())
    .filter(Boolean);
}

// (Figüran) etiketi var mı?
function hasFiguranTag(token) {
  return /\(\s*fig[üu]ran\s*\)/i.test(String(token || ""));
}

// (Figüran) etiketini ve tırnak işaretlerini sök
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

// ---- ANA HANDLER ----

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://izmir-dt.github.io");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const sheets = await getSheetsClient();

    // BÜTÜN OYUNLAR'ı oku
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "BÜTÜN OYUNLAR",
    });

    const allRows = result.data.values || [];
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

    // kişi adına göre grupla: { kategoriler: Set, gorevler: Set, oyunlar: Set }
    const map = new Map();

    for (const row of dataRows) {
      const oyun       = String(row[colOyun]     || "").trim();
      const kategoriRaw = String(row[colKategori] || "").trim();
      const gorevRaw   = String(row[colGorev]    || "").trim();
      const kisiRaw    = String(row[colKisi]     || "").trim();

      if (!kisiRaw) continue;

      const katNorm = normalizeText(kategoriRaw);
      const isEmekli  = katNorm.includes("kurumdan emekli");
      const isFiguran = katNorm.includes("figuran");

      // Sadece figüran veya kurumdan emekli kategorisi işlenir
      if (!isEmekli && !isFiguran) continue;

      const tokens = splitPeopleTokens(kisiRaw);
      if (!tokens.length) continue;

      let selectedPeople = [];

      if (isEmekli) {
        // Emekli: hücredeki herkesi al, (Figüran) etiketini sök
        selectedPeople = tokens.map(stripFiguranTag).filter(Boolean);
      } else {
        if (tokens.length === 1) {
          // Tek kişi: direkt al
          selectedPeople = [stripFiguranTag(tokens[0])].filter(Boolean);
        } else {
          // Çok kişi: sadece (Figüran) etiketli olanları al
          // Hiç etiket yoksa hepsini al
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

    // Sırala ve çıktı satırlarını oluştur
    const peopleSorted = Array.from(map.keys()).sort((a, b) => a.localeCompare(b, "tr"));

    // Sütunlar: Sıra No, Kişi, Kategori, Görevler, Görev Aldığı Oyunlar
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

    // FİGÜRAN LİSTESİ sayfasını temizle (başlık hariç)
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: "FİGÜRAN LİSTESİ!A2:Z10000",
    });

    // Yeni verileri yaz
    if (outputRows.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: "FİGÜRAN LİSTESİ!A2",
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
