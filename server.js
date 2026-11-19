const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const FUNDS_FILE = path.join(__dirname, "funds.json");

app.use(express.json());

function readFunds() {
  const raw = fs.readFileSync(FUNDS_FILE, "utf8");
  return JSON.parse(raw);
}

function writeFunds(data) {
  fs.writeFileSync(FUNDS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function formatPhp(amount) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
  }).format(amount);
}

// Health check for Render
app.get("/", (req, res) => {
  res.json({ status: "ok", endpoint: "/funds" });
});

// Returns both structured JSON and a formatted PHP sentence
app.get("/funds", (req, res) => {
  try {
    const data = readFunds();
    const formatted = formatPhp(data.funds);
    res.json({
      funds: data.funds,
      currency: "PHP",
      formatted,
      message: `the funds are ${formatted}`
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to read funds data" });
  }
});

// Optional: update funds via POST (set API_KEY in Render Environment Variables)
app.post("/funds", (req, res) => {
  const apiKey = process.env.API_KEY;
  if (apiKey && req.headers["x-api-key"] !== apiKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { funds } = req.body;
  if (typeof funds !== "number" || Number.isNaN(funds)) {
    return res.status(400).json({ error: "Body must include a numeric 'funds' field" });
  }

  const nextData = {
    funds,
    currency: "PHP",
    updatedAt: new Date().toISOString()
  };

  writeFunds(nextData);
  const formatted = formatPhp(nextData.funds);

  res.json({
    funds: nextData.funds,
    currency: "PHP",
    formatted,
    message: `the funds are ${formatted}`
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
