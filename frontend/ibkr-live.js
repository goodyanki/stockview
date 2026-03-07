const VIEW_USERNAME_KEY = "portfolio_view_username";
const VIEW_PASSWORD_KEY = "portfolio_view_password";

const loginOverlay = document.getElementById("loginOverlay");
const loginBtn = document.getElementById("loginBtn");
const loginUsernameInput = document.getElementById("loginUsername");
const loginPasswordInput = document.getElementById("loginPassword");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");

const appMain = document.getElementById("appMain");
const refreshBtn = document.getElementById("refreshBtn");
const statusBar = document.getElementById("statusBar");
const accountLabel = document.getElementById("accountLabel");
const accountCards = document.getElementById("accountCards");
const positionTableBody = document.getElementById("positionTableBody");

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
  await apiFetch("/api/ibkr/live/overview");
}

function renderOverview(payload) {
  const account = payload.account_status;
  accountLabel.textContent = `账户: ${payload.account_no || "-"} | 更新时间: ${new Date(payload.generated_at).toLocaleString("zh-CN")}`;

  accountCards.innerHTML = `
    <article class="card">
      <div class="label">净清算值 (${account.base_currency})</div>
      <div class="value">${formatNumber(account.net_liquidation)}</div>
    </article>
    <article class="card">
      <div class="label">总现金</div>
      <div class="value">${formatNumber(account.total_cash_value)}</div>
    </article>
    <article class="card">
      <div class="label">可用资金</div>
      <div class="value">${formatNumber(account.available_funds)}</div>
    </article>
    <article class="card">
      <div class="label">购买力</div>
      <div class="value">${formatNumber(account.buying_power)}</div>
    </article>
    <article class="card">
      <div class="label">持仓市值</div>
      <div class="value">${formatNumber(account.gross_position_value)}</div>
    </article>
    <article class="card">
      <div class="label">未实现盈亏</div>
      <div class="value ${pnlClass(account.unrealized_pnl)}">${formatNumber(account.unrealized_pnl)}</div>
    </article>
    <article class="card">
      <div class="label">已实现盈亏</div>
      <div class="value ${pnlClass(account.realized_pnl)}">${formatNumber(account.realized_pnl)}</div>
    </article>
  `;

  positionTableBody.innerHTML = payload.positions
    .map(
      (item) => `
      <tr>
        <td>${item.account_no}</td>
        <td>${item.symbol}</td>
        <td>${item.market || "-"}</td>
        <td>${formatNumber(item.quantity)}</td>
        <td>${formatNumber(item.avg_cost)}</td>
        <td>${formatNumber(item.last_price)}</td>
        <td>${formatNumber(item.current_value)}</td>
        <td class="${pnlClass(item.unrealized_pnl)}">${formatNumber(item.unrealized_pnl)}</td>
        <td class="${pnlClass(item.unrealized_pnl_pct)}">${formatPct(item.unrealized_pnl_pct)}</td>
        <td>${item.currency}</td>
      </tr>
    `,
    )
    .join("");
}

async function loadOverview() {
  const data = await apiFetch("/api/ibkr/live/overview");
  renderOverview(data);
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
    setStatus("正在加载 IBKR 实时数据...");
    await loadOverview();
    setStatus("IBKR 实时数据已更新");
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

refreshBtn.addEventListener("click", async () => {
  setStatus("正在刷新 IBKR 实时数据...");
  refreshBtn.disabled = true;
  try {
    await loadOverview();
    setStatus("IBKR 实时数据已更新");
  } catch (error) {
    setStatus(`刷新失败：${error.message}`, true);
  } finally {
    refreshBtn.disabled = false;
  }
});

async function boot() {
  const savedUser = getViewUsername();
  const savedPass = getViewPassword();

  if (savedUser && savedPass) {
    try {
      await apiFetch("/api/ibkr/live/overview");
      showApp();
      setStatus("正在加载 IBKR 实时数据...");
      await loadOverview();
      setStatus("IBKR 实时数据已更新");
      return;
    } catch {
      localStorage.removeItem(VIEW_PASSWORD_KEY);
    }
  }

  showLogin();
}

boot();
