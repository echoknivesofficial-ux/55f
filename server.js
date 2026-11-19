const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Luckyboi";

let state = {
  extraFunds: Number(process.env.FUNDS_AMOUNT ?? 0),
  weeklyAmount: 200,
  members: [
    { name: "Daeniel", password: "1001" },
    { name: "Ivan", password: "1002" },
    { name: "Aldrich", password: "7777" },
    { name: "Jordan", password: "1004" },
    { name: "Yzhan", password: "1005" },
    { name: "Marquis", password: "1006" }
  ],
  fridays: {},
  pulloutRequests: [],
  clientInquiries: [] // { id, clientName, contact, service, details, status: "new"|"contacted", createdAt }
};

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-password");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));

function formatPhp(amount) {
  const num = Number(amount);
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
  }).format(Number.isFinite(num) ? num : 0);
}

function findMemberByKey(specialKey) {
  const target = String(specialKey || "").trim();
  if (!target) return null;
  return (state.members || []).find(
    m => String(m.password || "").trim() === target
  ) || null;
}

function getMemberContributed(memberName) {
  const matched = (state.members || []).find(
    m => String(m.name || "").trim().toLowerCase() === String(memberName || "").trim().toLowerCase()
  );

  if (!matched) {
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
    if (dayRecord && dayRecord[matched.name]) {
      paidFridays++;
    }
  }

  const contributed = paidFridays * state.weeklyAmount;
  const approvedPullouts = (state.pulloutRequests || [])
    .filter(
      r =>
        r.status === "approved" &&
        String(r.fullName || "").trim().toLowerCase() === matched.name.toLowerCase()
    )
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  return {
    matchedMember: matched.name,
    contributed,
    approvedPullouts,
    available: Math.max(0, contributed - approvedPullouts)
  };
}

function getWeeklyBreakdown() {
  const dates = Object.keys(state.fridays || {}).sort();
  return dates.map(dateKey => {
    const dayRecord = state.fridays[dateKey] || {};
    let paidCount = 0;
    for (const member of state.members || []) {
      if (dayRecord[member.name]) paidCount++;
    }
    return {
      date: dateKey,
      paidCount,
      total: paidCount * state.weeklyAmount
    };
  });
}

function calculateTotalFunds() {
  let totalContributed = 0;
  for (const dateKey of Object.keys(state.fridays || {})) {
    const dayRecord = state.fridays[dateKey] || {};
    for (const member of state.members || []) {
      if (dayRecord[member.name]) {
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

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "sw627-funds-api",
    endpoints: ["/funds", "/public-info", "/pullout-request", "/inquiry", "/admin/state"]
  });
});

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

// Public balance + weekly chart + special key member lookup
app.get("/public-info", (req, res) => {
  try {
    const total = calculateTotalFunds();
    const key = req.query.key ? String(req.query.key) : "";
    const matched = key ? findMemberByKey(key) : null;
    const memberInfo = matched ? getMemberContributed(matched.name) : null;

    res.json({
      totalFunds: total,
      formattedTotal: formatPhp(total),
      weeklyAmount: state.weeklyAmount,
      weeklyChart: getWeeklyBreakdown(),
      memberInfo
    });
  } catch (err) {
    console.error("GET /public-info error:", err);
    res.status(500).json({ error: "Server error reading public info" });
  }
});

// Submit pull-out request using Special Key
app.post("/pullout-request", (req, res) => {
  try {
    const { specialKey, amount, agreedTos } = req.body || {};

    const memberObj = findMemberByKey(specialKey);
    if (!memberObj) {
      return res.status(401).json({
        error: "Invalid Special Key. No member matches this key."
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

    const info = getMemberContributed(memberObj.name);
    if (numericAmount > info.available) {
      return res.status(400).json({
        error: `You can only pull out up to ${formatPhp(info.available)}.`
      });
    }

    const requestItem = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      fullName: memberObj.name,
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

// Submit Client Project Inquiry (YT Video or Website)
app.post("/inquiry", (req, res) => {
  try {
    const { clientName, contact, service, details } = req.body || {};

    if (!clientName || String(clientName).trim().length < 2) {
      return res.status(400).json({ error: "Please enter your name or brand." });
    }
    if (!contact || String(contact).trim().length < 3) {
      return res.status(400).json({ error: "Please enter your email, Discord, or Instagram handle." });
    }
    if (!details || String(details).trim().length < 5) {
      return res.status(400).json({ error: "Please describe what you need (video style, website type, etc.)." });
    }

    const inquiry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      clientName: String(clientName).trim(),
      contact: String(contact).trim(),
      service: String(service || "Custom Website").trim(),
      details: String(details).trim(),
      status: "new",
      createdAt: new Date().toISOString()
    };

    state.clientInquiries.unshift(inquiry);
    res.json({ ok: true, inquiry });
  } catch (err) {
    console.error("POST /inquiry error:", err);
    res.status(500).json({ error: "Server error submitting inquiry" });
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
      formattedTotal: formatPhp(total),
      weeklyChart: getWeeklyBreakdown()
    });
  } catch (err) {
    console.error("GET /admin/state error:", err);
    res.status(500).json({ error: "Server error reading admin state" });
  }
});

// Admin update
app.post("/admin/update", (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { extraFunds, members, fridays, pulloutRequests, clientInquiries } = req.body || {};

    if (typeof extraFunds === "number" && Number.isFinite(extraFunds)) {
      state.extraFunds = extraFunds;
    }
    if (Array.isArray(members)) {
      state.members = members
        .map((m, idx) => {
          if (typeof m === "string") {
            return { name: m.trim(), password: String(2000 + idx) };
          }
          const cleanName = String(m?.name || "").trim();
          const cleanPass = String(m?.password || "").trim() || String(2000 + idx);
          return cleanName ? { name: cleanName, password: cleanPass } : null;
        })
        .filter(Boolean);
    }
    if (fridays && typeof fridays === "object" && !Array.isArray(fridays)) {
      state.fridays = fridays;
    }
    if (Array.isArray(pulloutRequests)) {
      state.pulloutRequests = pulloutRequests;
    }
    if (Array.isArray(clientInquiries)) {
      state.clientInquiries = clientInquiries;
    }

    const total = calculateTotalFunds();
    const formatted = formatPhp(total);

    res.json({
      ...state,
      totalFunds: total,
      formattedTotal: formatted,
      weeklyChart: getWeeklyBreakdown(),
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
      formattedTotal: formatPhp(total),
      weeklyChart: getWeeklyBreakdown()
    });
  } catch (err) {
    console.error("POST /admin/pullout error:", err);
    res.status(500).json({ error: "Server error updating pull-out request" });
  }
});

// Admin mark client inquiry contacted/deleted
app.post("/admin/inquiry/:id", (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { action } = req.body || {};
    if (action === "delete") {
      state.clientInquiries = state.clientInquiries.filter(i => i.id !== req.params.id);
    } else {
      const item = state.clientInquiries.find(i => i.id === req.params.id);
      if (!item) return res.status(404).json({ error: "Inquiry not found" });
      item.status = action || "contacted";
    }
    res.json({ ...state });
  } catch (err) {
    console.error("POST /admin/inquiry error:", err);
    res.status(500).json({ error: "Server error updating inquiry" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
