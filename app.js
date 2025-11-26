// app.js – ACexpenso

const DEFAULT_PIN = "2807";

const state = {
  data: {
    settings: {},
    entries: [],
    closedDays: []
  },
  ui: {
    activeView: "view-reports",
    editingEntryId: null,
    chartMetric: "profit"
  },
  currentRange: {
    from: null,
    to: null
  },
  charts: {
    trendChart: null,
    expenseChart: null
  },
  authenticated: false
};

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initViewNavigation();
  initTopBar();
  initEventHandlers();
  initPWA();
  bootstrapData();
});

/* ============================
 * THEME
 * ============================ */

function initTheme() {
  const stored = localStorage.getItem("acexpenso-theme");
  const initial = stored || "dark";
  setTheme(initial);

  const toggleBtn = document.getElementById("themeToggleBtn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const root = document.getElementById("appRoot");
      const isDark = root.classList.contains("app--dark");
      const next = isDark ? "light" : "dark";
      setTheme(next);
      localStorage.setItem("acexpenso-theme", next);
    });
  }
}

function setTheme(theme) {
  const root = document.getElementById("appRoot");
  if (!root) return;

  root.classList.toggle("app--dark", theme === "dark");
  root.classList.toggle("app--light", theme === "light");

  const toggleBtn = document.getElementById("themeToggleBtn");
  if (toggleBtn) {
    toggleBtn.textContent = theme === "dark" ? "Theme: Dark" : "Theme: Light";
  }
}

/* ============================
 * VIEW NAVIGATION (SIDEBAR)
 * ============================ */

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
      const viewId = btn.dataset.view || "view-reports";
      switchView(viewId);

      navButtons.forEach((b) => {
        b.classList.toggle("sidebar-nav__item--active", b === btn);
      });

      if (window.innerWidth <= 960 && sidebar) {
        sidebar.classList.add("sidebar--hidden");
      }
    });
  });

  // Default view
  switchView("view-reports");
}

function switchView(viewId) {
  state.ui.activeView = viewId;

  document.querySelectorAll(".view").forEach((el) => {
    el.classList.toggle("view--active", el.id === viewId);
  });

  if (viewId === "view-add") {
    // For direct "Add record" navigation we reset the form in "new" mode
    prepareAddFormForNew();
    renderReminderBanner();
  } else if (viewId === "view-data") {
    renderDataTable();
  } else if (viewId === "view-settings") {
    renderClosedDaysList();
  } else if (viewId === "view-reports") {
    renderReports();
  }
}

/* ============================
 * TOP BAR (AUTH, PRINT, STATUS)
 * ============================ */

function initTopBar() {
  const signInBtn = document.getElementById("signInBtn");
  const signOutBtn = document.getElementById("signOutBtn");
  const printReportsBtn = document.getElementById("printReportsBtn");

  if (printReportsBtn) {
    printReportsBtn.addEventListener("click", () => window.print());
  }

  if (signInBtn) {
    signInBtn.addEventListener("click", () => {
      if (window.driveSignIn) {
        window.driveSignIn();
      }
      // Give GIS a moment to complete, then reload from Drive if possible
      setTimeout(() => {
        updateDriveStatusUI();
        bootstrapData();
      }, 1500);
    });
  }

  if (signOutBtn) {
    signOutBtn.addEventListener("click", () => {
      if (window.driveSignOut) {
        window.driveSignOut();
      }
      state.authenticated = false;
      updateDriveStatusUI();
      showToast("Signed out of Google Drive.");
    });
  }
}

/* ============================
 * INITIAL DATA LOAD
 * ============================ */

async function bootstrapData() {
  showLoading(true);
  updateDriveStatusUI("Loading…");
  try {
    let data = await fetchExpenseData();
    if (!data || typeof data !== "object") data = {};
    if (!data.settings) data.settings = {};
    if (!Array.isArray(data.entries)) data.entries = [];
    if (!Array.isArray(data.closedDays)) data.closedDays = [];

    state.data = data;
    await ensurePinHashExists();
    initDefaultDates();
    renderAll();
  } catch (err) {
    console.error("Error loading data from Drive", err);
    showToast(
      "Could not load data from Drive. Using local backup if available.",
      true
    );
  } finally {
    showLoading(false);
    updateDriveStatusUI();
  }
}

async function ensurePinHashExists() {
  if (!state.data.settings) state.data.settings = {};
  if (state.data.settings.pinHash) return;
  const hash = await hashPin(DEFAULT_PIN);
  state.data.settings.pinHash = hash;
}

function initDefaultDates() {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const todayISO = toISODate(today);
  const firstISO = toISODate(firstOfMonth);

  const reportFrom = document.getElementById("reportFrom");
  const reportTo = document.getElementById("reportTo");
  const entryDate = document.getElementById("entryDate");
  const dataFrom = document.getElementById("dataFrom");
  const dataTo = document.getElementById("dataTo");
  const closedInput = document.getElementById("closedDateInput");

  if (reportFrom) reportFrom.value = firstISO;
  if (reportTo) reportTo.value = todayISO;
  if (entryDate) entryDate.value = todayISO;
  if (dataFrom) dataFrom.value = firstISO;
  if (dataTo) dataTo.value = todayISO;
  if (closedInput) closedInput.value = todayISO;

  state.currentRange.from = firstISO;
  state.currentRange.to = todayISO;
}

/* ============================
 * EVENTS
 * ============================ */

function initEventHandlers() {
  // Reports date range
  const reportFrom = document.getElementById("reportFrom");
  const reportTo = document.getElementById("reportTo");

  if (reportFrom) {
    reportFrom.addEventListener("change", () => {
      state.currentRange.from = reportFrom.value || null;
      renderReports();
    });
  }
  if (reportTo) {
    reportTo.addEventListener("change", () => {
      state.currentRange.to = reportTo.value || null;
      renderReports();
    });
  }

  // Quick range buttons
  const quickTodayBtn = document.getElementById("quickTodayBtn");
  const quickThisWeekBtn = document.getElementById("quickThisWeekBtn");
  const quickThisMonthBtn = document.getElementById("quickThisMonthBtn");

  if (quickTodayBtn) {
    quickTodayBtn.addEventListener("click", () => {
      const today = new Date();
      const iso = toISODate(today);
      if (reportFrom) reportFrom.value = iso;
      if (reportTo) reportTo.value = iso;
      state.currentRange = { from: iso, to: iso };
      renderReports();
    });
  }

  if (quickThisWeekBtn) {
    quickThisWeekBtn.addEventListener("click", () => {
      const today = new Date();
      const start = getWeekStart(today);
      const end = getWeekEnd(today);
      if (reportFrom) reportFrom.value = toISODate(start);
      if (reportTo) reportTo.value = toISODate(end);
      state.currentRange = { from: toISODate(start), to: toISODate(end) };
      renderReports();
    });
  }

  if (quickThisMonthBtn) {
    quickThisMonthBtn.addEventListener("click", () => {
      const today = new Date();
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      if (reportFrom) reportFrom.value = toISODate(first);
      if (reportTo) reportTo.value = toISODate(last);
      state.currentRange = { from: toISODate(first), to: toISODate(last) };
      renderReports();
    });
  }

  // Chart metric toggle
  const metricToggle = document.getElementById("chartMetricToggle");
  if (metricToggle) {
    metricToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".chart-metric-btn");
      if (!btn) return;
      const metric = btn.dataset.metric || "profit";
      state.ui.chartMetric = metric;
      document
        .querySelectorAll(".chart-metric-btn")
        .forEach((b) =>
          b.classList.toggle("chart-metric-btn--active", b === btn)
        );
      renderReports();
    });
  }

  // Group-by select
  const groupBySelect = document.getElementById("reportGroupBy");
  if (groupBySelect) {
    groupBySelect.addEventListener("change", () => {
      renderReports();
    });
  }

  // Add record form
  const entryForm = document.getElementById("entryForm");
  if (entryForm) {
    entryForm.addEventListener("submit", onEntrySubmit);
  }

  const resetEntryBtn = document.getElementById("resetEntryBtn");
  if (resetEntryBtn) {
    resetEntryBtn.addEventListener("click", () => prepareAddFormForNew(true));
  }

  // Data table filters
  const dataFrom = document.getElementById("dataFrom");
  const dataTo = document.getElementById("dataTo");
  const dataTypeFilter = document.getElementById("dataTypeFilter");
  const dataCategoryFilter = document.getElementById("dataCategoryFilter");
  const dataSearch = document.getElementById("dataSearch");

  [dataFrom, dataTo, dataTypeFilter, dataCategoryFilter, dataSearch].forEach(
    (el) => {
      if (!el) return;
      el.addEventListener("input", renderDataTable);
      el.addEventListener("change", renderDataTable);
    }
  );

  // Export JSON
  const dataExportBtn = document.getElementById("dataExportBtn");
  if (dataExportBtn) {
    dataExportBtn.addEventListener("click", () => {
      exportJsonBackup();
    });
  }

  // PIN form
  const pinForm = document.getElementById("pinForm");
  if (pinForm) {
    pinForm.addEventListener("submit", onPinFormSubmit);
  }

  // Closed day form
  const closedDayForm = document.getElementById("closedDayForm");
  if (closedDayForm) {
    closedDayForm.addEventListener("submit", onClosedDaySubmit);
  }
}

/* ============================
 * ADD / EDIT ENTRY
 * ============================ */

function prepareAddFormForNew(clearAll = false) {
  state.ui.editingEntryId = null;

  const entryDate = document.getElementById("entryDate");
  const entryType = document.getElementById("entryType");
  const entryAmount = document.getElementById("entryAmount");
  const entryCategory = document.getElementById("entryCategory");
  const entryPaymentMode = document.getElementById("entryPaymentMode");
  const entryNote = document.getElementById("entryNote");
  const entryClosed = document.getElementById("entryClosed");

  const todayISO = toISODate(new Date());

  if (!entryDate.value || clearAll) entryDate.value = todayISO;
  if (entryType) entryType.value = "expense";
  if (entryAmount && clearAll) entryAmount.value = "";
  if (entryCategory && clearAll) entryCategory.value = "";
  if (entryPaymentMode && clearAll) entryPaymentMode.value = "";
  if (entryNote && clearAll) entryNote.value = "";
  if (entryClosed) entryClosed.checked = false;
}

async function onEntrySubmit(event) {
  event.preventDefault();

  const dateStr = document.getElementById("entryDate").value;
  const type = document.getElementById("entryType").value;
  const amountStr = document.getElementById("entryAmount").value;
  const category = document.getElementById("entryCategory").value.trim();
  const paymentMode = document.getElementById("entryPaymentMode").value;
  const note = document.getElementById("entryNote").value.trim();
  const closedCheckbox = document.getElementById("entryClosed");

  const closedChecked = closedCheckbox ? closedCheckbox.checked : false;

  if (!dateStr) {
    showToast("Date is required.", true);
    return;
  }

  // If marked as closed & no amount, treat as closed day (no entry)
  if (closedChecked && !amountStr) {
    await addClosedDay(dateStr);
    closedCheckbox.checked = false;
    showToast(`Marked ${dateStr} as shop closed.`);
    renderReminderBanner();
    return;
  }

  if (!amountStr || !type) {
    showToast("Type and amount are required (or mark as closed day).", true);
    return;
  }

  const amount = Number(amountStr);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Amount must be a positive number.", true);
    return;
  }

  const now = new Date();
  const editingId = state.ui.editingEntryId;

  if (editingId) {
    // EDIT existing entry: require PIN
    const ok = await ensureAuthenticated();
    if (!ok) return;

    const entry = state.data.entries.find((e) => e.id === editingId);
    if (!entry) {
      showToast("Record not found.", true);
      return;
    }
    entry.date = dateStr;
    entry.type = type;
    entry.amount = amount;
    entry.category = category;
    entry.paymentMode = paymentMode || "";
    entry.note = note;
    entry.updatedAt = now.toISOString();
    state.ui.editingEntryId = null;
    await persistData("Record updated.");
  } else {
    // NEW entry: allowed without PIN
    const id = `${dateStr}_${now.getTime()}`;
    state.data.entries.push({
      id,
      date: dateStr,
      type,
      amount,
      category,
      paymentMode: paymentMode || "",
      note,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
    await persistData("Record added.");
  }

  // Keep same date & type; clear amount & note for quick multiple entries
  document.getElementById("entryAmount").value = "";
  document.getElementById("entryNote").value = "";
  if (closedCheckbox) closedCheckbox.checked = false;
}

/**
 * EDIT FLOW FIX:
 * - Show the Add view first (which resets to "new" mode),
 * - then set editingEntryId and overwrite the form fields.
 * - on submit, onEntrySubmit sees editingEntryId and updates instead of adding.
 */
function startEditEntry(entryId) {
  const entry = state.data.entries.find((e) => e.id === entryId);
  if (!entry) {
    showToast("Record not found.", true);
    return;
  }

  // First switch to Add view so the form & layout are visible
  switchView("view-add");

  // Now mark this as an edit
  state.ui.editingEntryId = entryId;

  const date = document.getElementById("entryDate");
  const type = document.getElementById("entryType");
  const category = document.getElementById("entryCategory");
  const amount = document.getElementById("entryAmount");
  const paymentMode = document.getElementById("entryPaymentMode");
  const note = document.getElementById("entryNote");
  const closedCheckbox = document.getElementById("entryClosed");

  if (date) date.value = entry.date;
  if (type) type.value = entry.type;
  if (category) category.value = entry.category || "";
  if (amount) amount.value = entry.amount;
  if (paymentMode) paymentMode.value = entry.paymentMode || "";
  if (note) note.value = entry.note || "";
  if (closedCheckbox) closedCheckbox.checked = false;
}

/* DELETE ENTRY */

async function onDeleteEntry(entryId) {
  const okAuth = await ensureAuthenticated();
  if (!okAuth) return;

  const confirmDelete = window.confirm("Delete this record permanently?");
  if (!confirmDelete) return;

  state.data.entries = (state.data.entries || []).filter((e) => e.id !== entryId);
  await persistData("Record deleted.");
}

/* ============================
 * PIN & AUTH
 * ============================ */

async function onPinFormSubmit(event) {
  event.preventDefault();

  const current = document.getElementById("currentPin").value;
  const next = document.getElementById("newPin").value;
  const confirmPin = document.getElementById("confirmPin").value;

  if (!current || !next || !confirmPin) {
    showToast("Fill all PIN fields.", true);
    return;
  }

  if (next !== confirmPin) {
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
  document.getElementById("confirmPin").value = "";

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

/* ============================
 * CLOSED DAYS
 * ============================ */

async function onClosedDaySubmit(event) {
  event.preventDefault();
  const dateStr = document.getElementById("closedDateInput").value;
  if (!dateStr) {
    showToast("Select a date to add as closed.", true);
    return;
  }
  await addClosedDay(dateStr);
}

async function addClosedDay(dateStr) {
  const ok = await ensureAuthenticated();
  if (!ok) return;

  if (!Array.isArray(state.data.closedDays)) state.data.closedDays = [];
  if (!state.data.closedDays.includes(dateStr)) {
    state.data.closedDays.push(dateStr);
    await persistData(`Marked ${dateStr} as closed.`);
  } else {
    showToast("This date is already marked as closed.");
  }
}

async function removeClosedDay(dateStr) {
  const ok = await ensureAuthenticated();
  if (!ok) return;

  state.data.closedDays = (state.data.closedDays || []).filter((d) => d !== dateStr);
  await persistData(`Removed ${dateStr} from closed days.`);
}

function renderClosedDaysList() {
  const list = document.getElementById("closedDaysList");
  if (!list) return;

  const arr = Array.isArray(state.data.closedDays)
    ? [...state.data.closedDays]
    : [];
  arr.sort();

  list.innerHTML = "";
  if (!arr.length) {
    const li = document.createElement("li");
    li.className = "recent-list__empty";
    li.textContent = "No closed days recorded yet.";
    list.appendChild(li);
    return;
  }

  arr.forEach((dateStr) => {
    const d = parseISODate(dateStr);
    const li = document.createElement("li");
    li.className = "recent-list__item";
    li.innerHTML = `
      <div class="recent-list__main">
        <span>${formatShortDate(d)} (${dateStr})</span>
        <button type="button" class="button button--ghost" style="font-size:0.75rem;">Remove</button>
      </div>
    `;
    const btn = li.querySelector("button");
    btn.addEventListener("click", () => removeClosedDay(dateStr));
    list.appendChild(li);
  });
}

/* ============================
 * REPORTS & CHARTS
 * ============================ */

function renderAll() {
  renderReports();
  renderDataTable();
  renderReminderBanner();
  updateCategoryDatalist();
  renderClosedDaysList();
}

function renderReports() {
  const entries = state.data.entries || [];
  const { from, to } = state.currentRange;

  const rangeEntries = filterEntriesByDateRange(entries, from, to);
  const summary = computeSummary(rangeEntries);

  const totalIncomeEl = document.getElementById("summaryTotalIncome");
  const totalExpenseEl = document.getElementById("summaryTotalExpense");
  const totalProfitEl = document.getElementById("summaryTotalProfit");
  const entryCountEl = document.getElementById("summaryEntryCount");

  if (totalIncomeEl)
    totalIncomeEl.textContent = "₹" + formatCurrency(summary.income);
  if (totalExpenseEl)
    totalExpenseEl.textContent = "₹" + formatCurrency(summary.expense);
  if (totalProfitEl)
    totalProfitEl.textContent = "₹" + formatCurrency(summary.profit);
  if (entryCountEl) entryCountEl.textContent = String(rangeEntries.length);

  const rangeTitleEl = document.getElementById("rangeTitle");
  const rangeSubtitleEl = document.getElementById("rangeSubtitle");

  if (rangeTitleEl && rangeSubtitleEl) {
    if (!entries.length) {
      rangeTitleEl.textContent = "No data yet";
      rangeSubtitleEl.textContent =
        "Start by adding collections and expenses in the Add record view.";
    } else if (from || to) {
      const fromLabel = from || "start";
      const toLabel = to || "end";
      rangeTitleEl.textContent = `From ${fromLabel} to ${toLabel}`;
      rangeSubtitleEl.textContent =
        `Collections: ₹${formatCurrency(summary.income)} · ` +
        `Expenses: ₹${formatCurrency(summary.expense)} · ` +
        `Profit: ₹${formatCurrency(summary.profit)}`;
    } else {
      rangeTitleEl.textContent = "All time overview";
      rangeSubtitleEl.textContent =
        `Total collections: ₹${formatCurrency(summary.income)}, ` +
        `total expenses: ₹${formatCurrency(summary.expense)}, ` +
        `net profit: ₹${formatCurrency(summary.profit)}.`;
    }
  }

  renderTrendChart(rangeEntries);
  renderExpenseCategoryChart(rangeEntries);
  renderReportsRecentList(rangeEntries);
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

/* Trend chart: metric + groupBy */

function renderTrendChart(entries) {
  const canvas = document.getElementById("trendChart");
  if (!canvas || typeof Chart === "undefined") return;

  if (state.charts.trendChart) {
    state.charts.trendChart.destroy();
    state.charts.trendChart = null;
  }

  const metric = state.ui.chartMetric || "profit";
  const groupBySelect = document.getElementById("reportGroupBy");
  const groupBy = groupBySelect ? groupBySelect.value || "monthly" : "monthly";

  const grouped = groupEntriesForTrend(entries, groupBy);
  const labels = grouped.map((g) => g.label);
  let data;
  let label;

  if (metric === "income") {
    data = grouped.map((g) => g.income);
    label = "Collections";
  } else if (metric === "expense") {
    data = grouped.map((g) => g.expense);
    label = "Expenses";
  } else {
    data = grouped.map((g) => g.profit);
    label = "Profit";
  }

  const ctx = canvas.getContext("2d");
  state.charts.trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label,
          data,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true }
      },
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  });
}

function groupEntriesForTrend(entries, mode) {
  const map = new Map();

  entries.forEach((entry) => {
    const d = parseISODate(entry.date);
    if (Number.isNaN(d.getTime())) return;

    const year = d.getFullYear();
    const month = d.getMonth();

    let key;
    let label;
    let sortValue;

    if (mode === "yearly") {
      key = `${year}`;
      label = String(year);
      sortValue = new Date(year, 0, 1).getTime();
    } else if (mode === "all") {
      key = "all";
      label = "All";
      sortValue = 0;
    } else {
      // monthly
      const mIndex = month + 1;
      key = `${year}-${String(mIndex).padStart(2, "0")}`;
      label = `${getMonthShortName(month)} ${year}`;
      sortValue = new Date(year, month, 1).getTime();
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

/* Expense category pie chart */

function renderExpenseCategoryChart(entries) {
  const canvas = document.getElementById("expenseCategoryChart");
  if (!canvas || typeof Chart === "undefined") return;

  if (state.charts.expenseChart) {
    state.charts.expenseChart.destroy();
    state.charts.expenseChart = null;
  }

  const expenses = entries.filter((e) => e.type === "expense");
  if (!expenses.length) {
    // nothing to show
    return;
  }

  const categoryMap = new Map();
  expenses.forEach((e) => {
    const cat = (e.category || "Uncategorized").trim() || "Uncategorized";
    const amt = Number(e.amount) || 0;
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + amt);
  });

  const labels = Array.from(categoryMap.keys());
  const data = Array.from(categoryMap.values());

  const ctx = canvas.getContext("2d");
  state.charts.expenseChart = new Chart(ctx, {
    type: "pie",
    data: {
      labels,
      datasets: [
        {
          label: "Expenses by category",
          data
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "right" }
      }
    }
  });
}

/* Recent entries in current range */

function renderReportsRecentList(rangeEntries) {
  const list = document.getElementById("reportsRecentList");
  if (!list) return;

  const sorted = rangeEntries.slice().sort(sortByDateDesc);
  const top = sorted.slice(0, 12);

  list.innerHTML = "";
  if (!top.length) {
    const li = document.createElement("li");
    li.className = "recent-list__empty";
    li.textContent = "No entries in this period.";
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
        <span class="recent-list__amount">${sign}₹${formatCurrency(e.amount)}</span>
      </div>
      <div class="recent-list__meta">
        <span>${e.type === "income" ? "Collection" : "Expense"}</span>
        <span>${e.category || ""}</span>
        <span>${e.paymentMode || ""}</span>
        <span>${e.note || ""}</span>
      </div>
    `;
    list.appendChild(li);
  });
}

/* ============================
 * ALL RECORDS TABLE
 * ============================ */

function renderDataTable() {
  const tbody = document.getElementById("dataTableBody");
  const countLabel = document.getElementById("dataCountLabel");
  if (!tbody) return;

  const all = state.data.entries || [];

  const fromStr = document.getElementById("dataFrom")?.value || null;
  const toStr = document.getElementById("dataTo")?.value || null;
  const typeFilter = document.getElementById("dataTypeFilter")?.value || "";
  const catFilterRaw =
    document.getElementById("dataCategoryFilter")?.value.trim().toLowerCase() ||
    "";
  const searchRaw =
    document.getElementById("dataSearch")?.value.trim().toLowerCase() || "";

  let filtered = filterEntriesByDateRange(all, fromStr, toStr);

  if (typeFilter) {
    filtered = filtered.filter((e) => e.type === typeFilter);
  }

  if (catFilterRaw) {
    filtered = filtered.filter((e) =>
      (e.category || "").toLowerCase().includes(catFilterRaw)
    );
  }

  if (searchRaw) {
    filtered = filtered.filter((e) =>
      (e.note || "").toLowerCase().includes(searchRaw)
    );
  }

  filtered.sort(sortByDateDesc);

  tbody.innerHTML = "";

  if (countLabel) {
    countLabel.textContent = `${filtered.length} record${
      filtered.length === 1 ? "" : "s"
    }`;
  }

  if (!filtered.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.textContent = "No records for this filter.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  filtered.forEach((e) => {
    const tr = document.createElement("tr");

    const dateTd = document.createElement("td");
    const d = parseISODate(e.date);
    dateTd.textContent = `${formatShortDate(d)} (${e.date})`;

    const typeTd = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "data-badge";
    badge.textContent = e.type === "income" ? "Collection" : "Expense";
    typeTd.appendChild(badge);

    const catTd = document.createElement("td");
    catTd.textContent = e.category || "";

    const amtTd = document.createElement("td");
    const sign = e.type === "income" ? "+" : "−";
    amtTd.textContent = `${sign}₹${formatCurrency(e.amount)}`;

    const modeTd = document.createElement("td");
    modeTd.textContent = e.paymentMode || "";

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
    tr.appendChild(modeTd);
    tr.appendChild(noteTd);
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  });
}

/* ============================
 * CATEGORY DATALIST
 * ============================ */

function updateCategoryDatalist() {
  const datalist = document.getElementById("categorySuggestions");
  if (!datalist) return;

  const seen = new Set();
  datalist.innerHTML = "";

  (state.data.entries || []).forEach((e) => {
    const raw = (e.category || "").trim();
    if (!raw) return;
    const lower = raw.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    const option = document.createElement("option");
    option.value = raw;
    datalist.appendChild(option);
  });
}

/* ============================
 * REMINDERS (MISSING DAYS)
 * ============================ */

function renderReminderBanner() {
  const banner = document.getElementById("reminderBanner");
  if (!banner) return;

  const entries = state.data.entries || [];
  const missing = findMissingDays(entries, 7);

  if (!missing.length) {
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
  banner.innerHTML = `<strong>Reminder:</strong> No records for ${humanList}. Use the date picker when adding records or mark closed days.`;
}

function findMissingDays(entries, lookbackDays) {
  const set = new Set(entries.map((e) => e.date));
  const closed = Array.isArray(state.data.closedDays)
    ? state.data.closedDays
    : [];
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

/* ============================
 * EXPORT JSON BACKUP
 * ============================ */

function exportJsonBackup() {
  const dataStr = JSON.stringify(state.data, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "acexpenso_backup.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  showToast("Exported JSON backup.");
}

/* ============================
 * DATE HELPERS
 * ============================ */

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

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // Monday as first day
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekEnd(date) {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(0, 0, 0, 0);
  return end;
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
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
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

/* ============================
 * TOAST & LOADER & DRIVE STATUS
 * ============================ */

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

function updateDriveStatusUI(forceText) {
  const pill = document.getElementById("driveStatus");
  const signInBtn = document.getElementById("signInBtn");
  const signOutBtn = document.getElementById("signOutBtn");
  if (!pill) return;

  if (forceText) {
    pill.textContent = forceText;
    return;
  }

  let hasToken = false;
  try {
    if (typeof gapi !== "undefined" && gapi.client && gapi.client.getToken) {
      hasToken = !!gapi.client.getToken();
    }
  } catch (_) {
    hasToken = false;
  }

  if (hasToken) {
    pill.textContent = "Online · syncing with Google Drive";
    if (signInBtn) signInBtn.style.display = "inline-flex";
    if (signOutBtn) signOutBtn.style.display = "inline-flex";
  } else {
    pill.textContent = "Offline · local-only mode";
    if (signInBtn) signInBtn.style.display = "inline-flex";
    if (signOutBtn) signOutBtn.style.display = "none";
  }
}

/* ============================
 * PWA
 * ============================ */

function initPWA() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("service-worker.js")
      .catch((err) => console.error("Service worker registration failed", err));
  }
}

/* ============================
 * DATA SAVE WRAPPER
 * ============================ */

async function persistData(successMessage) {
  try {
    showLoading(true);
    await saveExpenseData(state.data);
    if (successMessage) showToast(successMessage);
  } catch (err) {
    console.error("Error saving data to Drive", err);
    const msg =
      err && err.message && err.message.includes("Not signed in")
        ? "Saved locally only. Sign in to sync with Drive."
        : "Could not save to Google Drive. Data saved locally.";
    showToast(msg, true);
  } finally {
    showLoading(false);
    renderAll();
    updateDriveStatusUI();
  }
}
