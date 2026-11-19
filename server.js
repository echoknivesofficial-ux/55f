const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Luckyboi";

let state = {
  extraFunds: Number(process.env.FUNDS_AMOUNT ?? 0), // manual additions/adjustments
  weeklyAmount: 200,
  members: ["Juan V. Dela Cruz", "Maria S. Santos"],
  fridays: {}, // { "2026-11-20": { "Juan V. Dela Cruz": true } }
  pulloutRequests: [] // { id, fullName, amount, status: "pending"|"approved"|"rejected", createdAt }
};

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function formatPhp(amount) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
  }).format(amount);
}

function getMemberContributed(name) {
  const target = name.trim().toLowerCase();
  const matchedMember = state.members.find(m => m.trim().toLowerCase() === target);
  if (!matchedMember) return { matchedMember: null, contributed: 0, approvedPullouts: 0, available: 0 };

  let paidFridays = 0;
  for (const dateKey of Object.keys(state.fridays)) {
    if (state.fridays[dateKey] && state.fridays[dateKey][matchedMember]) {
      paidFridays++;
    }
  }

  const contributed = paidFridays * state.weeklyAmount;
  const approvedPullouts = state.pulloutRequests
    .filter(r => r.status === "approved" && r.fullName.trim().toLowerCase() === target)
    .reduce((sum, r) => sum + r.amount, 0);

  return {
    matchedMember,
    contributed,
    approvedPullouts,
    available: Math.max(0, contributed - approvedPullouts)
  };
}

function calculateTotalFunds() {
  let totalContributed = 0;
  for (const dateKey of Object.keys(state.fridays)) {
    const dayRecord = state.fridays[dateKey] || {};
    for (const member of state.members) {
      if (dayRecord[member]) totalContributed += state.weeklyAmount;
    }
  }

  const totalApprovedPullouts = state.pulloutRequests
    .filter(r => r.status === "approved")
    .reduce((sum, r) => sum + r.amount, 0);

  return Math.max(0, state.extraFunds + totalContributed - totalApprovedPullouts);
}

function checkAdmin(req, res) {
  const pass = req.headers["x-admin-password"];
  if (pass !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Invalid admin password" });
    return false;
  }
  return true;
}

// Public API endpoint for your bot/webhook
app.get("/funds", (req, res) => {
  const total = calculateTotalFunds();
  const formatted = formatPhp(total);
  res.json({
    funds: total,
    currency: "PHP",
    formatted,
    message: `the funds are ${formatted}`
  });
});

// Public summary + member lookup
app.get("/public-info", (req, res) => {
  const total = calculateTotalFunds();
  const name = (req.query.name || "").toString();
  const memberInfo = name ? getMemberContributed(name) : null;

  res.json({
    totalFunds: total,
    formattedTotal: formatPhp(total),
    weeklyAmount: state.weeklyAmount,
    memberInfo
  });
});

// Public pull-out request submission
app.post("/pullout-request", (req, res) => {
  const { fullName, amount, agreedTos } = req.body;

  if (!fullName || typeof fullName !== "string" || fullName.trim().length < 3) {
    return res.status(400).json({ error: "Please enter your full name (e.g. Juan V. Dela Cruz)." });
  }
  if (!agreedTos) {
    return res.status(400).json({ error: "You must agree to the Terms of Service." });
  }
  const numericAmount = Number(amount);
  if (Number.isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: "Enter a valid pull-out amount greater than ₱0." });
  }

  const info = getMemberContributed(fullName);
  if (!info.matchedMember) {
    return res.status(404).json({ error: "Full name not found in the member list. Check your spelling/middle initial." });
  }
  if (numericAmount > info.available) {
    return res.status(400).json({
      error: `You can only pull out up to ${formatPhp(info.available)}.`
    });
  }

  const requestItem = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    fullName: info.matchedMember,
    amount: numericAmount,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  state.pulloutRequests.unshift(requestItem);
  res.json({ ok: true, request: requestItem });
});

// Admin: verify login & get full state
app.get("/admin/state", (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json({
    ...state,
    totalFunds: calculateTotalFunds(),
    formattedTotal: formatPhp(calculateTotalFunds())
  });
});

// Admin: save members, fridays, or extraFunds
app.post("/admin/update", (req, res) => {
  if (!checkAdmin(req, res)) return;

  const { extraFunds, members, fridays } = req.body;
  if (typeof extraFunds === "number" && !Number.isNaN(extraFunds)) {
    state.extraFunds = extraFunds;
  }
  if (Array.isArray(members)) state.members = members;
  if (fridays && typeof fridays === "object") state.fridays = fridays;

  const total = calculateTotalFunds();
  res.json({
    ...state,
    totalFunds: total,
    formattedTotal: formatPhp(total),
    message: `the funds are ${formatPhp(total)}`
  });
});

// Admin: approve or reject a pull-out request
app.post("/admin/pullout/:id", (req, res) => {
  if (!checkAdmin(req, res)) return;

  const { action } = req.body; // "approved" or "rejected"
  const item = state.pulloutRequests.find(r => r.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Request not found" });

  if (action === "approved" || action === "rejected") {
    item.status = action;
  }

  const total = calculateTotalFunds();
  res.json({
    ...state,
    totalFunds: total,
    formattedTotal: formatPhp(total)
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
