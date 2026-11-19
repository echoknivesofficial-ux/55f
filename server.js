const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

let state = {
  funds: Number(process.env.FUNDS_AMOUNT ?? 0),
  weeklyAmount: 200,
  members: ["Member 1", "Member 2", "Member 3"],
  fridays: {} // { "2026-11-20": { "Member 1": true } }
};

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function formatPhp(amount) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
  }).format(amount);
}

app.get("/funds", (req, res) => {
  const formatted = formatPhp(state.funds);
  res.json({
    funds: state.funds,
    currency: "PHP",
    formatted,
    message: `the funds are ${formatted}`
  });
});

app.get("/tracker", (req, res) => {
  res.json(state);
});

app.post("/tracker", (req, res) => {
  const apiKey = process.env.API_KEY;
  if (apiKey && req.headers["x-api-key"] !== apiKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { funds, weeklyAmount, members, fridays } = req.body;
  if (typeof funds === "number" && !Number.isNaN(funds)) state.funds = funds;
  if (typeof weeklyAmount === "number") state.weeklyAmount = weeklyAmount;
  if (Array.isArray(members)) state.members = members;
  if (fridays && typeof fridays === "object") state.fridays = fridays;

  res.json({
    ...state,
    formatted: formatPhp(state.funds),
    message: `the funds are ${formatPhp(state.funds)}`
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
