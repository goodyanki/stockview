/* ===== DOM refs ===== */
const loginOverlay = document.getElementById("loginOverlay");
const loginBtn = document.getElementById("loginBtn");
const loginUsernameInput = document.getElementById("loginUsername");
const loginPasswordInput = document.getElementById("loginPassword");
const loginError = document.getElementById("loginError");
const appMain = document.getElementById("appMain");
const logoutBtn = document.getElementById("logoutBtn");

const statusBar = document.getElementById("statusBar");
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");

const summaryCards = document.getElementById("summaryCards");
const summaryTableBody = document.getElementById("summaryTableBody");
const ibkrTableBody = document.getElementById("ibkrTableBody");
const longbridgeTableBody = document.getElementById("longbridgeTableBody");

const syncIbkrBtn = document.getElementById("syncIbkr");
const syncLongbridgeBtn = document.getElementById("syncLongbridge");

/* ===== Storage ===== */
const VIEW_USERNAME_KEY = "portfolio_view_username";
const VIEW_PASSWORD_KEY = "portfolio_view_password";

function getViewUsername() {
  return localStorage.getItem(VIEW_USERNAME_KEY) || "";
}

function getViewPassword() {
  return localStorage.getItem(VIEW_PASSWORD_KEY) || "";
}

function getApiBase() {
  return "https://api.s747s.com";
}

function getAuthHeader() {
  const username = getViewUsername();
  const password = getViewPassword();
  if (!username || !password) return "";
  return `Basic ${btoa(`${username}:${password}`)}`;
}

/* ===== Helpers ===== */
function setStatus(text, isError = false) {
  statusBar.textContent = text;
  statusBar.style.color = isError ? "#c83d3d" : "#52606d";
}

function formatNumber(value) {
  const num = Number(value || 0);
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(num);
}

function formatPct(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN");
}

function pnlClass(value) {
  return Number(value) >= 0 ? "pnl-pos" : "pnl-neg";
}

async function apiFetch(path, options = {}) {
  const base = getApiBase().replace(/\/$/, "");
  const authHeader = getAuthHeader();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (authHeader) headers.Authorization = authHeader;

  const response = await fetch(`${base}${path}`, { ...options, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return response.json();
}

/* ===== Login / Logout ===== */
function showLogin() {
  loginOverlay.classList.remove("hidden");
  appMain.style.display = "none";
  loginUsernameInput.value = getViewUsername();
  loginPasswordInput.value = "";
  loginError.textContent = "";
}

function showApp() {
  loginOverlay.classList.add("hidden");
  appMain.style.display = "";
}

async function attemptLogin(username, password) {
  localStorage.setItem(VIEW_USERNAME_KEY, username);
  localStorage.setItem(VIEW_PASSWORD_KEY, password);
  /* Verify credentials with lightweight auth check */
  await apiFetch("/api/auth/check");
}

loginBtn.addEventListener("click", async () => {
  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value;
  if (!username || !password) {
    loginError.textContent = "请输入用户名和密码";
    return;
  }
  loginError.textContent = "";
  loginBtn.disabled = true;
  loginBtn.textContent = "登录中...";
  try {
    await attemptLogin(username, password);
    showApp();
    setStatus("正在加载数据...");
    await refreshAll();
    setStatus("数据加载完成");
  } catch (error) {
    loginError.textContent = "登录失败：用户名或密码错误";
    localStorage.removeItem(VIEW_PASSWORD_KEY);
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "登录";
  }
});

loginPasswordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem(VIEW_USERNAME_KEY);
  localStorage.removeItem(VIEW_PASSWORD_KEY);
  showLogin();
});

/* ===== Tabs ===== */
function activateTab(tabName) {
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  panels.forEach((panel) => panel.classList.toggle("active", panel.id === tabName));
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
});

/* ===== Chart ===== */
let snapshotChart = null;

function buildYearLabels(snapshots) {
  if (!snapshots.length) return [];
  const start = new Date(snapshots[0].date);
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  const labels = [];
  const d = new Date(start);
  while (d <= end) {
    labels.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return labels;
}

function calcYRange(values) {
  const real = values.filter((v) => v !== null);
  if (!real.length) return { min: 0, max: 100 };
  const latest = real[real.length - 1];
  const dataMin = Math.min(...real);
  const dataMax = Math.max(...real);
  // latest sits at 60% of the visible range
  const rangeBelow = latest - dataMin;
  const rangeAbove = (rangeBelow / 0.6) * 0.4;
  const yMax = Math.max(dataMax, latest + rangeAbove);
  const yMin = dataMin;
  // add a small padding
  const pad = (yMax - yMin) * 0.05 || 100;
  return { min: Math.floor(yMin - pad), max: Math.ceil(yMax + pad) };
}

async function loadSnapshotChart() {
  const data = await apiFetch("/api/portfolio/snapshots");
  const yearLabels = buildYearLabels(data);
  const valueMap = {};
  data.forEach((d) => { valueMap[d.date] = d.total_value_usd; });

  const values = yearLabels.map((date) => valueMap[date] ?? null);
  const yRange = calcYRange(values);

  // update YTD P&L card
  if (data.length >= 2) {
    const initial = data[0].total_value_usd;
    const latest = data[data.length - 1].total_value_usd;
    const pnl = latest - initial;
    const pnlPct = ((pnl / initial) * 100).toFixed(2);
    const ytdEl = document.getElementById("ytdPnl");
    if (ytdEl) {
      ytdEl.className = `value ${pnl >= 0 ? "pnl-pos" : "pnl-neg"}`;
      ytdEl.textContent = `${pnl >= 0 ? "+" : ""}${formatNumber(pnl)}  (${pnl >= 0 ? "+" : ""}${pnlPct}%)`;
    }
  }

  const canvas = document.getElementById("snapshotChart");
  const ctx = canvas.getContext("2d");

  if (snapshotChart) {
    snapshotChart.data.labels = yearLabels;
    snapshotChart.data.datasets[0].data = values;
    snapshotChart.options.scales.y.min = yRange.min;
    snapshotChart.options.scales.y.max = yRange.max;
    snapshotChart.update();
    return;
  }

  snapshotChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: yearLabels,
      datasets: [
        {
          label: "账户总额 (USD)",
          data: values,
          borderColor: "#0059b8",
          backgroundColor: "rgba(0, 89, 184, 0.08)",
          fill: true,
          tension: 0.3,
          pointRadius: 2,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          title: { display: true, text: "日期" },
          ticks: {
            maxTicksLimit: 12,
            callback: function (val, idx) {
              const label = this.getLabelForValue(idx);
              return label ? label.slice(5) : "";
            },
          },
        },
        y: {
          title: { display: true, text: "USD" },
          min: yRange.min,
          max: yRange.max,
        },
      },
    },
  });
}

/* ===== Data loading ===== */
async function loadSummary() {
  const data = await apiFetch("/api/portfolio/summary");
  const brokerNames = { IBKR_FLEX: "盈透证券", LONGBRIDGE_OPENAPI: "长桥" };

  summaryCards.innerHTML = `
    <article class="card">
      <div class="label">总市值</div>
      <div class="value">${formatNumber(data.total_market_value)}</div>
    </article>
    <article class="card">
      <div class="label">未实现盈亏</div>
      <div class="value ${pnlClass(data.total_unrealized_pnl)}">${formatNumber(data.total_unrealized_pnl)}</div>
    </article>
    <article class="card">
      <div class="label">券商数量</div>
      <div class="value">${data.brokers.length}</div>
    </article>
  `;

  summaryTableBody.innerHTML = data.brokers
    .map(
      (item) => `
      <tr>
        <td>${brokerNames[item.broker_source] || item.broker_source}</td>
        <td>${formatNumber(item.total_market_value)}</td>
        <td class="${pnlClass(item.total_unrealized_pnl)}">${formatNumber(item.total_unrealized_pnl)}</td>
      </tr>
    `
    )
    .join("");
}

async function loadIbkrReports() {
  const rows = await apiFetch("/api/reports/ibkr?limit=200");
  ibkrTableBody.innerHTML = rows
    .map(
      (item) => `
      <tr>
        <td>${item.symbol}</td>
        <td>${formatNumber(item.quantity)}</td>
        <td>${formatNumber(item.avg_cost)}</td>
        <td>${formatNumber(item.market_value)}</td>
        <td class="${pnlClass(item.unrealized_pnl)}">${formatNumber(item.unrealized_pnl)}</td>
        <td>${item.currency}</td>
        <td>${formatTime(item.report_date)}</td>
      </tr>
    `
    )
    .join("");
}

async function loadLongbridgePositions() {
  const rows = await apiFetch("/api/positions/longbridge?limit=200");
  longbridgeTableBody.innerHTML = rows
    .map(
      (item) => `
      <tr>
        <td>${item.symbol}</td>
        <td>${item.market}</td>
        <td>${formatNumber(item.quantity)}</td>
        <td>${formatNumber(item.avg_cost)}</td>
        <td>${formatNumber(item.last_price)}</td>
        <td>${formatNumber(item.current_value)}</td>
        <td class="${pnlClass(item.unrealized_pnl)}">${formatNumber(item.unrealized_pnl)}</td>
        <td class="${pnlClass(item.unrealized_pnl_pct)}">${formatPct(item.unrealized_pnl_pct)}</td>
        <td>${item.currency}</td>
        <td>${formatTime(item.snapshot_time)}</td>
      </tr>
    `
    )
    .join("");
}

async function refreshAll() {
  await Promise.all([loadSummary(), loadIbkrReports(), loadLongbridgePositions(), loadSnapshotChart()]);
}

/* ===== Refresh buttons ===== */
syncIbkrBtn.addEventListener("click", async () => {
  setStatus("正在获取盈透行情...");
  try {
    await Promise.all([loadIbkrReports(), loadSummary()]);
    setStatus("盈透行情已更新");
  } catch (error) {
    setStatus(`盈透行情获取失败：${error.message}`, true);
  }
});

syncLongbridgeBtn.addEventListener("click", async () => {
  setStatus("正在获取长桥行情...");
  try {
    await Promise.all([loadLongbridgePositions(), loadSummary()]);
    setStatus("长桥行情已更新");
  } catch (error) {
    setStatus(`长桥行情获取失败：${error.message}`, true);
  }
});

/* ===== Boot ===== */
async function boot() {
  const savedUser = getViewUsername();
  const savedPass = getViewPassword();

  if (savedUser && savedPass) {
    /* Try auto-login with saved credentials */
    try {
      await apiFetch("/api/auth/check");
      showApp();
      setStatus("正在加载数据...");
      await refreshAll();
      setStatus("数据加载完成");
      return;
    } catch {
      /* Saved credentials are stale, fall through to login */
      localStorage.removeItem(VIEW_PASSWORD_KEY);
    }
  }
  showLogin();
}

boot();
