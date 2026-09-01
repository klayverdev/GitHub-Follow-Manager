/**
 * gh-follow-sync
 * Compara seguidores x seguindo de uma conta do GitHub e permite
 * seguir/deixar de seguir diretamente pela REST API, no navegador.
 *
 * Nenhum dado passa por um backend próprio: toda chamada vai direto
 * para api.github.com usando o token informado pelo usuário.
 */

const GITHUB_API = "https://api.github.com";
const STORAGE_KEYS = { token: "ghfs_token", username: "ghfs_username" };

/** @type {{login:string, avatar_url:string, html_url:string}[]} */
let followers = [];
/** @type {{login:string, avatar_url:string, html_url:string}[]} */
let following = [];
let activeTab = "not-back";

const el = {
  token: document.getElementById("token"),
  username: document.getElementById("username"),
  rememberToken: document.getElementById("remember-token"),
  scanBtn: document.getElementById("scan-btn"),
  status: document.getElementById("status"),
  stats: document.getElementById("stats"),
  statFollowers: document.getElementById("stat-followers"),
  statFollowing: document.getElementById("stat-following"),
  statNotBack: document.getElementById("stat-not-back"),
  statNotFollowing: document.getElementById("stat-not-following"),
  results: document.getElementById("results"),
  tabs: document.querySelectorAll(".tab"),
  list: document.getElementById("list"),
};

init();

function init() {
  restoreSavedCredentials();
  el.scanBtn.addEventListener("click", handleScan);
  el.tabs.forEach((tab) => tab.addEventListener("click", () => selectTab(tab.dataset.tab)));
}

function restoreSavedCredentials() {
  const savedToken = localStorage.getItem(STORAGE_KEYS.token);
  const savedUsername = localStorage.getItem(STORAGE_KEYS.username);

  if (savedToken) {
    el.token.value = savedToken;
    el.rememberToken.checked = true;
  }
  if (savedUsername) {
    el.username.value = savedUsername;
  }
}

function persistCredentialsIfRequested() {
  if (el.rememberToken.checked) {
    localStorage.setItem(STORAGE_KEYS.token, el.token.value.trim());
    localStorage.setItem(STORAGE_KEYS.username, el.username.value.trim());
  } else {
    localStorage.removeItem(STORAGE_KEYS.token);
    localStorage.removeItem(STORAGE_KEYS.username);
  }
}

/* -------------------------------------------------------
   GitHub API
------------------------------------------------------- */

function authHeaders() {
  return {
    Authorization: `token ${el.token.value.trim()}`,
    Accept: "application/vnd.github+json",
  };
}

/**
 * Busca todas as páginas de um endpoint paginado da API do GitHub.
 * @param {string} url
 */
async function fetchAllPages(url) {
  const results = [];
  let page = 1;

  while (true) {
    const response = await fetch(`${url}?per_page=100&page=${page}`, {
      headers: authHeaders(),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || `Erro ${response.status} ao consultar a API`);
    }

    const page_data = await response.json();
    results.push(...page_data);

    if (page_data.length < 100) break;
    page += 1;
  }

  return results;
}

async function followUser(login) {
  const response = await fetch(`${GITHUB_API}/user/following/${login}`, {
    method: "PUT",
    headers: authHeaders(),
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Não foi possível seguir ${login}`);
  }
}

async function unfollowUser(login) {
  const response = await fetch(`${GITHUB_API}/user/following/${login}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Não foi possível deixar de seguir ${login}`);
  }
}

/* -------------------------------------------------------
   Fluxo principal
------------------------------------------------------- */

async function handleScan() {
  const username = el.username.value.trim();
  const token = el.token.value.trim();

  if (!username || !token) {
    setStatus("Informe o token e o usuário antes de escanear.", "error");
    return;
  }

  persistCredentialsIfRequested();
  setStatus("Consultando a API do GitHub…");
  el.scanBtn.disabled = true;

  try {
    [followers, following] = await Promise.all([
      fetchAllPages(`${GITHUB_API}/users/${username}/followers`),
      fetchAllPages(`${GITHUB_API}/users/${username}/following`),
    ]);

    renderStats();
    renderList();

    el.stats.hidden = false;
    el.results.hidden = false;
    setStatus(`${followers.length} seguidores · ${following.length} seguindo`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    el.scanBtn.disabled = false;
  }
}

function setStatus(message, tone) {
  el.status.textContent = message;
  if (tone) {
    el.status.dataset.tone = tone;
  } else {
    delete el.status.dataset.tone;
  }
}

/* -------------------------------------------------------
   Derivação dos dados
------------------------------------------------------- */

function usersNotFollowingBack() {
  const followerLogins = new Set(followers.map((u) => u.login));
  return following.filter((u) => !followerLogins.has(u.login));
}

function usersYouDontFollowBack() {
  const followingLogins = new Set(following.map((u) => u.login));
  return followers.filter((u) => !followingLogins.has(u.login));
}

function renderStats() {
  el.statFollowers.textContent = followers.length;
  el.statFollowing.textContent = following.length;
  el.statNotBack.textContent = usersNotFollowingBack().length;
  el.statNotFollowing.textContent = usersYouDontFollowBack().length;
}

/* -------------------------------------------------------
   Lista / abas
------------------------------------------------------- */

const TAB_CONFIG = {
  "not-back": { data: usersNotFollowingBack, action: "remove" },
  "not-following": { data: usersYouDontFollowBack, action: "add" },
  followers: { data: () => followers, action: null },
  following: { data: () => following, action: "remove" },
};

function selectTab(tabName) {
  activeTab = tabName;
  el.tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === tabName;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  renderList();
}

function renderList() {
  const config = TAB_CONFIG[activeTab];
  const users = config.data();

  el.list.innerHTML = "";

  if (users.length === 0) {
    el.list.innerHTML = `<li class="empty">nada por aqui</li>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  users.forEach((user) => fragment.appendChild(buildRow(user, config.action)));
  el.list.appendChild(fragment);
}

/**
 * @param {{login:string, avatar_url:string, html_url:string}} user
 * @param {"add"|"remove"|null} action
 */
function buildRow(user, action) {
  const row = document.createElement("li");
  row.className = "row";

  const mark = document.createElement("span");
  mark.className = `row__mark row__mark--${action === "remove" ? "remove" : "add"}`;
  mark.textContent = action === "remove" ? "-" : action === "add" ? "+" : " ";
  row.appendChild(mark);

  const avatar = document.createElement("img");
  avatar.src = user.avatar_url;
  avatar.alt = "";
  avatar.loading = "lazy";
  row.appendChild(avatar);

  const name = document.createElement("span");
  name.className = "row__name";
  name.innerHTML = `<a href="${user.html_url}" target="_blank" rel="noopener">${user.login}</a>`;
  row.appendChild(name);

  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn btn--${action}`;
    button.textContent = action === "remove" ? "deixar de seguir" : "seguir";
    button.addEventListener("click", () => handleRowAction(user.login, action, button));
    row.appendChild(button);
  }

  return row;
}

/**
 * @param {string} login
 * @param {"add"|"remove"} action
 * @param {HTMLButtonElement} button
 */
async function handleRowAction(login, action, button) {
  button.disabled = true;
  try {
    if (action === "add") {
      await followUser(login);
      following.push({
        login,
        avatar_url: `https://github.com/${login}.png`,
        html_url: `https://github.com/${login}`,
      });
      setStatus(`agora você segue ${login}`, "ok");
    } else {
      await unfollowUser(login);
      following = following.filter((u) => u.login !== login);
      setStatus(`você deixou de seguir ${login}`, "ok");
    }
    renderStats();
    renderList();
  } catch (error) {
    setStatus(error.message, "error");
    button.disabled = false;
  }
}
