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
const refreshIbkrBtn = document.getElementById("refreshIbkr");
const syncLongbridgeBtn = document.getElementById("syncLongbridge");
const refreshLongbridgeBtn = document.getElementById("refreshLongbridge");

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
  /* Verify credentials by calling a protected endpoint */
  await apiFetch("/api/portfolio/summary");
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
  await Promise.all([loadSummary(), loadIbkrReports(), loadLongbridgePositions()]);
}

/* ===== Sync buttons ===== */
syncIbkrBtn.addEventListener("click", async () => {
  setStatus("正在同步盈透证券...");
  try {
    const result = await apiFetch("/api/sync/ibkr-flex", { method: "POST", body: "{}" });
    setStatus(`盈透证券同步完成：${result.imported} 条记录`);
    await Promise.all([loadIbkrReports(), loadSummary()]);
  } catch (error) {
    setStatus(`盈透证券同步失败：${error.message}`, true);
  }
});

refreshIbkrBtn.addEventListener("click", async () => {
  setStatus("正在刷新盈透证券...");
  try {
    await loadIbkrReports();
    setStatus("盈透证券已刷新");
  } catch (error) {
    setStatus(`盈透证券刷新失败：${error.message}`, true);
  }
});

syncLongbridgeBtn.addEventListener("click", async () => {
  setStatus("正在同步长桥...");
  try {
    const result = await apiFetch("/api/sync/longbridge", { method: "POST", body: "{}" });
    setStatus(`长桥同步完成：${result.imported} 条记录`);
    await Promise.all([loadLongbridgePositions(), loadSummary()]);
  } catch (error) {
    setStatus(`长桥同步失败：${error.message}`, true);
  }
});

refreshLongbridgeBtn.addEventListener("click", async () => {
  setStatus("正在刷新长桥...");
  try {
    await loadLongbridgePositions();
    setStatus("长桥已刷新");
  } catch (error) {
    setStatus(`长桥刷新失败：${error.message}`, true);
  }
});

/* ===== Boot ===== */
async function boot() {
  const savedUser = getViewUsername();
  const savedPass = getViewPassword();

  if (savedUser && savedPass) {
    /* Try auto-login with saved credentials */
    try {
      await apiFetch("/api/portfolio/summary");
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
