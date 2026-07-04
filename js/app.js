import {
  auth, db, onAuthStateChanged, signOut,
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy,
} from "./firebase-config.js";

/* ============ حماية الصفحة ============ */
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
  } else {
    document.getElementById("userEmail").textContent = user.email;
    const navInfo = document.getElementById("navUserInfo");
    if (navInfo) navInfo.textContent = user.email;
    init();
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});
document.getElementById("logoutBtnMobile")?.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

/* ============ حالة البيانات ============ */
let flatsCache = [];
let rentersCache = [];
let rentsCache = [];
let initialized = false;

const flatsCol = collection(db, "flats");
const rentersCol = collection(db, "renters");
const rentsCol = collection(db, "rents");

async function init() {
  if (initialized) return;
  initialized = true;
  setupNav();
  setupModals();
  setupForms();
  setupSearch();
  await reloadAll();
}

async function reloadAll() {
  await Promise.all([loadFlats(), loadRenters(), loadRents()]);
  renderDashboard();
  renderFlatsTable();
  renderRentersTable();
  renderRentsTable();
  populateRentSelects();
}

async function loadFlats() {
  const snap = await getDocs(flatsCol);
  flatsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  flatsCache.sort((a, b) => (a.flatNumber || 0) - (b.flatNumber || 0));
}
async function loadRenters() {
  const snap = await getDocs(rentersCol);
  rentersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  rentersCache.sort((a, b) => (a.renterName || "").localeCompare(b.renterName || "", "ar"));
}
async function loadRents() {
  const snap = await getDocs(rentsCol);
  rentsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  rentsCache.sort((a, b) => new Date(b.dateOfPay || b.dateOfRent || 0) - new Date(a.dateOfPay || a.dateOfRent || 0));
}

/* ============ التنقل بين الأقسام ============ */
function setupNav() {
  document.querySelectorAll(".nav-item[data-section]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
      document.getElementById("section-" + btn.dataset.section).classList.add("active");
      document.getElementById("navList").classList.remove("open");
    });
  });
  document.getElementById("menuToggle")?.addEventListener("click", () => {
    document.getElementById("navList").classList.toggle("open");
  });
}

/* ============ حساب حالة كل شقة (للوحة والتنبيهات) ============ */
function computeFlatStatus(flat) {
  if (!flat.rented) return { status: "vacant", latestRent: null, days: null };

  const relatedRents = rentsCache.filter(r => Number(r.flatNumber) === Number(flat.flatNumber));
  if (relatedRents.length === 0) return { status: "ok", latestRent: null, days: null };

  const latest = relatedRents.reduce((a, b) => {
    const da = a.endOfRent ? new Date(a.endOfRent) : new Date(0);
    const db_ = b.endOfRent ? new Date(b.endOfRent) : new Date(0);
    return db_ > da ? b : a;
  });

  if (!latest.endOfRent) return { status: "ok", latestRent: latest, days: null };

  const end = new Date(latest.endOfRent);
  const now = new Date();
  const days = Math.floor((end - now) / (1000 * 60 * 60 * 24));

  let status = "ok";
  if (days < 0) status = "overdue";
  else if (days <= 30) status = "warn";

  return { status, latestRent: latest, days };
}

/* ============ لوحة التحكم ============ */
function renderDashboard() {
  const total = flatsCache.length;
  const occupied = flatsCache.filter(f => f.rented).length;
  const vacant = total - occupied;

  let overdueCount = 0, warnCount = 0;
  const alerts = [];

  flatsCache.forEach(flat => {
    const { status, latestRent, days } = computeFlatStatus(flat);
    if (status === "overdue") {
      overdueCount++;
      alerts.push({ type: "overdue", flat, latestRent, days });
    } else if (status === "warn") {
      warnCount++;
      alerts.push({ type: "warn", flat, latestRent, days });
    }
  });

  document.getElementById("statGrid").innerHTML = `
    <div class="stat-card"><div class="num">${arDigits(total)}</div><div class="label">إجمالي الشقق</div></div>
    <div class="stat-card ok"><div class="num">${arDigits(occupied)}</div><div class="label">مؤجرة</div></div>
    <div class="stat-card"><div class="num">${arDigits(vacant)}</div><div class="label">شاغرة</div></div>
    <div class="stat-card warn"><div class="num">${arDigits(warnCount)}</div><div class="label">تنتهي قريباً</div></div>
    <div class="stat-card alert"><div class="num">${arDigits(overdueCount)}</div><div class="label">متأخرة</div></div>
  `;

  const badge = document.getElementById("navAlertBadge");
  const alertTotal = overdueCount + warnCount;
  if (alertTotal > 0) { badge.style.display = "inline-block"; badge.textContent = arDigits(alertTotal); }
  else badge.style.display = "none";

  renderBuilding();
  renderAlertsList(alerts);
}

function renderBuilding() {
  const wrap = document.getElementById("buildingView");
  if (flatsCache.length === 0) {
    wrap.innerHTML = `<div class="empty-note">أضف شققاً من تبويب "الشقق" ليظهر مخطط العمارة هنا</div>`;
    return;
  }

  // تجميع حسب الدور، بترتيب تصاعدي حسب أصغر رقم شقة في كل دور
  const floorsMap = new Map();
  flatsCache.forEach(f => {
    const key = f.flatFloor || "—";
    if (!floorsMap.has(key)) floorsMap.set(key, []);
    floorsMap.get(key).push(f);
  });
  const floors = [...floorsMap.entries()].sort((a, b) => {
    const minA = Math.min(...a[1].map(f => f.flatNumber || 0));
    const minB = Math.min(...b[1].map(f => f.flatNumber || 0));
    return minA - minB;
  });

  wrap.innerHTML = floors.map(([floorName, units]) => {
    const chips = units
      .sort((a, b) => (a.flatNumber || 0) - (b.flatNumber || 0))
      .map(f => {
        const { status, days } = computeFlatStatus(f);
        let statusLabel = "شاغرة";
        if (status === "ok") statusLabel = "مؤجرة";
        else if (status === "warn") statusLabel = `تنتهي خلال ${arDigits(days)} يوم`;
        else if (status === "overdue") statusLabel = `متأخرة ${arDigits(Math.abs(days))} يوم`;
        return `
          <div class="unit-chip ${status}">
            <span class="dot"></span>
            <div class="num">شقة ${arDigits(f.flatNumber)}</div>
            <div class="status">${statusLabel}</div>
          </div>`;
      }).join("");
    return `
      <div class="floor-row">
        <div class="floor-label">${floorName}</div>
        <div class="floor-units">${chips}</div>
      </div>`;
  }).join("");
}

function renderAlertsList(alerts) {
  const box = document.getElementById("alertsList");
  if (alerts.length === 0) {
    box.innerHTML = `<div class="empty-note">لا توجد تنبيهات حالياً — كل الوحدات ضمن الوضع الطبيعي</div>`;
    return;
  }
  alerts.sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  box.innerHTML = alerts.map(a => {
    const renterName = a.latestRent?.renterName || "—";
    const icon = a.type === "overdue"
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2.7 18a1.8 1.8 0 001.5 2.7h15.6a1.8 1.8 0 001.5-2.7L13.7 3.9a1.8 1.8 0 00-3.4 0z"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`;
    const text = a.type === "overdue"
      ? `انتهى العقد منذ ${arDigits(Math.abs(a.days))} يوم ولم يتم تجديده`
      : `العقد ينتهي خلال ${arDigits(a.days)} يوم`;
    return `
      <div class="alert-row ${a.type}">
        <div class="alert-icon">${icon}</div>
        <div class="alert-text">
          <div class="t1">شقة ${arDigits(a.flat.flatNumber)} — ${renterName}</div>
          <div class="t2">${text}</div>
        </div>
        <div class="alert-tag">${a.type === "overdue" ? "متأخرة" : "قريباً"}</div>
      </div>`;
  }).join("");
}

/* ============ جدول الشقق ============ */
function renderFlatsTable() {
  const body = document.getElementById("flatsTableBody");
  const empty = document.getElementById("flatsEmpty");
  if (flatsCache.length === 0) {
    body.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  body.innerHTML = flatsCache.map(f => `
    <tr>
      <td>${f.flatFloor || "—"}</td>
      <td>${arDigits(f.flatNumber)}</td>
      <td>${formatMoney(f.monthlRent)} ريال</td>
      <td>${f.meterNumber ? arDigits(f.meterNumber) : "—"}</td>
      <td><span class="pill ${f.rented ? "ok" : "vacant"}">${f.rented ? "مؤجرة" : "شاغرة"}</span></td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-edit-flat="${f.id}" title="تعديل">${editIcon()}</button>
          <button class="icon-btn danger" data-del-flat="${f.id}" title="حذف">${trashIcon()}</button>
        </div>
      </td>
    </tr>`).join("");

  body.querySelectorAll("[data-edit-flat]").forEach(b => b.addEventListener("click", () => openFlatModal(b.dataset.editFlat)));
  body.querySelectorAll("[data-del-flat]").forEach(b => b.addEventListener("click", () => deleteFlat(b.dataset.delFlat)));
}

/* ============ جدول المستأجرين ============ */
function renderRentersTable(filterText = "") {
  const body = document.getElementById("rentersTableBody");
  const empty = document.getElementById("rentersEmpty");
  const filtered = rentersCache.filter(r =>
    !filterText ||
    (r.renterName || "").includes(filterText) ||
    (r.renterId || "").includes(filterText)
  );
  if (filtered.length === 0) {
    body.innerHTML = "";
    empty.style.display = "block";
    empty.textContent = filterText ? "لا توجد نتائج مطابقة" : "لا يوجد مستأجرون مسجلون بعد";
    return;
  }
  empty.style.display = "none";
  body.innerHTML = filtered.map(r => `
    <tr>
      <td>${r.renterId ? arDigits(r.renterId) : "—"}</td>
      <td>${r.renterName || "—"}</td>
      <td>${r.nationality || "—"}</td>
      <td dir="ltr" style="text-align:right;">${r.mobile ? arDigits(r.mobile) : "—"}</td>
      <td>${r.workAddress || "—"}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-edit-renter="${r.id}" title="تعديل">${editIcon()}</button>
          <button class="icon-btn danger" data-del-renter="${r.id}" title="حذف">${trashIcon()}</button>
        </div>
      </td>
    </tr>`).join("");

  body.querySelectorAll("[data-edit-renter]").forEach(b => b.addEventListener("click", () => openRenterModal(b.dataset.editRenter)));
  body.querySelectorAll("[data-del-renter]").forEach(b => b.addEventListener("click", () => deleteRenter(b.dataset.delRenter)));
}

/* ============ جدول الإيجارات ============ */
function renderRentsTable(filterText = "") {
  const body = document.getElementById("rentsTableBody");
  const empty = document.getElementById("rentsEmpty");
  const filtered = rentsCache.filter(r =>
    !filterText ||
    (r.renterName || "").includes(filterText) ||
    String(r.flatNumber || "").includes(filterText)
  );
  if (filtered.length === 0) {
    body.innerHTML = "";
    empty.style.display = "block";
    empty.textContent = filterText ? "لا توجد نتائج مطابقة" : "لا توجد عمليات إيجار مسجلة بعد";
    return;
  }
  empty.style.display = "none";
  body.innerHTML = filtered.map(r => `
    <tr>
      <td>${formatDate(r.dateOfPay)}</td>
      <td>${r.renterName || "—"}</td>
      <td>${r.flatNumber != null ? arDigits(r.flatNumber) : "—"}</td>
      <td>${formatMoney(r.amount)} ريال</td>
      <td>${r.months != null ? arDigits(r.months) : "—"}</td>
      <td>${formatDate(r.endOfRent)}</td>
      <td>${r.paymentWay || "—"}</td>
      <td>${r.bank || "—"}</td>
      <td class="remark-cell" ${r.remark ? `data-remark="${escapeAttr(r.remark)}" style="cursor:pointer; text-decoration:underline; text-decoration-style:dotted;"` : ""}>${r.remark ? truncate(r.remark, 22) : "—"}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-edit-rent="${r.id}" title="تعديل">${editIcon()}</button>
          <button class="icon-btn danger" data-del-rent="${r.id}" title="حذف">${trashIcon()}</button>
        </div>
      </td>
    </tr>`).join("");

  body.querySelectorAll("[data-remark]").forEach(cell => {
    cell.addEventListener("click", () => showRemarkModal(cell.dataset.remark));
  });

  body.querySelectorAll("[data-edit-rent]").forEach(b => b.addEventListener("click", () => openRentModal(b.dataset.editRent)));
  body.querySelectorAll("[data-del-rent]").forEach(b => b.addEventListener("click", () => deleteRent(b.dataset.delRent)));
}

/* ============ البحث ============ */
function setupSearch() {
  document.getElementById("rentersSearch").addEventListener("input", (e) => renderRentersTable(e.target.value.trim()));
  document.getElementById("rentsSearch").addEventListener("input", (e) => renderRentsTable(e.target.value.trim()));
}

/* ============ اختيارات نموذج الإيجار ============ */
function populateRentSelects() {
  const renterSel = document.getElementById("rentRenter");
  const flatSel = document.getElementById("rentFlat");
  renterSel.innerHTML = `<option value="" disabled selected>اختر المستأجر...</option>` +
    rentersCache.map(r => `<option value="${r.id}">${r.renterName} — ${arDigits(r.renterId)}</option>`).join("");
  flatSel.innerHTML = `<option value="" disabled selected>اختر الشقة...</option>` +
    flatsCache.map(f => `<option value="${f.id}">شقة ${arDigits(f.flatNumber)} (${f.flatFloor || ""})</option>`).join("");
}

/* ============ نوافذ الإضافة/التعديل ============ */
function setupModals() {
  document.getElementById("addFlatBtn").addEventListener("click", () => openFlatModal(null));
  document.getElementById("addRenterBtn").addEventListener("click", () => openRenterModal(null));
  document.getElementById("addRentBtn").addEventListener("click", () => openRentModal(null));

  document.getElementById("rentPaymentWay").addEventListener("change", updateBankFieldVisibility);
  document.getElementById("rentBank").addEventListener("change", updateBankOtherVisibility);

  document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });
  document.querySelectorAll(".modal-overlay").forEach(ov => {
    ov.addEventListener("click", (e) => { if (e.target === ov) closeModal(ov.id); });
  });
}
function updateBankFieldVisibility() {
  const isTransfer = document.getElementById("rentPaymentWay").value === "حواله";
  document.getElementById("rentBankField").style.display = isTransfer ? "block" : "none";
}
function updateBankOtherVisibility() {
  const other = document.getElementById("rentBankOther");
  other.style.display = document.getElementById("rentBank").value === "__other__" ? "block" : "none";
}
function getSelectedBank() {
  const sel = document.getElementById("rentBank").value;
  return sel === "__other__" ? document.getElementById("rentBankOther").value.trim() : sel;
}
function setSelectedBank(bankName) {
  const select = document.getElementById("rentBank");
  const other = document.getElementById("rentBankOther");
  const knownOptions = [...select.options].map(o => o.value);
  if (bankName && knownOptions.includes(bankName)) {
    select.value = bankName;
    other.style.display = "none";
    other.value = "";
  } else if (bankName) {
    select.value = "__other__";
    other.style.display = "block";
    other.value = bankName;
  } else {
    select.value = "";
    other.style.display = "none";
    other.value = "";
  }
}
function openModal(id) { document.getElementById(id).classList.add("show"); }
function closeModal(id) { document.getElementById(id).classList.remove("show"); }
function showRemarkModal(text) {
  document.getElementById("remarkModalText").textContent = text;
  openModal("remarkModal");
}

function openFlatModal(id) {
  const form = document.getElementById("flatForm");
  form.reset();
  document.getElementById("flatId").value = "";
  document.getElementById("flatModalTitle").textContent = id ? "تعديل شقة" : "إضافة شقة";
  if (id) {
    const f = flatsCache.find(x => x.id === id);
    document.getElementById("flatId").value = f.id;
    document.getElementById("flatFloor").value = f.flatFloor || "";
    document.getElementById("flatNumber").value = f.flatNumber ?? "";
    document.getElementById("flatRent").value = f.monthlRent ?? "";
    document.getElementById("flatMeter").value = f.meterNumber || "";
    document.getElementById("flatRented").checked = !!f.rented;
  }
  openModal("flatModal");
}

function openRenterModal(id) {
  const form = document.getElementById("renterForm");
  form.reset();
  document.getElementById("renterDocId").value = "";
  document.getElementById("renterModalTitle").textContent = id ? "تعديل مستأجر" : "إضافة مستأجر";
  if (id) {
    const r = rentersCache.find(x => x.id === id);
    document.getElementById("renterDocId").value = r.id;
    document.getElementById("renterIdNum").value = r.renterId || "";
    document.getElementById("renterName").value = r.renterName || "";
    document.getElementById("renterNationality").value = r.nationality || "";
    document.getElementById("renterMobile").value = r.mobile || "";
    document.getElementById("renterWork").value = r.workAddress || "";
  }
  openModal("renterModal");
}

function openRentModal(id) {
  const form = document.getElementById("rentForm");
  form.reset();
  document.getElementById("rentId").value = "";
  document.getElementById("rentModalTitle").textContent = id ? "تعديل دفعة" : "تسجيل دفعة إيجار";
  populateRentSelects();
  if (id) {
    const r = rentsCache.find(x => x.id === id);
    document.getElementById("rentId").value = r.id;
    const renterMatch = rentersCache.find(x => x.renterId === r.renterId);
    if (renterMatch) document.getElementById("rentRenter").value = renterMatch.id;
    const flatMatch = flatsCache.find(x => Number(x.flatNumber) === Number(r.flatNumber));
    if (flatMatch) document.getElementById("rentFlat").value = flatMatch.id;
    document.getElementById("rentDateStart").value = toDateInput(r.dateOfRent);
    document.getElementById("rentMonths").value = r.months ?? "";
    document.getElementById("rentDatePay").value = toDateInput(r.dateOfPay);
    document.getElementById("rentAmount").value = r.amount ?? "";
    document.getElementById("rentPaymentWay").value = r.paymentWay || "حواله";
    setSelectedBank(r.bank || "");
    document.getElementById("rentReason").value = r.reason || "";
    document.getElementById("rentRemark").value = r.remark || "";
  } else {
    setSelectedBank("");
  }
  updateBankFieldVisibility();
  openModal("rentModal");
}

/* ============ حفظ النماذج ============ */
function setupForms() {
  document.getElementById("flatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("flatId").value;
    const data = {
      flatFloor: document.getElementById("flatFloor").value.trim(),
      flatNumber: Number(document.getElementById("flatNumber").value),
      monthlRent: Number(document.getElementById("flatRent").value),
      meterNumber: document.getElementById("flatMeter").value.trim(),
      rented: document.getElementById("flatRented").checked,
    };
    try {
      if (id) await updateDoc(doc(db, "flats", id), data);
      else await addDoc(flatsCol, data);
      closeModal("flatModal");
      showToast("تم حفظ بيانات الشقة");
      await reloadAll();
    } catch (err) { showToast("حدث خطأ أثناء الحفظ", true); }
  });

  document.getElementById("renterForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("renterDocId").value;
    const data = {
      renterId: document.getElementById("renterIdNum").value.trim(),
      renterName: document.getElementById("renterName").value.trim(),
      nationality: document.getElementById("renterNationality").value.trim(),
      mobile: document.getElementById("renterMobile").value.trim(),
      workAddress: document.getElementById("renterWork").value.trim(),
    };
    try {
      if (id) await updateDoc(doc(db, "renters", id), data);
      else await addDoc(rentersCol, data);
      closeModal("renterModal");
      showToast("تم حفظ بيانات المستأجر");
      await reloadAll();
    } catch (err) { showToast("حدث خطأ أثناء الحفظ", true); }
  });

  document.getElementById("rentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("rentId").value;
    const renter = rentersCache.find(r => r.id === document.getElementById("rentRenter").value);
    const flat = flatsCache.find(f => f.id === document.getElementById("rentFlat").value);
    if (!renter || !flat) { showToast("اختر المستأجر والشقة", true); return; }

    const dateStart = document.getElementById("rentDateStart").value;
    const months = Number(document.getElementById("rentMonths").value);
    const endDate = addMonths(dateStart, months);

    const data = {
      renterId: renter.renterId,
      renterName: renter.renterName,
      flatNumber: Number(flat.flatNumber),
      dateOfRent: dateStart,
      dateOfPay: document.getElementById("rentDatePay").value || null,
      amount: Number(document.getElementById("rentAmount").value),
      months,
      endOfRent: endDate,
      paymentWay: document.getElementById("rentPaymentWay").value,
      bank: getSelectedBank(),
      reason: document.getElementById("rentReason").value.trim(),
      remark: document.getElementById("rentRemark").value.trim(),
    };
    try {
      if (id) await updateDoc(doc(db, "rents", id), data);
      else await addDoc(rentsCol, data);
      closeModal("rentModal");
      showToast("تم حفظ سجل الإيجار");
      await reloadAll();
    } catch (err) { showToast("حدث خطأ أثناء الحفظ", true); }
  });
}

/* ============ الحذف ============ */
async function deleteFlat(id) {
  if (!confirm("هل تريد حذف هذه الشقة؟ لن يتم حذف سجلات الإيجار المرتبطة بها.")) return;
  await deleteDoc(doc(db, "flats", id));
  showToast("تم حذف الشقة");
  await reloadAll();
}
async function deleteRenter(id) {
  if (!confirm("هل تريد حذف هذا المستأجر؟")) return;
  await deleteDoc(doc(db, "renters", id));
  showToast("تم حذف المستأجر");
  await reloadAll();
}
async function deleteRent(id) {
  if (!confirm("هل تريد حذف سجل الإيجار هذا؟")) return;
  await deleteDoc(doc(db, "rents", id));
  showToast("تم حذف السجل");
  await reloadAll();
}

/* ============ أدوات مساعدة ============ */
function arDigits(v) {
  if (v === null || v === undefined) return v;
  const map = { "0":"٠","1":"١","2":"٢","3":"٣","4":"٤","5":"٥","6":"٦","7":"٧","8":"٨","9":"٩" };
  return String(v).replace(/[0-9]/g, d => map[d]);
}
function formatMoney(n) {
  if (n === undefined || n === null || isNaN(n)) return "٠";
  return arDigits(Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }));
}
function formatDate(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date)) return "—";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return arDigits(`${day}/${month}/${year}`);
}
function toDateInput(d) {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date)) return "";
  return date.toISOString().slice(0, 10);
}
function addMonths(dateStr, months) {
  const date = new Date(dateStr);
  date.setMonth(date.getMonth() + Number(months));
  date.setDate(date.getDate() - 1); // آخر يوم في مدة العقد
  return date.toISOString().slice(0, 10);
}

let toastTimer;
function showToast(msg, isErr = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.toggle("err", isErr);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

function editIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
}
function trashIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>`;
}
function noteIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h16v12H8l-4 4V4z"/></svg>`;
}
function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
