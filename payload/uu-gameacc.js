/* Adds a UU GameAcc settings page beside Matter in UniFi Network. */
(() => {
  "use strict";

  const API = "/proxy/network/uu-gameacc";
  const NAV_ID = "uugameacc-nav";
  const PANEL_ID = "uugameacc-panel";
  const SETTINGS_PATH = /^\/network\/[^/]+\/settings\//;
  const UU_PATH = /^\/network\/[^/]+\/settings\/uugameacc\/?$/;
  const LEGACY_HASH = "#uu-gameacc";

  let nav = null;
  let panel = null;
  let sidebar = null;
  let savedEnabled = false;
  let statusLoaded = false;
  let busy = false;
  let nonce = "";
  let csrf = "";
  let hiddenError = null;
  let hiddenErrorDisplay = "";
  let darkMode = false;

  function uuPath() {
    return `${location.pathname.match(SETTINGS_PATH)?.[0] || "/network/default/settings/"}uugameacc`;
  }

  function isUuPath() {
    return UU_PATH.test(location.pathname);
  }

  function settingsRow(label) {
    const nodes = document.querySelectorAll("span, div, a, button");
    for (const node of nodes) {
      if (node.textContent?.trim() !== label) continue;
      if (Array.from(node.children).some(child => child.textContent?.trim() === label)) continue;
      let row = node;
      while (row && row !== document.body) {
        const rect = row.getBoundingClientRect();
        if (rect.width >= 150 && rect.height >= 32 && rect.height <= 85) return row;
        row = row.parentElement;
      }
    }
    return null;
  }

  function matterRow() {
    return settingsRow("Matter");
  }

  function hideNotFound() {
    if (!isUuPath() || hiddenError?.isConnected) return;
    const heading = Array.from(document.querySelectorAll("h1, h2"))
      .find(node => node.textContent?.trim() === "Page Not Found");
    if (!heading || !sidebar) return;
    const sidebarRight = sidebar.getBoundingClientRect().right;
    const rightWidth = window.innerWidth - sidebarRight;
    let node = heading;
    let content = null;
    while (node && node !== document.body) {
      const rect = node.getBoundingClientRect();
      if (rect.left >= sidebarRight - 10 &&
          rect.width >= Math.max(300, rightWidth - 20) &&
          rect.height >= 300) {
        content = node;
        break;
      }
      node = node.parentElement;
    }
    if (content?.parentElement) {
      hiddenErrorDisplay = content.style.display;
      content.style.display = "none";
      hiddenError = content;
      content.parentElement.append(panel);
      panel.style.position = "absolute";
      panel.style.left = "0";
      panel.style.top = "0";
      positionPanel();
    }
  }

  function restoreNotFound() {
    if (hiddenError) hiddenError.style.display = hiddenErrorDisplay;
    hiddenError = null;
    hiddenErrorDisplay = "";
  }

  function findSidebar(node) {
    let current = node;
    let match = null;
    while (current && current !== document.body) {
      const rect = current.getBoundingClientRect();
      if (rect.width >= 180 && rect.width <= 350 && rect.height > 300) match = current;
      current = current.parentElement;
    }
    return match;
  }

  function mobileMenuButton() {
    const button = document.querySelector('[data-icon="MenuMobileIcon"]')?.closest("button");
    return button?.getBoundingClientRect().width ? button : null;
  }

  function positionPanel() {
    if (!panel) return;
    const menu = mobileMenuButton();
    if (panel.parentElement !== document.body) {
      const origin = panel.offsetParent?.getBoundingClientRect().top || 0;
      panel.style.top = menu
        ? `${Math.max(0, Math.round(menu.parentElement.getBoundingClientRect().bottom - origin))}px`
        : "0";
      return;
    }
    if (menu) {
      panel.style.left = "0";
      panel.style.top = `${Math.max(0, Math.round(menu.parentElement.getBoundingClientRect().bottom))}px`;
      return;
    }
    if (!sidebar) return;
    const rect = sidebar.getBoundingClientRect();
    panel.style.left = `${Math.round(rect.right)}px`;
    panel.style.top = `${Math.max(0, Math.round(rect.top))}px`;
  }

  function setSelected(selected) {
    if (!nav) return;
    const system = settingsRow("System");
    if (system) {
      const base = system.className.split(/\s+/)
        .filter(name => !/^active(?:-(?:dark|light))?__/.test(name)).join(" ");
      const suffix = base.match(/(?:^|\s)navItem__(\S+)/)?.[1];
      const active = selected && suffix
        ? ` active__${suffix} active-${darkMode ? "dark" : "light"}__${suffix}` : "";
      const classes = `${base}${active}`;
      if (nav.className !== classes) nav.className = classes;
      const nativeIcon = system.querySelector("svg");
      const icon = nav.querySelector("[data-uu-icon]");
      const nativeIconClass = nativeIcon?.getAttribute("class") || "";
      if (icon && icon.className !== nativeIconClass) {
        icon.className = nativeIconClass;
      }
    }
    if (selected) nav.setAttribute("aria-current", "page");
    else nav.removeAttribute("aria-current");
  }

  function syncTheme() {
    const system = settingsRow("System");
    if (!system) return;
    darkMode = /(?:^|\s)navItem-dark__/.test(system.className);
    setSelected(isUuPath());
    if (!panel) return;
    panel.style.background = darkMode ? "#111315" : "#fff";
    panel.style.color = darkMode ? "#e8eaed" : "#333b46";
    panel.querySelector("[data-uu-label]").style.color = darkMode ? "#aab2bd" : "#6e7782";
    panel.querySelector("[data-uu-cancel]").style.color = darkMode ? "#aab2bd" : "#737d8a";
  }

  function navigateToUu() {
    if (isUuPath()) return;
    history.pushState(history.state, "", uuPath());
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    mount();
  }

  function closePanel() {
    panel?.remove();
    panel = null;
    setSelected(false);
    restoreNotFound();
  }

  function elements() {
    return {
      checkbox: panel.querySelector("[data-uu-enable]"),
      actions: panel.querySelector("[data-uu-actions]"),
      apply: panel.querySelector("[data-uu-apply]"),
      cancel: panel.querySelector("[data-uu-cancel]"),
    };
  }

  function updateButtons() {
    if (!panel) return;
    const { checkbox, actions, apply, cancel } = elements();
    const changed = checkbox.checked !== savedEnabled;
    checkbox.disabled = busy || !nonce;
    actions.style.display = statusLoaded && changed ? "flex" : "none";
    apply.disabled = busy || !nonce || !changed;
    cancel.disabled = busy;
    apply.style.opacity = apply.disabled ? "0.55" : "1";
    apply.style.cursor = apply.disabled ? "default" : "pointer";
  }

  async function loadStatus() {
    if (!panel) return;
    try {
      const response = await fetch(`${API}/status`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      nonce = data.nonce;
      csrf = response.headers.get("X-Csrf-Token") || csrf;
      savedEnabled = Boolean(data.active && data.enabled);
      statusLoaded = true;
      if (!panel) return;
      elements().checkbox.checked = savedEnabled;
    } catch (error) {
      nonce = "";
      console.error("UU GameAcc status unavailable", error);
    }
    updateButtons();
  }

  async function applyChanges() {
    if (!panel || busy) return;
    const { checkbox } = elements();
    const enabled = checkbox.checked;
    if (enabled === savedEnabled) return;
    busy = true;
    updateButtons();
    try {
      const headers = { "Content-Type": "application/json", "X-UU-Nonce": nonce };
      if (csrf) headers["X-Csrf-Token"] = csrf;
      const response = await fetch(`${API}/toggle`, {
        method: "POST", credentials: "same-origin", headers,
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (Boolean(result.active && result.enabled) !== enabled) {
        throw new Error("Service state did not match the request");
      }
      savedEnabled = enabled;
    } catch (error) {
      window.alert(`UU GameAcc action failed: ${error.message}`);
    } finally {
      busy = false;
      updateButtons();
    }
  }

  function cancelChanges() {
    if (!panel || busy) return;
    elements().checkbox.checked = savedEnabled;
    updateButtons();
    loadStatus();
  }

  function openPanel() {
    if (panel) return;
    statusLoaded = false;
    panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-label", "UU GameAcc settings");
    panel.style.cssText = "position:fixed;right:0;bottom:0;z-index:0;background:#fff;color:#333b46;font-family:inherit;display:flex;flex-direction:column;box-sizing:border-box;overflow:auto";
    panel.innerHTML = `
      <div style="display:grid;grid-template-columns:256px minmax(0,1fr);align-items:center;padding:24px 32px;font-size:14px">
        <label for="uu-gameacc-enable" data-uu-label>Enable</label>
        <input id="uu-gameacc-enable" data-uu-enable type="checkbox" disabled style="width:16px;height:16px;margin:0;accent-color:#087cf4;cursor:pointer">
      </div>
      <div data-uu-actions style="margin-top:auto;padding:0 32px 28px;display:none;align-items:center;gap:40px">
        <button data-uu-apply type="button" disabled style="min-width:132px;height:36px;padding:0 18px;border:0;border-radius:4px;background:#087cf4;color:#fff;font:inherit;font-size:14px">Apply Changes</button>
        <button data-uu-cancel type="button" style="border:0;background:transparent;color:#737d8a;font:inherit;font-size:14px;cursor:pointer">Cancel</button>
      </div>`;
    document.body.append(panel);
    positionPanel();
    syncTheme();
    hideNotFound();
    elements().checkbox.addEventListener("change", updateButtons);
    elements().apply.addEventListener("click", applyChanges);
    elements().cancel.addEventListener("click", cancelChanges);
    loadStatus();
  }

  function mount() {
    if (!SETTINGS_PATH.test(location.pathname)) {
      closePanel();
      nav?.remove();
      nav = null;
      return;
    }
    if (location.hash === LEGACY_HASH && !isUuPath()) {
      location.replace(uuPath());
      return;
    }
    if (panel && !isUuPath()) closePanel();
    if (nav?.isConnected) {
      if (panel) positionPanel();
      syncTheme();
      if (isUuPath() && !panel) openPanel();
      else hideNotFound();
      return;
    }
    const matter = matterRow();
    if (!matter?.parentElement) return;
    sidebar = findSidebar(matter);
    const system = settingsRow("System");
    if (!system) return;
    nav = system.cloneNode(true);
    nav.id = NAV_ID;
    nav.removeAttribute("data-testid");
    nav.setAttribute("role", "button");
    nav.setAttribute("tabindex", "0");
    nav.setAttribute("aria-label", "UU GameAcc settings");
    nav.querySelector("svg")?.remove();
    nav.querySelector("span").textContent = "UU GameAcc";
    const icon = document.createElement("span");
    icon.setAttribute("data-uu-icon", "");
    icon.setAttribute("aria-hidden", "true");
    icon.style.cssText = "display:block;width:22px;height:22px;flex:none;margin-right:8px;background:currentColor;-webkit-mask:url(/uu-gameacc.svg) center/contain no-repeat;mask:url(/uu-gameacc.svg) center/contain no-repeat";
    nav.prepend(icon);
    nav.addEventListener("click", event => {
      event.stopPropagation();
      const menu = mobileMenuButton();
      if (menu && nav.closest('[aria-hidden="false"]')) menu.click();
      navigateToUu();
    });
    nav.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const menu = mobileMenuButton();
        if (menu && nav.closest('[aria-hidden="false"]')) menu.click();
        navigateToUu();
      }
    });
    matter.after(nav);
    syncTheme();
    if (isUuPath() && !panel) openPanel();
    else if (panel) { positionPanel(); setSelected(true); hideNotFound(); }
  }

  new MutationObserver(mount).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-theme"],
  });
  document.addEventListener("click", event => {
    if (panel && sidebar?.contains(event.target) && !nav?.contains(event.target)) closePanel();
  }, true);
  window.addEventListener("popstate", mount);
  window.addEventListener("resize", positionPanel);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && panel && !busy &&
        elements().checkbox.checked === savedEnabled) loadStatus();
  });
  mount();
})();
