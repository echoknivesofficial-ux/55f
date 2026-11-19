const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Luckyboi";

let state = {
  extraFunds: Number(process.env.FUNDS_AMOUNT ?? 0),
  weeklyAmount: 200,
  members: ["Daeniel", "Ivan", "Aldrich", "Jordan", "Yzhan", "Marquis"],
  fridays: {},
  pulloutRequests: []
};

app.use(express.json());

// Allow requests from any HTML page (local file, GitHub Pages, etc.)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-password");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Serve public/index.html if present
app.use(express.static(path.join(__dirname, "public")));

function formatPhp(amount) {
  const num = Number(amount);
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
  }).format(Number.isFinite(num) ? num : 0);
}

function getMemberContributed(name) {
  const target = String(name || "").trim().toLowerCase();
  const matchedMember = state.members.find(
    m => String(m).trim().toLowerCase() === target
  );

  if (!matchedMember) {
    return {
      matchedMember: null,
      contributed: 0,
      approvedPullouts: 0,
      available: 0
    };
  }

  let paidFridays = 0;
  for (const dateKey of Object.keys(state.fridays || {})) {
    const dayRecord = state.fridays[dateKey];
    if (dayRecord && dayRecord[matchedMember]) {
      paidFridays++;
    }
  }

  const contributed = paidFridays * state.weeklyAmount;
  const approvedPullouts = (state.pulloutRequests || [])
    .filter(
      r =>
        r.status === "approved" &&
        String(r.fullName || "").trim().toLowerCase() === target
    )
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  return {
    matchedMember,
    contributed,
    approvedPullouts,
    available: Math.max(0, contributed - approvedPullouts)
  };
}

function calculateTotalFunds() {
  let totalContributed = 0;
  for (const dateKey of Object.keys(state.fridays || {})) {
    const dayRecord = state.fridays[dateKey] || {};
    for (const member of state.members || []) {
      if (dayRecord[member]) {
        totalContributed += state.weeklyAmount;
      }
    }
  }

  const totalApprovedPullouts = (state.pulloutRequests || [])
    .filter(r => r.status === "approved")
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const baseExtra = Number(state.extraFunds) || 0;
  return Math.max(0, baseExtra + totalContributed - totalApprovedPullouts);
}

function checkAdmin(req, res) {
  const pass = req.headers["x-admin-password"];
  if (pass !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Invalid admin password" });
    return false;
  }
  return true;
}

// Root check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "funds-api",
    endpoints: ["/funds", "/public-info", "/pullout-request", "/admin/state"]
  });
});

// Main funds endpoint
app.get("/funds", (req, res) => {
  try {
    const total = calculateTotalFunds();
    const formatted = formatPhp(total);
    res.json({
      funds: total,
      currency: "PHP",
      formatted,
      message: `the funds are ${formatted}`
    });
  } catch (err) {
    console.error("GET /funds error:", err);
    res.status(500).json({ error: "Server error reading funds" });
  }
});

// Public balance + member pull-out lookup
app.get("/public-info", (req, res) => {
  try {
    const total = calculateTotalFunds();
    const name = req.query.name ? String(req.query.name) : "";
    const memberInfo = name ? getMemberContributed(name) : null;

    res.json({
      totalFunds: total,
      formattedTotal: formatPhp(total),
      weeklyAmount: state.weeklyAmount,
      memberInfo
    });
  } catch (err) {
    console.error("GET /public-info error:", err);
    res.status(500).json({ error: "Server error reading public info" });
  }
});

// Submit pull-out request
app.post("/pullout-request", (req, res) => {
  try {
    const { fullName, amount, agreedTos } = req.body || {};

    if (!fullName || typeof fullName !== "string" || fullName.trim().length < 3) {
      return res.status(400).json({
        error: "Please enter your full name (e.g. Juan V. Dela Cruz)."
      });
    }
    if (!agreedTos) {
      return res.status(400).json({
        error: "You must agree to the Terms of Service."
      });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        error: "Enter a valid pull-out amount greater than ₱0."
      });
    }

    const info = getMemberContributed(fullName);
    if (!info.matchedMember) {
      return res.status(404).json({
        error: "Full name not found in member list. Check spelling and middle initial."
      });
    }
    if (numericAmount > info.available) {
      return res.status(400).json({
        error: `You can only pull out up to ${formatPhp(info.available)}.`
      });
    }

    const requestItem = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      fullName: info.matchedMember,
      amount: numericAmount,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    state.pulloutRequests.unshift(requestItem);
    res.json({ ok: true, request: requestItem });
  } catch (err) {
    console.error("POST /pullout-request error:", err);
    res.status(500).json({ error: "Server error submitting pull-out request" });
  }
});

// Admin state
app.get("/admin/state", (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const total = calculateTotalFunds();
    res.json({
      ...state,
      totalFunds: total,
      formattedTotal: formatPhp(total)
    });
  } catch (err) {
    console.error("GET /admin/state error:", err);
    res.status(500).json({ error: "Server error reading admin state" });
  }
});

// Admin update funds, members, or Fridays
app.post("/admin/update", (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { extraFunds, members, fridays } = req.body || {};

    if (typeof extraFunds === "number" && Number.isFinite(extraFunds)) {
      state.extraFunds = extraFunds;
    }
    if (Array.isArray(members)) {
      state.members = members.map(m => String(m).trim()).filter(Boolean);
    }
    if (fridays && typeof fridays === "object" && !Array.isArray(fridays)) {
      state.fridays = fridays;
    }

    const total = calculateTotalFunds();
    const formatted = formatPhp(total);

    res.json({
      ...state,
      totalFunds: total,
      formattedTotal: formatted,
      message: `the funds are ${formatted}`
    });
  } catch (err) {
    console.error("POST /admin/update error:", err);
    res.status(500).json({ error: "Server error updating state" });
  }
});

// Admin approve/reject pull-out
app.post("/admin/pullout/:id", (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { action } = req.body || {};
    const item = state.pulloutRequests.find(r => r.id === req.params.id);
    if (!item) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (action === "approved" || action === "rejected") {
      item.status = action;
    }

    const total = calculateTotalFunds();
    res.json({
      ...state,
      totalFunds: total,
      formattedTotal: formatPhp(total)
    });
  } catch (err) {
    console.error("POST /admin/pullout error:", err);
    res.status(500).json({ error: "Server error updating pull-out request" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
