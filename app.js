// app.js

const DEFAULT_PIN = "2807";

const state = {
  data: {
    settings: {},
    entries: [],
    closedDays: []
  },
  authenticated: false,
  chart: null,
  currentRange: {
    from: null,
    to: null
  },
  ui: {
    activeView: "reports",
    editingEntryId: null
  }
};

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initViewNavigation();
  initEvents();
  initPWA();
  loadInitialData();
});

/* THEME */

function initTheme() {
  const stored = localStorage.getItem("acube-theme");
  const initial = stored || "dark";
  setTheme(initial);

  const toggleBtn = document.getElementById("themeToggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const current = document
        .getElementById("app")
        .classList.contains("app--dark")
        ? "dark"
        : "light";
      const next = current === "dark" ? "light" : "dark";
      setTheme(next);
      localStorage.setItem("acube-theme", next);
    });
  }
}

function setTheme(theme) {
  const app = document.getElementById("app");
  if (!app) return;
  app.classList.toggle("app--dark", theme === "dark");
  app.classList.toggle("app--light", theme === "light");

  const toggleBtn = document.getElementById("themeToggle");
  if (toggleBtn) {
    toggleBtn.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  }
}

/* VIEW NAVIGATION (SIDEBAR) */

function initViewNavigation() {
  const sidebar = document.getElementById("sidebar");
  const sidebarToggle = document.getElementById("sidebarToggle");
  const navButtons = document.querySelectorAll(".sidebar-nav__item");

  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener("click", () => {
      sidebar.classList.toggle("sidebar--hidden");
    });
  }

  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view || "reports";
      switchView(view);

      navButtons.forEach((b) =>
        b.classList.toggle(
          "sidebar-nav__item--active",
          b === btn
        )
      );

      if (window.innerWidth <= 960 && sidebar) {
        sidebar.classList.add("sidebar--hidden");
      }
    });
  });

  // Default view
  switchView("reports");
}

function switchView(view) {
  state.ui.activeView = view;

  document.querySelectorAll(".view").forEach((el) => {
    el.classList.toggle(
      "view--active",
      el.id === `view-${view}`
    );
  });

  if (view === "add") {
    prepareAddFormForNew();
  }
}

/* INITIAL LOAD */

async function loadInitialData() {
  showLoading(true);
  try {
    let data = await fetchExpenseData();
    if (!data || typeof data !== "object") {
      data = {};
    }
    if (!data.settings) data.settings = {};
    if (!Array.isArray(data.entries)) data.entries = [];
    if (!Array.isArray(data.closedDays)) data.closedDays = [];

    state.data = data;
    await ensurePinHashExists();

    initDefaultDates();
    renderAll();
  } catch (err) {
    console.error("Error loading data from Drive", err);
    showToast("Could not load data from Drive. Check Drive setup.", true);
  } finally {
    showLoading(false);
  }
}

async function ensurePinHashExists() {
  if (state.data.settings.pinHash) return;
  const hash = await hashPin(DEFAULT_PIN);
  state.data.settings.pinHash = hash;
  await saveExpenseData(state.data);
}

function initDefaultDates() {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const fromInput = document.getElementById("fromDate");
  const toInput = document.getElementById("toDate");
  const entryDate = document.getElementById("entryDate");
  const closeDayDate = document.getElementById("closeDayDate");
  const dataFromDate = document.getElementById("dataFromDate");
  const dataToDate = document.getElementById("dataToDate");

  const todayISO = toISODate(today);
  const firstISO = toISODate(firstOfMonth);

  if (fromInput) fromInput.value = firstISO;
  if (toInput) toInput.value = todayISO;
  if (entryDate) entryDate.value = todayISO;
  if (closeDayDate) closeDayDate.value = todayISO;
  if (dataFromDate) dataFromDate.value = firstISO;
  if (dataToDate) dataToDate.value = todayISO;

  state.currentRange = { from: firstISO, to: todayISO };
}

/* EVENTS */

function initEvents() {
  const printBtn = document.getElementById("printReportBtn");
  if (printBtn) {
    printBtn.addEventListener("click", () => window.print());
  }

  const applyRangeBtn = document.getElementById("applyRangeBtn");
  if (applyRangeBtn) {
    applyRangeBtn.addEventListener("click", () => {
      const from = document.getElementById("fromDate").value || null;
      const to = document.getElementById("toDate").value || null;
      state.currentRange = { from, to };
      renderReports();
    });
  }

  const entryForm = document.getElementById("entryForm");
  if (entryForm) {
    entryForm.addEventListener("submit", onEntrySubmit);
  }

  const pinForm = document.getElementById("pinForm");
  if (pinForm) {
    pinForm.addEventListener("submit", onPinFormSubmit);
  }

  const closeDayBtn = document.getElementById("closeDayBtn");
  if (closeDayBtn) {
    closeDayBtn.addEventListener("click", onCloseDay);
  }

  const chartSelect = document.getElementById("chartModeSelect");
  if (chartSelect) {
    chartSelect.addEventListener("change", () => {
      const entries = filterEntriesByDateRange(
        state.data.entries || [],
        state.currentRange.from,
        state.currentRange.to
      );
      renderChart(entries);
    });
  }

  const dataFilterBtn = document.getElementById("dataFilterBtn");
  if (dataFilterBtn) {
    dataFilterBtn.addEventListener("click", () => {
      renderEntriesTable();
    });
  }
}

/* ENTRY HANDLING */

function prepareAddFormForNew() {
  state.ui.editingEntryId = null;
  const entryDate = document.getElementById("entryDate");
  if (entryDate) {
    if (!entryDate.value) {
      entryDate.value = toISODate(new Date());
    }
  }
  const type = document.getElementById("entryType");
  const category = document.getElementById("entryCategory");
  const amount = document.getElementById("entryAmount");
  const note = document.getElementById("entryNote");
  if (type) type.value = "income";
  if (category) category.value = "";
  if (amount) amount.value = "";
  if (note) note.value = "";
}

async function onEntrySubmit(event) {
  event.preventDefault();

  const dateStr = document.getElementById("entryDate").value;
  const type = document.getElementById("entryType").value;
  const category = document.getElementById("entryCategory").value.trim();
  const amountStr = document.getElementById("entryAmount").value;
  const note = document.getElementById("entryNote").value.trim();

  if (!dateStr || !type || !amountStr) {
    showToast("Date, type and amount are required.", true);
    return;
  }

  const amount = Number(amountStr);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Amount must be a positive number.", true);
    return;
  }

  const ok = await ensureAuthenticated();
  if (!ok) return;

  const now = new Date();
  const editingId = state.ui.editingEntryId;

  if (editingId) {
    // Update existing entry
    const entry = state.data.entries.find((e) => e.id === editingId);
    if (entry) {
      entry.date = dateStr;
      entry.type = type;
      entry.category = category;
      entry.amount = amount;
      entry.note = note;
    }
    state.ui.editingEntryId = null;
  } else {
    // Create new entry
    const id = `${dateStr}_${now.getTime()}`;
    state.data.entries.push({
      id,
      date: dateStr,
      type,
      category,
      amount,
      note
    });
  }

  await persistData("Record saved.");

  // Keep same date; clear amount & note for quick multiple entries
  document.getElementById("entryAmount").value = "";
  document.getElementById("entryNote").value = "";
}

/* EDIT / DELETE */

function startEditEntry(entryId) {
  const entry = state.data.entries.find((e) => e.id === entryId);
  if (!entry) {
    showToast("Record not found.", true);
    return;
  }

  state.ui.editingEntryId = entryId;
  const date = document.getElementById("entryDate");
  const type = document.getElementById("entryType");
  const category = document.getElementById("entryCategory");
  const amount = document.getElementById("entryAmount");
  const note = document.getElementById("entryNote");

  if (date) date.value = entry.date;
  if (type) type.value = entry.type;
  if (category) category.value = entry.category || "";
  if (amount) amount.value = entry.amount;
  if (note) note.value = entry.note || "";

  switchView("add");
}

async function onDeleteEntry(entryId) {
  const okAuth = await ensureAuthenticated();
  if (!okAuth) return;

  const confirmDelete = window.confirm("Delete this record permanently?");
  if (!confirmDelete) return;

  state.data.entries = state.data.entries.filter((e) => e.id !== entryId);
  await persistData("Record deleted.");
}

/* PIN AND AUTH */

async function onPinFormSubmit(event) {
  event.preventDefault();

  const current = document.getElementById("currentPin").value;
  const next = document.getElementById("newPin").value;
  const confirm = document.getElementById("confirmNewPin").value;

  if (!current || !next || !confirm) {
    showToast("Fill all PIN fields.", true);
    return;
  }

  if (next !== confirm) {
    showToast("New PIN and confirmation do not match.", true);
    return;
  }

  const ok = await verifyPin(current);
  if (!ok) {
    showToast("Current PIN is incorrect.", true);
    return;
  }

  const newHash = await hashPin(next);
  state.data.settings.pinHash = newHash;
  state.authenticated = true;

  document.getElementById("currentPin").value = "";
  document.getElementById("newPin").value = "";
  document.getElementById("confirmNewPin").value = "";

  await persistData("PIN updated.");
}

async function ensureAuthenticated() {
  if (state.authenticated) return true;
  const pin = window.prompt("Enter PIN to modify records:");
  if (pin == null) return false;
  const ok = await verifyPin(pin);
  if (!ok) {
    showToast("Incorrect PIN.", true);
    return false;
  }
  state.authenticated = true;
  showToast("PIN accepted.");
  return true;
}

async function hashPin(pin) {
  const enc = new TextEncoder().encode(pin);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPin(pin) {
  if (!state.data.settings || !state.data.settings.pinHash) return false;
  const hash = await hashPin(pin);
  return hash === state.data.settings.pinHash;
}

/* DAY CLOSING */

async function onCloseDay() {
  const dateStr = document.getElementById("closeDayDate").value;
  if (!dateStr) {
    showToast("Select a date to close.", true);
    return;
  }

  const ok = await ensureAuthenticated();
  if (!ok) return;

  if (!Array.isArray(state.data.closedDays)) {
    state.data.closedDays = [];
  }
  if (!state.data.closedDays.includes(dateStr)) {
    state.data.closedDays.push(dateStr);
  }

  await persistData(`Marked ${dateStr} as closed.`);
}

/* REPORTING */

function renderAll() {
  renderReports();
  renderEntriesTable();
}

function renderReports() {
  const entries = state.data.entries || [];
  const today = new Date();

  const todayEntries = entries.filter((e) =>
    isSameDay(parseISODate(e.date), today)
  );
  const weekEntries = entries.filter((e) =>
    isSameWeek(parseISODate(e.date), today)
  );
  const monthEntries = entries.filter((e) =>
    isSameMonth(parseISODate(e.date), today)
  );
  const yearEntries = entries.filter((e) =>
    isSameYear(parseISODate(e.date), today)
  );

  updateSummaryCard("todaySummary", "Today", computeSummary(todayEntries));
  updateSummaryCard("weekSummary", "This week", computeSummary(weekEntries));
  updateSummaryCard("monthSummary", "This month", computeSummary(monthEntries));
  updateSummaryCard("yearSummary", "This year", computeSummary(yearEntries));

  const rangeEntries = filterEntriesByDateRange(
    entries,
    state.currentRange.from,
    state.currentRange.to
  );
  const rangeSummary = computeSummary(rangeEntries);

  const rangeTitleEl = document.getElementById("rangeTitle");
  const rangeTotalsEl = document.getElementById("rangeTotals");

  if (state.currentRange.from || state.currentRange.to) {
    const fromLabel = state.currentRange.from || "start";
    const toLabel = state.currentRange.to || "end";
    rangeTitleEl.textContent = `From ${fromLabel} to ${toLabel}`;
  } else {
    rangeTitleEl.textContent = "All time";
  }

  rangeTotalsEl.textContent =
    `Income: ${formatCurrency(rangeSummary.income)}, ` +
    `Expenses: ${formatCurrency(rangeSummary.expense)}, ` +
    `Profit: ${formatCurrency(rangeSummary.profit)}`;

  renderChart(rangeEntries);
  renderRecentEntries(entries);
  renderReminders(entries);
}

function updateSummaryCard(elementId, label, summary) {
  const card = document.getElementById(elementId);
  if (!card) return;
  const labelEl = card.querySelector(".summary-card__label");
  const incomeEl = card.querySelector(".summary-card__income");
  const expenseEl = card.querySelector(".summary-card__expense");
  const profitEl = card.querySelector(".summary-card__profit");

  if (labelEl) labelEl.textContent = label;
  if (incomeEl) incomeEl.textContent = formatCurrency(summary.income);
  if (expenseEl) expenseEl.textContent = formatCurrency(summary.expense);
  if (profitEl) profitEl.textContent = formatCurrency(summary.profit);
}

function computeSummary(entries) {
  return entries.reduce(
    (acc, e) => {
      const amount = Number(e.amount) || 0;
      if (e.type === "income") acc.income += amount;
      else acc.expense += amount;
      acc.profit = acc.income - acc.expense;
      return acc;
    },
    { income: 0, expense: 0, profit: 0 }
  );
}

function filterEntriesByDateRange(entries, fromStr, toStr) {
  if (!fromStr && !toStr) {
    return entries.slice().sort(sortByDateAsc);
  }
  const from = fromStr ? parseISODate(fromStr) : null;
  const to = toStr ? parseISODate(toStr) : null;

  return entries
    .filter((e) => {
      const d = parseISODate(e.date);
      if (Number.isNaN(d.getTime())) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    })
    .sort(sortByDateAsc);
}

/* CHARTS */

function renderChart(entries) {
  const canvas = document.getElementById("profitChart");
  if (!canvas) return;

  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }

  const modeSelect = document.getElementById("chartModeSelect");
  const mode = modeSelect ? modeSelect.value : "monthly";

  const grouped = groupEntriesByMode(entries, mode);
  const labels = grouped.map((g) => g.label);
  const profits = grouped.map((g) => g.profit);

  const ctx = canvas.getContext("2d");
  state.chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Profit",
          data: profits
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  });
}

function groupEntriesByMode(entries, mode) {
  const map = new Map();

  entries.forEach((entry) => {
    const d = parseISODate(entry.date);
    if (Number.isNaN(d.getTime())) return;

    const year = d.getFullYear();
    const month = d.getMonth();
    const quarter = Math.floor(month / 3) + 1;

    let key;
    let label;
    let sortValue;

    if (mode === "daily") {
      key = toISODate(d);
      label = formatShortDate(d);
      sortValue = d.getTime();
    } else if (mode === "weekly") {
      const monday = getWeekStart(d);
      key = toISODate(monday);
      label = "Week of " + formatShortDate(monday);
      sortValue = monday.getTime();
    } else if (mode === "quarterly") {
      key = `${year}-Q${quarter}`;
      label = `Q${quarter} ${year}`;
      const quarterStart = new Date(year, (quarter - 1) * 3, 1);
      sortValue = quarterStart.getTime();
    } else if (mode === "yearly") {
      key = `${year}`;
      label = `${year}`;
      const yearStart = new Date(year, 0, 1);
      sortValue = yearStart.getTime();
    } else {
      const monthIndex = month + 1;
      key = `${year}-${String(monthIndex).padStart(2, "0")}`;
      label = `${getMonthShortName(month)} ${year}`;
      const monthStart = new Date(year, month, 1);
      sortValue = monthStart.getTime();
    }

    if (!map.has(key)) {
      map.set(key, {
        key,
        label,
        income: 0,
        expense: 0,
        profit: 0,
        sortValue
      });
    }

    const agg = map.get(key);
    const amount = Number(entry.amount) || 0;
    if (entry.type === "income") {
      agg.income += amount;
    } else {
      agg.expense += amount;
    }
    agg.profit = agg.income - agg.expense;
  });

  return Array.from(map.values()).sort((a, b) => a.sortValue - b.sortValue);
}

/* RECENT ENTRIES */

function renderRecentEntries(entries) {
  const list = document.getElementById("recentEntriesList");
  if (!list) return;

  const sorted = entries.slice().sort(sortByDateDesc);
  const top = sorted.slice(0, 10);

  list.innerHTML = "";
  if (top.length === 0) {
    const li = document.createElement("li");
    li.className = "recent-list__empty";
    li.textContent = "No entries yet.";
    list.appendChild(li);
    return;
  }

  top.forEach((e) => {
    const d = parseISODate(e.date);
    const li = document.createElement("li");
    li.className = "recent-list__item";
    const sign = e.type === "income" ? "+" : "−";

    li.innerHTML = `
      <div class="recent-list__main">
        <span class="recent-list__date">${formatShortDate(d)} (${e.date})</span>
        <span class="recent-list__amount">${sign}${formatCurrency(e.amount)}</span>
      </div>
      <div class="recent-list__meta">
        <span class="recent-list__type">${e.type}</span>
        <span class="recent-list__category">${e.category || ""}</span>
        <span class="recent-list__note">${e.note || ""}</span>
      </div>
    `;
    list.appendChild(li);
  });
}

/* ALL RECORDS TABLE (VIEW / EDIT / DELETE) */

function renderEntriesTable() {
  const tbody = document.getElementById("entriesTableBody");
  if (!tbody) return;

  const all = state.data.entries || [];
  const fromStr = document.getElementById("dataFromDate").value || null;
  const toStr = document.getElementById("dataToDate").value || null;
  const typeFilter = document.getElementById("dataTypeFilter").value || "";

  let filtered = filterEntriesByDateRange(all, fromStr, toStr);

  if (typeFilter) {
    filtered = filtered.filter((e) => e.type === typeFilter);
  }

  const sorted = filtered.slice().sort(sortByDateDesc);

  tbody.innerHTML = "";

  if (!sorted.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "No records for this filter.";
    td.style.color = "var(--text-muted)";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  sorted.forEach((e) => {
    const tr = document.createElement("tr");

    const dateTd = document.createElement("td");
    const d = parseISODate(e.date);
    dateTd.textContent = `${formatShortDate(d)} (${e.date})`;

    const typeTd = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "data-badge";
    badge.textContent = e.type === "income" ? "Income" : "Expense";
    typeTd.appendChild(badge);

    const catTd = document.createElement("td");
    catTd.textContent = e.category || "";

    const amtTd = document.createElement("td");
    const sign = e.type === "income" ? "+" : "−";
    amtTd.textContent = `${sign}${formatCurrency(e.amount)}`;

    const noteTd = document.createElement("td");
    noteTd.textContent = e.note || "";

    const actionsTd = document.createElement("td");
    actionsTd.className = "data-table__actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "button button--ghost";
    editBtn.style.fontSize = "0.75rem";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => startEditEntry(e.id));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "button button--secondary";
    delBtn.style.fontSize = "0.75rem";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => onDeleteEntry(e.id));

    actionsTd.appendChild(editBtn);
    actionsTd.appendChild(delBtn);

    tr.appendChild(dateTd);
    tr.appendChild(typeTd);
    tr.appendChild(catTd);
    tr.appendChild(amtTd);
    tr.appendChild(noteTd);
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  });
}

/* REMINDERS (MISSING DAYS) */

function renderReminders(entries) {
  const banner = document.getElementById("reminderBanner");
  if (!banner) return;

  const missing = findMissingDays(entries, 7);
  if (missing.length === 0) {
    banner.classList.add("reminder-banner--hidden");
    banner.textContent = "";
    return;
  }

  const humanList = missing
    .map((dateStr) => {
      const d = parseISODate(dateStr);
      return `${formatShortDate(d)} (${dateStr})`;
    })
    .join(", ");

  banner.classList.remove("reminder-banner--hidden");
  banner.innerHTML = `<strong>Reminder:</strong> No records for ${humanList}. Use the date picker when adding records to fill these days.`;
}

function findMissingDays(entries, lookbackDays) {
  const set = new Set(entries.map((e) => e.date));
  const closed = Array.isArray(state.data.closedDays) ? state.data.closedDays : [];
  const closedSet = new Set(closed);

  const missing = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < lookbackDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = toISODate(d);
    if (!set.has(dateStr) && !closedSet.has(dateStr)) {
      missing.push(dateStr);
    }
  }

  return missing;
}

/* DATE HELPERS */

function parseISODate(str) {
  if (!str) return new Date(NaN);
  return new Date(str + "T00:00:00");
}

function toISODate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isSameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function isSameYear(a, b) {
  return a.getFullYear() === b.getFullYear();
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // Monday as first day
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameWeek(a, b) {
  return getWeekStart(a).getTime() === getWeekStart(b).getTime();
}

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

function getMonthShortName(i) {
  return MONTHS_SHORT[i] || "";
}

function formatShortDate(d) {
  const day = String(d.getDate()).padStart(2, "0");
  const month = getMonthShortName(d.getMonth());
  return `${day} ${month}`;
}

function sortByDateAsc(a, b) {
  const da = parseISODate(a.date).getTime();
  const db = parseISODate(b.date).getTime();
  return da - db;
}

function sortByDateDesc(a, b) {
  const da = parseISODate(a.date).getTime();
  const db = parseISODate(b.date).getTime();
  return db - da;
}

function formatCurrency(amount) {
  const value = Number(amount) || 0;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/* TOAST & LOADER */

function showToast(message, isError) {
  const el = document.getElementById("toast");
  if (!el) {
    console.log(message);
    return;
  }
  el.textContent = message;
  el.classList.remove("toast--hidden");
  el.classList.toggle("toast--error", !!isError);

  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.classList.add("toast--hidden");
  }, 4000);
}

function showLoading(show) {
  const el = document.getElementById("loadingOverlay");
  if (!el) return;
  el.classList.toggle("loading-overlay--hidden", !show);
}

/* PWA */

function initPWA() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("service-worker.js")
      .catch((err) => console.error("Service worker registration failed", err));
  }
}

/* DATA PERSISTENCE WRAPPERS */

async function persistData(successMessage) {
  try {
    showLoading(true);
    await saveExpenseData(state.data);
    renderAll();
    if (successMessage) showToast(successMessage);
  } catch (err) {
    console.error("Error saving data to Drive", err);
    showToast("Could not save to Drive. See console for details.", true);
  } finally {
    showLoading(false);
  }
}
