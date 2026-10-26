// ຫຼັງບ້ານ: ພາບລວມ, ອໍເດີ, ສິນຄ້າ (Firebase Auth + Firestore realtime)
import { db, auth, configured, shopUrl } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, onSnapshot, query, orderBy, doc, addDoc, deleteDoc, updateDoc, setDoc, getDoc, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
if (shopUrl) { $("shoplink").href = shopUrl; $("shoplink").hidden = false; }
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n || 0).toLocaleString("en-US") + " ₭";
const short = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n);
const ST = { new: "ໃໝ່", confirmed: "ຢືນຢັນແລ້ວ", delivered: "ສົ່ງແລ້ວ", cancelled: "ຍົກເລີກ" };
const TITLES = { dash: "ພາບລວມ", orders: "ອໍເດີ", products: "ສິນຄ້າ", report: "ລາຍງານ", settings: "ຕັ້ງຄ່າ", stockin: "ຮັບເຄື່ອງເຂົ້າ", warranty: "ຮັບປະກັນ / Serial" };
const LOW = 5;
// ---------- ແບບ / ຕົວເລືອກ (variants): ແຕ່ລະແບບມີລາຄາ ແລະ ສະຕັອກຂອງຕົນ ----------
let vrows = [];
const vars = (p) => (Array.isArray(p.variants) ? p.variants : []);
const totalStock = (p) => (vars(p).length ? vars(p).reduce((a, v) => a + (Number(v.stock) || 0), 0) : Number(p.stock) || 0);
const skus = (inStock) => products.flatMap((p) => vars(p).length
  ? vars(p).map((v, i) => ({ key: p._id + ":" + i, p, vi: i, name: p.name + " (" + v.name + ")", price: Number(v.price) || 0, stock: Number(v.stock) || 0 }))
  : [{ key: p._id, p, vi: null, name: p.name, price: Number(p.price) || 0, stock: Number(p.stock) || 0 }]).filter((o) => !inStock || o.stock > 0);
// ຄຳນວນຄ່າທີ່ຈະ update ຫຼັງປ່ຽນສະຕັອກ: changes=[{vi,d,name,msg}] (d ລົບ = ຫັກ). strict = ຖ້າບໍ່ພໍ ໃຫ້ error
function stockUpd(x, changes, strict) {
  const vs = Array.isArray(x.variants) ? x.variants.map((v) => Object.assign({}, v)) : [];
  let stock = Number(x.stock) || 0;
  changes.forEach((c) => {
    const t = c.vi != null && vs[c.vi] ? vs[c.vi] : null;
    if (vs.length && !t) return; // ລາຍການເກົ່າທີ່ບໍ່ມີແບບ ແຕ່ສິນຄ້ານີ້ມີແບບແລ້ວ: ບໍ່ປ່ຽນ
    const left = (Number(t ? t.stock : stock) || 0) + c.d;
    if (left < 0 && strict) throw new Error(c.name + (c.msg || " ເຫຼືອບໍ່ພໍ"));
    if (t) t.stock = Math.max(0, left); else stock = Math.max(0, left);
  });
  return vs.length ? { variants: vs, stock: vs.reduce((a, v) => a + (Number(v.stock) || 0), 0) } : { stock };
}
// ປ່ຽນສະຕັອກຫຼາຍລາຍການໃນ transaction (ລວມລາຍການຂອງສິນຄ້າດຽວກັນ ແລ້ວຂຽນຄັ້ງດຽວ). sign +1 = ຄືນ, -1 = ຫັກ
async function txStock(tx, lines, sign, msg) {
  const g = {};
  lines.forEach((l) => { (g[l.ref.path] = g[l.ref.path] || { ref: l.ref, ch: [] }).ch.push({ vi: l.vi, d: sign * l.qty, name: l.name, msg }); });
  const gs = Object.values(g);
  for (const x of gs) x.sn = await tx.get(x.ref);
  gs.forEach((x) => tx.update(x.ref, stockUpd(x.sn.data() || {}, x.ch, sign < 0)));
}
let orders = [], products = [], costs = {}, settings = {}, receipts = [], unsubs = [], editing = null, imgs = [], ofil = "all";

const sw = (o) => Swal.fire(Object.assign({ target: document.querySelector("dialog[open]") || document.body, background: "var(--surf)", color: "var(--ink)", confirmButtonColor: "#1f5bff", confirmButtonText: "ຕົກລົງ" }, o));
const ask = (title, text) => sw({ icon: "warning", title, text, showCancelButton: true, confirmButtonText: "ລົບ", cancelButtonText: "ຍົກເລີກ", confirmButtonColor: "#c0332b", reverseButtons: true, focusCancel: true });
const Toast = Swal.mixin({ toast: true, position: "top-end", showConfirmButton: false, timer: 2200, timerProgressBar: true, background: "var(--surf)", color: "var(--ink)" });
const toast = (t) => Toast.fire({ icon: "success", title: t });
const fail = (e) => sw({ icon: "error", title: "ມີບັນຫາ", text: String((e && e.message) || e) });
let permBad = new Set(), permTimer = null;
const listenFail = (name) => (e) => {
  console.error(name, e);
  if (e && e.code && e.code !== "permission-denied") { fail(e); return; }
  permBad.add(name); clearTimeout(permTimer);
  permTimer = setTimeout(() => {
    const em = (auth.currentUser || {}).email || "";
    sw({ icon: "error", title: "ບໍ່ມີສິດເຂົ້າເຖິງຂໍ້ມູນ", html: "<p>ອ່ານຂໍ້ມູນເຫຼົ່ານີ້ບໍ່ໄດ້: <b>" + [...permBad].join(", ") + "</b></p><p style='text-align:left'>ກວດ 2 ຢ່າງ:<br>1) ວາງ Firestore Rules ຫຼ້າສຸດ (ໄຟລ໌ setup/firestore.rules) ແລ້ວກົດ Publish<br>2) ອີເມວໃນ Rules ຕ້ອງຕົງກັບອີເມວທີ່ເຂົ້າລະບົບ: <b>" + esc(em) + "</b></p>" });
    permBad = new Set();
  }, 400);
};
const when = (o) => o.createdAt && o.createdAt.toDate ? o.createdAt.toDate() : null;
const fdate = (d) => d ? d.toLocaleString("lo-LA", { dateStyle: "short", timeStyle: "short" }) : "ກຳລັງບັນທຶກ...";

// ---------- ກວດການເຂົ້າສູ່ລະບົບ (ຖ້າບໍ່ໄດ້ເຂົ້າ ສົ່ງໄປ login.html) ----------
if (!configured) {
  location.replace("login.html");
} else {
  onAuthStateChanged(auth, (u) => {
    unsubs.forEach((f) => f()); unsubs = [];
    if (!u) { location.replace("login.html"); return; }
    $("app").hidden = false; $("who").textContent = u.email; start(); route();
  });
}
$("logout").onclick = () => signOut(auth);

// ---------- ຮັບຂໍ້ມູນ realtime ----------
function start() {
  unsubs.push(onSnapshot(query(collection(db, "orders"), orderBy("createdAt", "desc")),
    (s) => { orders = s.docs.map((d) => Object.assign({ _id: d.id }, d.data())); drawAll(); checkNew(); }, listenFail("orders")));
  unsubs.push(onSnapshot(collection(db, "products"),
    (s) => { products = s.docs.map((d) => Object.assign({ _id: d.id }, d.data())); drawAll(); }, listenFail("products")));
  unsubs.push(onSnapshot(collection(db, "costs"), (s) => { costs = {}; s.docs.forEach((d) => { costs[d.id] = Number(d.data().cost || 0); }); drawAll(); }, listenFail("costs")));
  unsubs.push(onSnapshot(query(collection(db, "receipts"), orderBy("createdAt", "desc")), (sn) => { receipts = sn.docs.map((d) => Object.assign({ _id: d.id }, d.data())); drawAll(); }, listenFail("receipts")));
  unsubs.push(onSnapshot(doc(db, "settings", "shop"), (s) => { settings = s.exists() ? s.data() : {}; fillSettings(); }, listenFail("settings")));
}
function drawAll() { dash(); drawOrders(); drawProducts(); drawReport(); drawStockin(); drawWarranty(); if ($("odlg").open) drawOrder(); }

// ---------- ເມນູ ----------
function route() {
  const v = (location.hash || "#dash").slice(1); const view = TITLES[v] ? v : "dash";
  Object.keys(TITLES).forEach((k) => { $("v-" + k).hidden = k !== view; });
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.v === view));
  $("vt").textContent = TITLES[view]; $("addP").hidden = view !== "products"; $("addS").hidden = view === "products";
}
window.addEventListener("hashchange", route);

// ---------- ພາບລວມ ----------
const orderRow = (o, ctl) => '<article class="ord s-' + esc(o.status) + '" data-view="' + o._id + '"><div><b>' + esc(o.name) + '</b>' + (o.source === "store" ? ' <span class="badge">ໜ້າຮ້ານ</span>' : "") + payBadge(o) + '<small>' + esc(fdate(when(o))) + ' · ' + esc(o.phone ? o.phone + " · " : "") + esc(o.address) + '</small></div>' +
  '<div>' + (o.items || []).map((i) => esc(i.name) + " ×" + esc(i.qty)).join(", ") + '</div>' +
  '<div style="text-align:right"><b class="num">' + fmt(o.total) + '</b><br>' + ctl + ' <button class="ghost del" data-odel="' + o._id + '" aria-label="ລົບອໍເດີ">ລົບ</button></div></article>';
const sel = (o) => '<select class="st ' + esc(o.status) + '" data-oid="' + o._id + '" aria-label="ສະຖານະ">' + Object.keys(ST).map((k) => '<option value="' + k + '"' + (k === o.status ? " selected" : "") + ">" + ST[k] + "</option>").join("") + "</select>";
const ok = (o) => o.status !== "cancelled";
const costOf = (i) => (i.cost != null ? Number(i.cost) : Number(costs[i.pid] ?? costs[i.id] ?? 0));
const profitOf = (o) => Number(o.total || 0) - (o.items || []).reduce((a, i) => a + costOf(i) * Number(i.qty || 0), 0);

function dash() {
  const today = new Date().toDateString(), nNew = orders.filter((o) => o.status === "new").length;
  const rev = orders.filter((o) => ok(o) && when(o) && when(o).toDateString() === today).reduce((a, o) => a + Number(o.total || 0), 0);
  const low = skus(false).map((o) => ({ name: o.name, stock: o.stock })).filter((o) => o.stock < LOW).sort((a, b) => a.stock - b.stock);
  const nd = new Date();
  const prof = orders.filter((o) => { const t = when(o); return ok(o) && t && t.getMonth() === nd.getMonth() && t.getFullYear() === nd.getFullYear(); }).reduce((a, o) => a + profitOf(o), 0);
  $("stats").innerHTML = [["ລາຍຮັບວັນນີ້", fmt(rev)], ["ອໍເດີໃໝ່ (ລໍຖ້າ)", nNew], ["ອໍເດີທັງໝົດ", orders.length], ["ສິນຄ້າໃກ້ໝົດ", low.length], ["ລໍຖ້າກວດສະລິບ", orders.filter((o) => ok(o) && o.hasSlip && !o.paid).length], ["ຍອດຄ້າງຮັບເງິນ", fmt(orders.filter((o) => ok(o) && !o.paid && o.payMethod).reduce((a, o) => a + Number(o.total || 0), 0))], ["ກຳໄລເດືອນນີ້", Object.keys(costs).length ? fmt(prof) : "ຍັງບໍ່ມີລາຄາທຶນ"]]
    .map((s) => '<div class="stat"><span>' + s[0] + '</span><b class="num">' + s[1] + "</b></div>").join("");
  $("nb").hidden = !nNew; $("nb").textContent = nNew;
  // ກຣາຟ 7 ວັນ
  const days = []; for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push({ d, k: d.toDateString(), v: 0 }); }
  orders.forEach((o) => { const t = when(o); if (t && ok(o)) { const x = days.find((y) => y.k === t.toDateString()); if (x) x.v += Number(o.total || 0); } });
  const max = Math.max(1, ...days.map((x) => x.v));
  $("chart").innerHTML = '<svg viewBox="0 0 700 220" role="img" aria-label="ລາຍຮັບ 7 ວັນ">' + days.map((x, i) => {
    const h = Math.round(x.v / max * 150), X = 20 + i * 96;
    return '<rect class="col' + (i === 6 ? " t" : "") + '" x="' + X + '" y="' + (170 - h) + '" width="64" height="' + Math.max(h, 3) + '" rx="8"/>' +
      '<text x="' + (X + 32) + '" y="' + (162 - h) + '">' + (x.v ? short(x.v) : "") + '</text><text x="' + (X + 32) + '" y="200">' + x.d.getDate() + "/" + (x.d.getMonth() + 1) + "</text>";
  }).join("") + "</svg>";
  $("low").innerHTML = low.length ? low.slice(0, 6).map((p) => "<div><span>" + esc(p.name) + '</span><span class="badge ' + (p.stock < 1 ? "out" : "low") + '">' + (p.stock < 1 ? "ໝົດ" : "ເຫຼືອ " + esc(p.stock)) + "</span></div>").join("") : '<div class="muted">ສະຕັອກພໍທຸກລາຍການ</div>';
  $("recent").innerHTML = orders.slice(0, 5).map((o) => orderRow(o, sel(o))).join("") || '<div class="empty">ຍັງບໍ່ມີອໍເດີ</div>';
}

// ---------- ອໍເດີ ----------
function drawOrders() {
  const q = $("oq").value.toLowerCase().trim(), cnt = (k) => k === "all" ? orders.length : orders.filter((o) => o.status === k).length;
  $("ofil").innerHTML = [["all", "ທັງໝົດ"]].concat(Object.entries(ST)).map((x) => '<button class="chip" data-f="' + x[0] + '" aria-pressed="' + (ofil === x[0]) + '">' + x[1] + " " + cnt(x[0]) + "</button>").join("");
  const l = filteredOrders();
  $("olist").innerHTML = l.map((o) => orderRow(o, sel(o))).join("") || '<div class="empty">ບໍ່ພົບອໍເດີ</div>';
}
$("oq").oninput = drawOrders; $("odate").onchange = drawOrders;
$("ofil").onclick = (e) => { const b = e.target.closest("[data-f]"); if (b) { ofil = b.dataset.f; drawOrders(); } };
document.addEventListener("click", async (e) => {
  const d = e.target.closest("[data-odel]"); if (!d) return;
  const o = orders.find((x) => x._id === d.dataset.odel); if (!o) return;
  const canRestock = o.status !== "cancelled" && !o.restocked && stockLines(o).length > 0;
  const r = await sw({ icon: "warning", title: "ລົບອໍເດີນີ້?", text: canRestock ? "ອໍເດີນີ້ຫັກສະຕັອກໄປແລ້ວ ຕ້ອງການຄືນສະຕັອກນຳບໍ?" : "ລົບແລ້ວກູ້ຄືນບໍ່ໄດ້.",
    showCancelButton: true, showDenyButton: canRestock, confirmButtonText: canRestock ? "ລົບ ແລະ ຄືນສະຕັອກ" : "ລົບ", denyButtonText: "ລົບ ໂດຍບໍ່ຄືນສະຕັອກ",
    cancelButtonText: "ຍົກເລີກ", confirmButtonColor: "#c0332b", denyButtonColor: "#64708a" });
  if (!r.isConfirmed && !r.isDenied) return;
  try {
    if (r.isConfirmed && canRestock) await runTransaction(db, async (tx) => {
      await txStock(tx, stockLines(o), 1);
      tx.delete(doc(db, "orders", o._id));
    });
    else await deleteDoc(doc(db, "orders", o._id));
    if (o.hasSlip) deleteDoc(doc(db, "slips", o._id)).catch(() => {});
    toast("ລົບອໍເດີແລ້ວ");
  } catch (x) { fail(x); }
});
document.addEventListener("change", (e) => {
  const s = e.target.closest("select[data-oid]");
  if (s) setStatus(s.dataset.oid, s.value);
});

// ---------- ສິນຄ້າ ----------
function drawProducts() {
  const q = $("pq").value.toLowerCase().trim();
  const l = products.filter((p) => ((p.name || "") + " " + (p.brand || "") + " " + (p.category || "")).toLowerCase().includes(q));
  $("plist").innerHTML = l.map((p) => {
    const vs = vars(p), s = totalStock(p), im = (p.images || [])[0], pr = vs.length ? Math.min(...vs.map((v) => Number(v.price) || 0)) : Number(p.price), vr = vs.length > 1 && vs.some((v) => Number(v.price) !== Number(vs[0].price));
    return '<article class="pc">' + (im ? '<img src="' + esc(im) + '" alt="' + esc(p.name) + '">' : '<div class="ph">' + esc((p.brand || "?")[0]) + "</div>") +
      '<div class="pb"><b>' + esc(p.name) + '</b>' + (p.hidden ? ' <span class="badge low">ເຊື່ອງ</span>' : "") + '<span class="muted">' + esc(p.brand) + " · " + esc(p.category) + "</span>" +
      '<div class="r"><b class="num">' + (vr ? "ເລີ່ມ " : "") + fmt(pr) + '</b><span class="badge ' + (s < 1 ? "out" : s < LOW ? "low" : "") + '">' + (s < 1 ? "ໝົດ" : "ມີ " + s) + "</span></div></div>" +
      (vs.length ? vs.map((v, i) => '<div class="stk"><button class="ghost" data-stk="' + p._id + '" data-vi="' + i + '" data-d="-1" aria-label="ຫຼຸດສະຕັອກ">−</button><span>' + esc(v.name) + ' ' + (Number(v.stock) || 0) + '</span><button class="ghost" data-stk="' + p._id + '" data-vi="' + i + '" data-d="1" aria-label="ເພີ່ມສະຕັອກ">+</button></div>').join("")
        : '<div class="stk"><button class="ghost" data-stk="' + p._id + '" data-d="-1" aria-label="ຫຼຸດສະຕັອກ">−</button><span>ສະຕັອກ ' + (Number(p.stock) || 0) + '</span><button class="ghost" data-stk="' + p._id + '" data-d="1" aria-label="ເພີ່ມສະຕັອກ">+</button></div>') +
      '<div class="acts"><button class="ghost" data-edit="' + p._id + '">ແກ້ໄຂ</button><button class="ghost" data-dup="' + p._id + '">ສຳເນົາ</button><button class="ghost" data-del="' + p._id + '">ລົບ</button></div></article>';
  }).join("") || '<div class="empty">ຍັງບໍ່ມີສິນຄ້າ. ກົດ “+ ເພີ່ມສິນຄ້າ” ເພື່ອເລີ່ມ.</div>';
}
$("pq").oninput = drawProducts;
$("plist").onclick = (e) => {
  const st = e.target.closest("[data-stk]"), du = e.target.closest("[data-dup]");
  if (st) { adjustStock(st.dataset.stk, +st.dataset.d, st.dataset.vi); return; }
  if (du) { openForm(products.find((p) => p._id === du.dataset.dup), true); return; }
  const ed = e.target.closest("[data-edit]"), dl = e.target.closest("[data-del]");
  if (ed) openForm(products.find((p) => p._id === ed.dataset.edit));
  if (dl) ask("ລົບສິນຄ້ານີ້?", "ລົບແລ້ວກູ້ຄືນບໍ່ໄດ້.")
    .then((r) => { if (r.isConfirmed) deleteDoc(doc(db, "products", dl.dataset.del)).then(() => toast("ລົບສິນຄ້າແລ້ວ")).catch(fail); });
};

// ---------- ຟອມສິນຄ້າ ----------
const pd = $("pdlg");
function openForm(p, dup) {
  editing = p && !dup ? p._id : null; $("pform").reset(); imgs = p ? (p.images || []).slice() : [];
  $("ptitle").textContent = p && !dup ? "ແກ້ໄຂສິນຄ້າ" : dup ? "ສຳເນົາສິນຄ້າ" : "ເພີ່ມສິນຄ້າ";
  if (p) { $("f-name").value = p.name + (dup ? " (ສຳເນົາ)" : ""); $("f-brand").value = p.brand; $("f-cat").value = p.category; $("f-type").value = p.type || "l";
    $("f-price").value = p.price; $("f-stock").value = p.stock; $("f-cost").value = costs[p._id] ?? costs[p.id] ?? "";
    $("f-old").value = p.oldPrice || ""; $("f-hide").checked = !!p.hidden; $("f-war").value = p.warranty || ""; $("f-cond").value = p.condition || "new"; $("f-desc").value = p.description || ""; $("f-specs").value = (p.specs || []).map((s) => s.k + ": " + s.v).join("\n"); }
  vrows = p && Array.isArray(p.variants) ? p.variants.map((v) => ({ name: v.name || "", price: v.price ?? "", stock: v.stock ?? "", image: v.image || "", imageIndex: Number.isInteger(v.imageIndex) ? v.imageIndex : null })) : []; drawV();
  renderPrev(); pd.showModal();
}
$("addP").onclick = () => openForm(null);
$("pclose").onclick = $("pcancel").onclick = () => pd.close();
function shrink(file, max = 800, q = 0.8) {
  return new Promise((ok, no) => {
    const im = new Image(), u = URL.createObjectURL(file);
    im.onload = () => { const r = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement("canvas");
      c.width = Math.round(im.width * r); c.height = Math.round(im.height * r); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u); ok(c.toDataURL("image/jpeg", q)); };
    im.onerror = () => no(new Error("ອ່ານຮູບບໍ່ໄດ້")); im.src = u;
  });
}
function renderPrev() { $("prev").innerHTML = imgs.map((u, i) => '<div><img src="' + u + '" alt="ຮູບ ' + (i + 1) + '"><button type="button" data-rm="' + i + '" aria-label="ລົບຮູບ">&times;</button></div>').join(""); drawV(); }
$("f-files").onchange = async (e) => {
  try { for (const f of Array.from(e.target.files)) { if (imgs.length >= 6) break; imgs.push(await shrink(f)); } } catch (x) { fail(x); }
  e.target.value = ""; renderPrev();
};
$("prev").onclick = (e) => { const b = e.target.closest("[data-rm]"); if (b) { const i = +b.dataset.rm; imgs.splice(i, 1); vrows.forEach((v) => { if (v.imageIndex === i) v.imageIndex = null; else if (v.imageIndex > i) v.imageIndex--; }); renderPrev(); } };
function drawV() {
  $("v-rows").innerHTML = vrows.map((v, i) => '<div class="vrow"><input data-vi="' + i + '" data-k="name" value="' + esc(v.name) + '" placeholder="ຊື່ແບບ (ເຊັ່ນ ແດງ, L)" aria-label="ຊື່ແບບ"><input data-vi="' + i + '" data-k="price" type="number" min="0" value="' + esc(v.price) + '" placeholder="ລາຄາ" aria-label="ລາຄາ"><input data-vi="' + i + '" data-k="stock" type="number" min="0" value="' + esc(v.stock) + '" placeholder="ສະຕັອກ" aria-label="ສະຕັອກ"><button type="button" class="ghost" data-vrm="' + i + '" aria-label="ເອົາອອກ">&times;</button><div class="vimg" role="group" aria-label="ຮູບຂອງແບບນີ້"><span class="muted">ຮູບຂອງແບບນີ້:</span>' + (imgs.length ? imgs.map((u, k) => '<button type="button" data-vimg="' + i + '" data-k="' + k + '" aria-pressed="' + (v.imageIndex === k) + '" aria-label="ຮູບ ' + (k + 1) + '"><img src="' + u + '" alt=""></button>').join("") : '<small class="muted">ອັບໂຫຼດຮູບສິນຄ້າດ້ານລຸ່ມກ່ອນ ແລ້ວກັບມາເລືອກ</small>') + '</div></div>').join("");
  syncV();
}
function syncV() { // ມີແບບ → ຊ່ອງລາຄາ/ສະຕັອກຫຼັກຖືກຄຳນວນເອງ (ລາຄາຕ່ຳສຸດ, ສະຕັອກລວມ)
  const on = vrows.length > 0, named = vrows.filter((v) => String(v.name).trim());
  $("f-price").disabled = $("f-stock").disabled = on;
  if (on) { $("f-price").value = named.length ? Math.min(...named.map((v) => Number(v.price) || 0)) : ""; $("f-stock").value = named.reduce((a, v) => a + (Number(v.stock) || 0), 0); }
}
$("v-add").onclick = () => { vrows.push({ name: "", price: vrows.length ? "" : $("f-price").value, stock: vrows.length ? "" : $("f-stock").value }); drawV(); };
$("v-rows").oninput = (e) => { const t = e.target; if (t.dataset.vi !== undefined && vrows[+t.dataset.vi]) { vrows[+t.dataset.vi][t.dataset.k] = t.value; syncV(); } };
$("v-rows").onclick = (e) => {
  const m = e.target.closest("[data-vimg]");
  if (m) { const v = vrows[+m.dataset.vimg], k = +m.dataset.k; if (v) { v.imageIndex = v.imageIndex === k ? null : k; drawV(); } return; }
  const b = e.target.closest("[data-vrm]"); if (b) { vrows.splice(+b.dataset.vrm, 1); drawV(); }
};
$("pform").onsubmit = (e) => {
  e.preventDefault();
  if (imgs.join("").length > 800000) { sw({ icon: "warning", title: "ຮູບໃຫຍ່ເກີນ", text: "ລົບບາງຮູບອອກ ແລ້ວລອງໃໝ່" }); return; }
  const vs = vrows.map((v) => Object.assign({ name: String(v.name).trim(), price: Number(v.price) || 0, stock: Math.max(0, Number(v.stock) || 0) }, v.image ? { image: v.image } : {}, Number.isInteger(v.imageIndex) && v.imageIndex < imgs.length ? { imageIndex: v.imageIndex } : {})).filter((v) => v.name);
  if (vrows.length && !vs.length) { sw({ icon: "warning", title: "ໃສ່ຊື່ແບບຢ່າງໜ້ອຍ 1 ແບບ", text: "ຫຼື ກົດ × ເອົາແຖວແບບອອກ" }); return; }
  const specs = $("f-specs").value.split("\n").map((l) => { const i = l.indexOf(":"); return i > 0 ? { k: l.slice(0, i).trim(), v: l.slice(i + 1).trim() } : null; }).filter(Boolean);
  const data = { name: $("f-name").value.trim(), brand: $("f-brand").value.trim(), category: $("f-cat").value, type: $("f-type").value,
                 price: vs.length ? Math.min(...vs.map((v) => v.price)) : Number($("f-price").value), stock: vs.length ? vs.reduce((a, v) => a + v.stock, 0) : Number($("f-stock").value), variants: vs, specs, images: imgs, oldPrice: Number($("f-old").value) || 0, hidden: $("f-hide").checked, warranty: $("f-war").value.trim(), condition: $("f-cond").value, description: $("f-desc").value.trim() };
  const prod = editing ? products.find((x) => x._id === editing) : null, cost = Number($("f-cost").value) || 0;
  const withId = Object.assign({}, data, prod && prod.id != null ? {} : { id: Date.now() % 1000000000 }); // ສິນຄ້າທີ່ເພີ່ມເອງໃນ Console ຈະໄດ້ id ຕອນບັນທຶກ
  (editing ? updateDoc(doc(db, "products", editing), clean(withId)).then(() => editing) : addDoc(collection(db, "products"), clean(withId)).then((r) => r.id))
    .then((key) => setDoc(doc(db, "costs", String(key)), { cost }))
    .then(() => { pd.close(); toast("ບັນທຶກແລ້ວ"); }).catch(fail);
};

// ---------- ຂາຍໜ້າຮ້ານ (ຫັກສະຕັອກ + ບັນທຶກເປັນອໍເດີ "ສົ່ງແລ້ວ") ----------
const sd = $("sdlg"); let sale = [];
const saleSum = () => sale.reduce((a, l) => a + l.price * l.qty, 0);
function drawSale() {
  $("s-items").innerHTML = sale.map((l, i) => "<div><span>" + esc(l.name) + " ×" + l.qty + '</span><span class="num">' + fmt(l.price * l.qty) + '</span><button type="button" data-srm="' + i + '" aria-label="ເອົາອອກ">&times;</button></div><input class="sn" data-ssn="' + i + '" value="' + esc(l.serial || "") + '" placeholder="Serial (ຖ້າມີ)">').join("");
  $("s-total").value = saleSum() || "";
}
$("addS").onclick = () => {
  sale = []; $("sform").reset(); $("s-qty").value = 1;
  $("s-prod").innerHTML = skus(true).map((o) => '<option value="' + esc(o.key) + '">' + esc(o.name) + " — " + fmt(o.price) + " (ເຫຼືອ " + o.stock + ")</option>").join("");
  if (!$("s-prod").options.length) { sw({ icon: "info", title: "ບໍ່ມີສິນຄ້າໃນສະຕັອກ" }); return; }
  drawSale(); sd.showModal();
};
$("s-add").onclick = () => {
  const o = skus(true).find((x) => x.key === $("s-prod").value), q = Math.max(1, parseInt($("s-qty").value, 10) || 1);
  if (!o) return;
  const l = sale.find((x) => x.key === o.key), have = l ? l.qty : 0;
  if (have + q > o.stock) { sw({ icon: "warning", title: "ສະຕັອກບໍ່ພໍ", text: o.name + " ເຫຼືອ " + o.stock + " ຊິ້ນ" }); return; }
  if (l) l.qty += q; else sale.push({ key: o.key, doc: o.p._id, vi: o.vi, id: o.p.id != null ? o.p.id : o.p._id, name: o.name, price: o.price, qty: q });
  drawSale();
};
$("s-items").onclick = (e) => { const b = e.target.closest("[data-srm]"); if (b) { sale.splice(+b.dataset.srm, 1); drawSale(); } };
$("s-items").oninput = (e) => { const t = e.target.closest("[data-ssn]"); if (t && sale[+t.dataset.ssn]) sale[+t.dataset.ssn].serial = t.value; };
$("sclose").onclick = $("scancel").onclick = () => sd.close();
$("sform").onsubmit = (e) => {
  e.preventDefault();
  if (!sale.length) { sw({ icon: "warning", title: "ຍັງບໍ່ໄດ້ເພີ່ມລາຍການ" }); return; }
  const lines = sale.slice(), total = Number($("s-total").value) || saleSum(), name = $("s-name").value.trim() || "ລູກຄ້າໜ້າຮ້ານ", phone = $("s-phone").value.trim(), payment = $("s-pay").value;
  const oref = doc(collection(db, "orders")), sitems = lines.map((l) => ({ id: l.id, pid: l.doc, vi: l.vi, name: l.name, qty: l.qty, price: l.price, cost: Number(costs[l.doc] ?? costs[l.id] ?? 0), serial: (l.serial || "").trim(), war: (products.find((p) => p._id === l.doc) || {}).warranty || "" }));
  runTransaction(db, async (tx) => {
    await txStock(tx, lines.map((l) => ({ ref: doc(db, "products", l.doc), vi: l.vi, qty: l.qty, name: l.name })), -1);
    tx.set(oref, clean({ name, phone, payment, address: "ຂາຍໜ້າຮ້ານ", source: "store", status: "delivered", paid: true, total,
      items: sitems, createdAt: serverTimestamp() }));
  }).then(() => { sd.close(); return sw({ icon: "success", title: "ບັນທຶກການຂາຍແລ້ວ", text: "ສະຕັອກຖືກຫັກແລ້ວ", showCancelButton: true, confirmButtonText: "ພິມໃບເສັດ", cancelButtonText: "ປິດ" }); })
    .then((r) => { if (r && r.isConfirmed) printReceipt({ _id: oref.id, name, phone, payment, total, items: sitems, _t: new Date() }); }).catch(fail);
};

// ---------- ລາຍງານຍອດຂາຍລາຍເດືອນ + ບັນທຶກລົງ Google Sheets (ຜ່ານ Apps Script) ----------
const MN = ["ມັງກອນ","ກຸມພາ","ມີນາ","ເມສາ","ພຶດສະພາ","ມິຖຸນາ","ກໍລະກົດ","ສິງຫາ","ກັນຍາ","ຕຸລາ","ພະຈິກ","ທັນວາ"];
const mlabel = (k) => MN[+k.slice(5) - 1] + " " + k.slice(0, 4);
const lget = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const lset = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
let saved = {}; try { saved = JSON.parse(lget("gs_saved") || "{}"); } catch (e) {}

function months() {
  const m = {};
  orders.forEach((o) => {
    const t = when(o); if (!t || !ok(o)) return;
    const k = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0");
    const r = m[k] || (m[k] = { month: k, orders: 0, web: 0, store: 0, revenue: 0, profit: 0, items: {} });
    r.orders++; if (o.source === "store") r.store++; else r.web++;
    r.revenue += Number(o.total || 0); r.profit += profitOf(o);
    (o.items || []).forEach((i) => { r.items[i.name] = (r.items[i.name] || 0) + Number(i.qty || 0); });
  });
  return Object.values(m).sort((a, b) => (a.month < b.month ? 1 : -1)).map((r) => {
    const e = Object.entries(r.items).sort((a, b) => b[1] - a[1])[0];
    r.top = e ? e[0] + " ×" + e[1] : ""; delete r.items; return r;
  });
}
function drawReport() {
  $("rlist").innerHTML = months().map((r) => {
    const s = saved[r.month];
    const b = s ? (s.rev === r.revenue && s.n === r.orders ? '<span class="badge">ບັນທຶກແລ້ວ ✓</span>' : '<span class="badge low">ມີການປ່ຽນແປງ ຄວນບັນທຶກຄືນ</span>') : "";
    return '<article class="ord s-delivered"><div><b>' + mlabel(r.month) + "</b> " + b + "<small>" + r.orders + " ອໍເດີ</small></div>" +
      "<div>ອອນລາຍ " + r.web + " · ໜ້າຮ້ານ " + r.store + "<small>ຂາຍດີ: " + esc(r.top || "-") + "</small></div>" +
      '<div style="text-align:right"><b class="num">' + fmt(r.revenue) + '</b><small>ກຳໄລ ' + fmt(r.profit) + '</small><button class="ghost" data-save="' + r.month + '">ບັນທຶກລົງ Sheets</button></div></article>';
  }).join("") || '<div class="empty">ຍັງບໍ່ມີຍອດຂາຍ</div>';
}
async function setupSheets() {
  const r = await sw({ title: "ຕັ້ງຄ່າ Google Sheets", showCancelButton: true, confirmButtonText: "ບັນທຶກ", cancelButtonText: "ຍົກເລີກ",
    html: '<input id="gs1" class="swal2-input" placeholder="Web App URL (https://script.google.com/.../exec)"><input id="gs2" class="swal2-input" placeholder="ລະຫັດລັບ (SECRET ໃນ Apps Script)">',
    didOpen: () => { $("gs1").value = lget("gs_url"); $("gs2").value = lget("gs_token"); },
    preConfirm: () => {
      const u = $("gs1").value.trim(), t = $("gs2").value.trim();
      if (!/^https:\/\/script\.google\.com\//.test(u)) { Swal.showValidationMessage("URL ຕ້ອງຂຶ້ນຕົ້ນດ້ວຍ https://script.google.com/"); return false; }
      return { u, t };
    } });
  if (r.isConfirmed) { lset("gs_url", r.value.u); lset("gs_token", r.value.t); toast("ບັນທຶກການຕັ້ງຄ່າແລ້ວ"); return true; }
  return false;
}
async function sendSheets(rows) {
  if (!rows.length) { sw({ icon: "info", title: "ຍັງບໍ່ມີຍອດຂາຍໃຫ້ບັນທຶກ" }); return; }
  if (!lget("gs_url") && !(await setupSheets())) return;
  sw({ title: "ກຳລັງບັນທຶກລົງ Google Sheets...", allowOutsideClick: false, showConfirmButton: false, didOpen: () => Swal.showLoading() });
  try {
    const res = await fetch(lget("gs_url"), { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ token: lget("gs_token"), rows }) });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || "ບັນທຶກບໍ່ສຳເລັດ");
    rows.forEach((r) => { saved[r.month] = { rev: r.revenue, n: r.orders, at: Date.now() }; });
    lset("gs_saved", JSON.stringify(saved)); if (j.url) lset("gs_sheet", j.url);
    drawReport();
    const go = await sw({ icon: "success", title: "ບັນທຶກລົງ Google Sheets ແລ້ວ", text: rows.length + " ເດືອນ", showCancelButton: !!lget("gs_sheet"), confirmButtonText: lget("gs_sheet") ? "ເປີດ Google Sheet" : "ຕົກລົງ", cancelButtonText: "ປິດ" });
    if (go.isConfirmed && lget("gs_sheet")) window.open(lget("gs_sheet"), "_blank", "noopener");
  } catch (e) {
    sw({ icon: "error", title: "ບັນທຶກບໍ່ສຳເລັດ", text: String(e.message || e) + " (ກວດ URL, ລະຫັດລັບ ແລະ ວ່າ Deploy ເປັນ “Anyone” ແລ້ວ)" });
  }
}
$("gset").onclick = setupSheets;
$("gall").onclick = () => sendSheets(months());
$("rlist").onclick = (e) => { const b = e.target.closest("[data-save]"); if (b) sendSheets(months().filter((r) => r.month === b.dataset.save)); };

// ---------- ສະຖານະ + ລາຍລະອຽດອໍເດີ + ພິມໃບເສັດ + ຕັ້ງຄ່າຮ້ານ ----------
const PAY = { "": "ຍັງບໍ່ລະບຸ", cash: "ເງິນສົດ", transfer: "ໂອນ / QR", other: "ອື່ນໆ" };
const normPhone = (v) => { const d = String(v || "").replace(/\D/g, ""); return !d ? "" : d.indexOf("856") === 0 ? d : "856" + d.replace(/^0+/, ""); };
const phoneOf = (o) => o.phone || ((String(o.name || "").match(/\d[\d\s-]{6,}\d/) || [""])[0]);
function stockLines(o) {
  return (o.items || []).map((i) => { const p = products.find((x) => x._id === i.pid) || products.find((x) => x.id == i.id); return p ? { ref: doc(db, "products", p._id), qty: Number(i.qty || 0), name: i.name, vi: i.vi } : null; }).filter(Boolean);
}
async function setStatus(id, status) {
  const o = orders.find((x) => x._id === id); if (!o) return;
  const p = { status };
  if ((status === "confirmed" || status === "delivered") && (o.items || []).some((i) => i.cost == null))
    p.items = o.items.map((i) => Object.assign({}, i, { cost: i.cost != null ? i.cost : Number(costs[i.pid] ?? costs[i.id] ?? 0) }));
  const toCancel = status === "cancelled" && o.status !== "cancelled" && !o.restocked;
  const fromCancel = status !== "cancelled" && o.status === "cancelled" && o.restocked;
  try {
    if (!toCancel && !fromCancel) await updateDoc(doc(db, "orders", id), p);
    else await runTransaction(db, async (tx) => {
      await txStock(tx, stockLines(o), toCancel ? 1 : -1, " ສະຕັອກບໍ່ພໍ ຈຶ່ງເປີດອໍເດີຄືນບໍ່ໄດ້");
      tx.update(doc(db, "orders", id), Object.assign({}, p, { restocked: toCancel }));
    });
    toast(toCancel ? "ຍົກເລີກ ແລະ ຄືນສະຕັອກແລ້ວ" : "ອັບເດດສະຖານະແລ້ວ");
    if (status === "delivered" && !o.paid && o.payMethod === "cash") { // ເກັບເງິນປາຍທາງ: ຖາມວ່າຮັບເງິນແລ້ວບໍ
      const r = await sw({ icon: "question", title: "ຮັບເງິນສົດແລ້ວບໍ?", text: "ອໍເດີນີ້ເລືອກຈ່າຍເງິນສົດ. ຖ້າຮັບເງິນແລ້ວ ກົດ “ຮັບເງິນແລ້ວ” ເພື່ອໝາຍວ່າຊຳລະແລ້ວ.", showCancelButton: true, confirmButtonText: "ຮັບເງິນແລ້ວ", cancelButtonText: "ຍັງບໍ່ໄດ້ຮັບ" });
      if (r.isConfirmed) await updateDoc(doc(db, "orders", id), { paid: true, paidAt: serverTimestamp(), payment: "cash" });
    }
  } catch (e) { fail(e); drawAll(); }
}
let viewing = null; const od = $("odlg");
function waMsg(o) {
  const T = { new: "ຮ້ານ DN Game Vault ໄດ້ຮັບອໍເດີຂອງທ່ານແລ້ວ ຈະຕິດຕໍ່ຢືນຢັນອີກຄັ້ງ.", confirmed: "ອໍເດີຂອງທ່ານຢືນຢັນແລ້ວ ກະລຸນາຊຳລະເງິນ ຫຼື ນັດມາຮັບສິນຄ້າທີ່ຮ້ານ.",
    delivered: "ຂອບໃຈທີ່ອຸດໜູນຮ້ານ DN Game Vault. ຫາກມີບັນຫາການໃຊ້ງານ ຕິດຕໍ່ຮ້ານໄດ້ທຸກເວລາ (ຮັບປະກັນຕາມໃບເສັດ).", cancelled: "ຂໍແຈ້ງວ່າອໍເດີຂອງທ່ານຖືກຍົກເລີກແລ້ວ ຂໍອະໄພໃນຄວາມບໍ່ສະດວກ." };
  return "ສະບາຍດີ ຄຸນ " + (o.name || "") + "\n" + (T[o.status] || "") + "\n\nລາຍການ:\n" + (o.items || []).map((i) => "- " + i.name + " ×" + i.qty).join("\n") + "\nລວມ: " + fmt(o.total);
}
function openOrder(id) { viewing = id; drawOrder(); od.showModal(); }
function drawOrder() {
  const o = orders.find((x) => x._id === viewing); if (!o) { if (od.open) od.close(); return; }
  const hasCost = Object.keys(costs).length > 0 || (o.items || []).some((i) => i.cost != null);
  $("o-title").textContent = "ອໍເດີ #" + o._id.slice(-6).toUpperCase();
  const kv = (k, v) => '<div class="kv"><span>' + k + "</span><b>" + v + "</b></div>";
  $("obody").innerHTML = kv("ລູກຄ້າ", esc(o.name)) + kv("ເບີໂທ", esc(phoneOf(o) || "—")) + kv("ທີ່ຢູ່", esc(o.address)) + kv("ເວລາ", esc(fdate(when(o)))) + kv("ຊ່ອງທາງ", o.source === "store" ? "ໜ້າຮ້ານ" : "ອອນລາຍ") +
    "<h4>ລາຍການ</h4>" + (o.items || []).map((i, k) => kv(esc(i.name) + " ×" + esc(i.qty), fmt(i.price * i.qty)) + '<input class="sn" data-sn="' + k + '" value="' + esc(i.serial || "") + '" placeholder="Serial (ຫຼາຍເຄື່ອງ ຂັ້ນດ້ວຍ ,)">' + (warText(i) ? '<small class="muted">ຮັບປະກັນ ' + esc(warText(i)) + "</small>" : "")).join("") +
    '<div class="tot2"><span>ລວມ</span><b class="num">' + fmt(o.total) + "</b></div>" + (hasCost ? kv("ກຳໄລ (ເຫັນສະເພາະ admin)", fmt(profitOf(o))) : "") +
    "<h4>ການຊຳລະ</h4>" + kv("ວິທີທີ່ລູກຄ້າເລືອກ", PAYM[o.payMethod] || "ບໍ່ລະບຸ") + kv("ສະຖານະ", o.paid ? "ຊຳລະແລ້ວ" : o.hasSlip ? "ລໍຖ້າກວດສະລິບ" : o.payMethod === "cash" ? "ຍັງບໍ່ໄດ້ເກັບເງິນ (ເກັບປາຍທາງ / ທີ່ຮ້ານ)" : "ຍັງບໍ່ໄດ້ຮັບເງິນ") +
    (o.hasSlip ? '<div id="o-slip" class="slipbox muted">ກຳລັງໂຫຼດສະລິບ...</div>' : "") +
    '<div class="oact">' + (o.paid ? '<button class="ghost" id="o-unpaid">ຍົກເລີກການຢືນຢັນຮັບເງິນ</button>' : '<button class="btn" id="o-paid">ຢືນຢັນຮັບເງິນແລ້ວ</button>') + "</div>" +
    '<label>ສະຖານະ<select id="o-st" class="st ' + esc(o.status) + '">' + Object.keys(ST).map((k) => '<option value="' + k + '"' + (k === o.status ? " selected" : "") + ">" + ST[k] + "</option>").join("") + "</select></label>" +
    '<label>ວິທີຊຳລະ<select id="o-pay">' + Object.keys(PAY).map((k) => '<option value="' + k + '"' + (k === (o.payment || "") ? " selected" : "") + ">" + PAY[k] + "</option>").join("") + "</select></label>" +
    '<div class="oact"><button class="btn" id="o-wa">ທັກລູກຄ້າທາງ WhatsApp</button><button class="ghost" id="o-pr">ພິມໃບເສັດ</button></div>';
  if (o.hasSlip) loadSlip();
}
od.onchange = (e) => {
  if (e.target.dataset.sn !== undefined) {
    const o = orders.find((x) => x._id === viewing), k = +e.target.dataset.sn; if (!o) return;
    const items = (o.items || []).map((i, n) => (n === k ? Object.assign({}, i, { serial: e.target.value.trim() }) : i));
    updateDoc(doc(db, "orders", viewing), { items: clean(items) }).then(() => toast("ບັນທຶກ Serial ແລ້ວ")).catch(fail); return;
  }
  if (e.target.id === "o-st") setStatus(viewing, e.target.value);
  if (e.target.id === "o-pay") updateDoc(doc(db, "orders", viewing), { payment: e.target.value }).then(() => toast("ບັນທຶກວິທີຊຳລະແລ້ວ")).catch(fail);
};
od.onclick = (e) => {
  const o = orders.find((x) => x._id === viewing); if (!o) return;
  if (e.target.id === "o-wa") {
    const n = normPhone(phoneOf(o));
    if (!n) { sw({ icon: "info", title: "ອໍເດີນີ້ບໍ່ມີເບີໂທ" }); return; }
    window.open("https://wa.me/" + n + "?text=" + encodeURIComponent(waMsg(o)), "_blank", "noopener");
  }
  if (e.target.id === "o-pr") printReceipt(o);
  if (e.target.id === "o-paid") updateDoc(doc(db, "orders", o._id), { paid: true, paidAt: serverTimestamp(), payment: o.payMethod === "cash" ? "cash" : o.payMethod === "transfer" ? "transfer" : (o.payment || "") }).then(() => toast("ຢືນຢັນຮັບເງິນແລ້ວ")).catch(fail);
  if (e.target.id === "o-unpaid") updateDoc(doc(db, "orders", o._id), { paid: false }).then(() => toast("ຍົກເລີກການຢືນຢັນແລ້ວ")).catch(fail);
  if (e.target.classList.contains("slipimg")) sw({ imageUrl: e.target.src, imageAlt: "ສະລິບ", showConfirmButton: false, showCloseButton: true, width: 520 });
};
$("oclose").onclick = () => od.close();
od.addEventListener("click", (e) => { if (e.target === od) od.close(); });
document.addEventListener("click", (e) => {
  const a = e.target.closest(".ord[data-view]");
  if (a && !e.target.closest("select,button,a")) openOrder(a.dataset.view);
});

const logoUrl = () => { try { return new URL("assets/img/logo-receipt.png", location.href).href; } catch (e) { return "assets/img/logo-receipt.png"; } };
function printReceipt(o) {
  const s = settings || {}, no = String(o._id || "").slice(-6).toUpperCase(), t = when(o) || o._t || new Date();
  const rows = (o.items || []).map((i) => "<tr><td>" + esc(i.name) + "<br><small>" + fmt(i.price) + " × " + esc(i.qty) + '</small>' + (i.serial ? "<br><small>S/N: " + esc(i.serial) + "</small>" : "") + (warText(i) ? "<br><small>ຮັບປະກັນ " + esc(warText(i)) + "</small>" : "") + '</td><td class="r">' + fmt(i.price * i.qty) + "</td></tr>").join("");
  const html = '<!DOCTYPE html><html lang="lo"><head><meta charset="utf-8"><title>ໃບເສັດ ' + no + '</title><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Lao:wght@400;700&display=swap" rel="stylesheet"><style>@page{size:80mm auto;margin:4mm}body{font:13px/1.5 "Noto Sans Lao",sans-serif;width:72mm;margin:0 auto;color:#000}h1{font-size:18px;text-align:center;margin:0}p{margin:2px 0}.c{text-align:center}table{width:100%;border-collapse:collapse;margin:8px 0}td{padding:4px 0;border-bottom:1px dashed #888;vertical-align:top}.r{text-align:right;white-space:nowrap}.t{font-size:16px;font-weight:700;display:flex;justify-content:space-between}small{color:#444}.lg{display:block;margin:0 auto 4px;width:24mm;height:24mm}</style></head><body>' +
    '<img class="lg" src="' + logoUrl() + '" alt="" onerror="this.style.display=\'none\'"><h1>DN Game Vault</h1>' + (s.address ? '<p class="c">' + esc(s.address) + "</p>" : "") + (s.whatsapp ? '<p class="c">WhatsApp: ' + esc(s.whatsapp) + "</p>" : "") +
    '<p class="c">────────────────</p><p>ເລກທີ: ' + no + "</p><p>ວັນທີ: " + esc(fdate(t)) + "</p><p>ລູກຄ້າ: " + esc(o.name) + (o.phone ? " (" + esc(o.phone) + ")" : "") + "</p>" +
    "<table>" + rows + '</table><div class="t"><span>ລວມ</span><span>' + fmt(o.total) + "</span></div><p>ຊຳລະ: " + esc(PAY[o.payment || ""]) + '</p><p class="c">────────────────</p><p class="c">' + esc(s.note || "ຂອບໃຈທີ່ອຸດໜູນ") + "</p></body></html>";
  const f = document.createElement("iframe"); f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  f.onload = () => setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (x) { fail(x); } setTimeout(() => f.remove(), 3000); }, 700);
  f.srcdoc = html;
}

function fillSettings() {
  if ($("setform").contains(document.activeElement)) return;
  $("st-wa").value = settings.whatsapp || ""; $("st-addr").value = settings.address || ""; $("st-hours").value = settings.hours || "";
  qrData = settings.qrImage || ""; drawQr();
  $("st-fb").value = settings.facebook || ""; $("st-note").value = settings.note || ""; $("st-map").value = settings.map || ""; $("st-pay").value = settings.payinfo || ""; $("st-ship").value = settings.shipinfo || "";
}
$("setform").onsubmit = (e) => {
  e.preventDefault();
  const data = { whatsapp: normPhone($("st-wa").value), address: $("st-addr").value.trim(), hours: $("st-hours").value.trim(), facebook: $("st-fb").value.trim(), note: $("st-note").value.trim(), map: $("st-map").value.trim(), payinfo: $("st-pay").value.trim(), shipinfo: $("st-ship").value.trim(), qrImage: qrData };
  if (data.map && !/^https?:\/\//.test(data.map)) { sw({ icon: "warning", title: "ລິ້ງແຜນທີ່ຕ້ອງຂຶ້ນຕົ້ນດ້ວຍ https://" }); return; }
  if (data.facebook && !/^https:\/\//.test(data.facebook)) { sw({ icon: "warning", title: "ລິ້ງ Facebook ຕ້ອງຂຶ້ນຕົ້ນດ້ວຍ https://" }); return; }
  setDoc(doc(db, "settings", "shop"), data).then(() => toast("ບັນທຶກການຕັ້ງຄ່າແລ້ວ")).catch(fail);
};

const clean = (v) => Array.isArray(v) ? v.map(clean) : (v && Object.getPrototypeOf(v) === Object.prototype) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, clean(x)])) : v; // Firestore ບໍ່ຮັບຄ່າ undefined

// ---------- ກອງວັນທີ, ສົ່ງອອກ CSV, ແກ້ສະຕັອກໄວ, ສຽງແຈ້ງເຕືອນອໍເດີໃໝ່ ----------
function dateOk(o) {
  const m = $("odate").value; if (m === "all") return true;
  const t = when(o); if (!t) return false; const n = new Date();
  if (m === "today") return t.toDateString() === n.toDateString();
  if (m === "week") return n - t < 7 * 864e5;
  return t.getMonth() === n.getMonth() && t.getFullYear() === n.getFullYear();
}
function filteredOrders() {
  const q = $("oq").value.toLowerCase().trim();
  return orders.filter((o) => (ofil === "all" || o.status === ofil) && dateOk(o) && ($("opay").value === "all" || payState(o) === $("opay").value) && ((o.name || "") + " " + (o.phone || "") + " " + (o.address || "")).toLowerCase().includes(q));
}
function csv(rows) { return "\ufeff" + rows.map((r) => r.map((c) => { const v = String(c == null ? "" : c); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",")).join("\r\n"); }
function download(name, text) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const today10 = () => new Date().toISOString().slice(0, 10);
$("oexp").onclick = () => {
  const l = filteredOrders(); if (!l.length) { sw({ icon: "info", title: "ບໍ່ມີອໍເດີໃຫ້ສົ່ງອອກ" }); return; }
  download("orders-" + today10() + ".csv", csv([["ເລກທີ", "ວັນທີ", "ລູກຄ້າ", "ເບີໂທ", "ທີ່ຢູ່", "ຊ່ອງທາງ", "ສະຖານະ", "ວິທີຊຳລະ", "ລາຍການ", "ລວມ (ກີບ)", "ກຳໄລ (ກີບ)"]]
    .concat(l.map((o) => [o._id.slice(-6).toUpperCase(), fdate(when(o)), o.name, phoneOf(o), o.address, o.source === "store" ? "ໜ້າຮ້ານ" : "ອອນລາຍ", ST[o.status] || o.status, PAY[o.payment || ""], (o.items || []).map((i) => i.name + " x" + i.qty).join("; "), o.total, profitOf(o)]))));
};
$("pexp").onclick = () => {
  if (!products.length) { sw({ icon: "info", title: "ຍັງບໍ່ມີສິນຄ້າ" }); return; }
  download("products-" + today10() + ".csv", csv([["ຊື່", "ຍີ່ຫໍ້", "ໝວດ", "ລາຄາຂາຍ (ກີບ)", "ລາຄາເກົ່າ", "ລາຄາທຶນ (ກີບ)", "ສະຕັອກ", "ຮັບປະກັນ", "ສະພາບ", "ເຊື່ອງ", "ແບບ (ຊື່:ລາຄາ/ສະຕັອກ)"]]
    .concat(products.map((p) => [p.name, p.brand, p.category, p.price, p.oldPrice || "", costs[p._id] ?? costs[p.id] ?? "", p.stock, p.warranty || "", p.condition || "new", p.hidden ? "ເຊື່ອງ" : "", vars(p).map((v) => v.name + ":" + v.price + "/" + v.stock).join("; ")]))));
};
function adjustStock(id, d, vi) {
  return runTransaction(db, async (tx) => {
    const r = doc(db, "products", id), sn = await tx.get(r);
    tx.update(r, stockUpd(sn.data() || {}, [{ vi: vi === undefined || vi === "" ? null : +vi, d }], false));
  }).catch(fail);
}
let known = null, audio = null;
function beep() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume();
    const o = audio.createOscillator(), g = audio.createGain(); o.connect(g); g.connect(audio.destination); o.type = "sine"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.6); o.start(); o.stop(audio.currentTime + 0.6);
  } catch (e) {}
}
function checkNew() {
  const cur = new Set(orders.filter((o) => o.status === "new").map((o) => o._id));
  if (known) { const n = orders.filter((o) => o.status === "new" && !known.has(o._id)).length; if (n) { toast("ມີອໍເດີໃໝ່ " + n + " ລາຍການ"); if ($("snd").checked) beep(); } }
  known = cur; document.title = (cur.size ? "(" + cur.size + ") " : "") + "ຫຼັງບ້ານ – DN Game Vault";
}
$("snd").checked = lget("snd") !== "0"; $("snd").onchange = () => { lset("snd", $("snd").checked ? "1" : "0"); if ($("snd").checked) beep(); };

// ================= ຮັບເຄື່ອງເຂົ້າ + ຮັບປະກັນ/Serial =================
function warText(i) { const p = products.find((x) => x._id === i.pid) || products.find((x) => x.id == i.id); return i.war != null && i.war !== "" ? i.war : (p && p.warranty) || ""; }

// ---------- 5) ຮັບເຄື່ອງເຂົ້າ ----------
let rlines = [];
function drawStockin() {
  const keep = $("r-prod").value;
  $("r-prod").innerHTML = skus(false).map((o) => '<option value="' + esc(o.key) + '">' + esc(o.name) + " (ສະຕັອກ " + o.stock + ")</option>").join("");
  if (keep && skus(false).some((o) => o.key === keep)) $("r-prod").value = keep;
  $("r-items").innerHTML = rlines.map((l, i) => "<div><span>" + esc(l.name) + " ×" + l.qty + " @ " + fmt(l.cost) + '</span><span class="num">' + fmt(l.qty * l.cost) + '</span><button type="button" data-rrm="' + i + '" aria-label="ເອົາອອກ">&times;</button></div>').join("");
  $("r-total").textContent = fmt(rlines.reduce((a, l) => a + l.qty * l.cost, 0));
  $("hlist").innerHTML = receipts.map((r) => '<article class="ord s-delivered"><div><b>' + esc(r.supplier || "ບໍ່ລະບຸຊັບພາຍເອີ") + "</b><small>" + esc(fdate(when(r))) + (r.note ? " · " + esc(r.note) : "") + "</small></div><div>" +
    (r.items || []).map((i) => esc(i.name) + " ×" + esc(i.qty)).join(", ") + '</div><div style="text-align:right"><b class="num">' + fmt(r.total) + "</b></div></article>").join("") || '<div class="empty">ຍັງບໍ່ມີປະຫວັດຮັບເຄື່ອງ</div>';
}
$("r-prod").onchange = () => { const o = skus(false).find((x) => x.key === $("r-prod").value), p = o && o.p; $("r-cost").value = p ? (costs[p._id] ?? costs[p.id] ?? "") : ""; };
$("r-add").onclick = () => {
  const o = skus(false).find((x) => x.key === $("r-prod").value), p = o && o.p, qty = Math.max(1, parseInt($("r-qty").value, 10) || 1), cost = Number($("r-cost").value);
  if (!p) { sw({ icon: "info", title: "ຍັງບໍ່ມີສິນຄ້າ ໃຫ້ເພີ່ມສິນຄ້າກ່ອນ" }); return; }
  if ($("r-cost").value === "" || !(cost >= 0)) { sw({ icon: "warning", title: "ກະລຸນາໃສ່ລາຄາທຶນຕໍ່ຊິ້ນ" }); return; }
  const l = rlines.find((x) => x.key === o.key);
  if (l) { l.cost = Math.round((l.cost * l.qty + cost * qty) / (l.qty + qty)); l.qty += qty; } else rlines.push({ key: o.key, doc: p._id, vi: o.vi, id: p.id != null ? p.id : p._id, name: o.name, qty, cost });
  $("r-qty").value = 1; drawStockin();
};
$("r-items").onclick = (e) => { const b = e.target.closest("[data-rrm]"); if (b) { rlines.splice(+b.dataset.rrm, 1); drawStockin(); } };
$("rform").onsubmit = (e) => {
  e.preventDefault();
  if (!rlines.length) { sw({ icon: "warning", title: "ຍັງບໍ່ໄດ້ເພີ່ມລາຍການ" }); return; }
  const lines = rlines.slice(), supplier = $("r-sup").value.trim(), note = $("r-note").value.trim(), total = lines.reduce((a, l) => a + l.qty * l.cost, 0);
  runTransaction(db, async (tx) => {
    const gs = {};
    lines.forEach((l) => { (gs[l.doc] = gs[l.doc] || { ref: doc(db, "products", l.doc), id: l.id, doc: l.doc, ls: [] }).ls.push(l); });
    const G = Object.values(gs);
    for (const g of G) g.sn = await tx.get(g.ref);
    G.forEach((g) => {
      const x = g.sn.data() || {}, stock = totalStock(x), old = costs[g.doc] ?? costs[g.id];
      const addQ = g.ls.reduce((a, l) => a + l.qty, 0), addC = g.ls.reduce((a, l) => a + l.qty * l.cost, 0);
      const avg = stock > 0 && old != null ? Math.round((stock * Number(old) + addC) / (stock + addQ)) : Math.round(addC / addQ);
      tx.update(g.ref, stockUpd(x, g.ls.map((l) => ({ vi: l.vi, d: l.qty })), false)); tx.set(doc(db, "costs", g.doc), { cost: avg });
    });
    tx.set(doc(collection(db, "receipts")), clean({ supplier, note, total, items: lines.map((l) => ({ id: l.id, pid: l.doc, vi: l.vi, name: l.name, qty: l.qty, cost: l.cost })), createdAt: serverTimestamp() }));
  }).then(() => { rlines = []; $("rform").reset(); drawStockin(); toast("ບັນທຶກຮັບເຄື່ອງ ແລະ ເພີ່ມສະຕັອກແລ້ວ"); }).catch(fail);
};

// ---------- 6) ຮັບປະກັນ / Serial ----------
const warMonths = (t) => { const s = String(t || ""); if (/ຕະຫຼອດຊີບ/.test(s)) return Infinity; const n = parseInt(s.replace(/[^\d]/g, ""), 10); return !n ? 0 : /ປີ/.test(s) ? n * 12 : n; };
const addMonths = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
let wfil = "all";
function warRows() {
  const rows = [], now = new Date();
  orders.forEach((o) => {
    const t = when(o); if (!ok(o) || !t) return;
    (o.items || []).forEach((i) => {
      const w = warMonths(warText(i)), end = w === Infinity || !w ? null : addMonths(t, w);
      const state = w === Infinity ? "in" : !w ? "none" : end >= now ? "in" : "out";
      rows.push({ o, i, t, w, end, state, left: end ? Math.ceil((end - now) / 864e5) : null });
    });
  });
  return rows;
}
function drawWarranty() {
  const rows = warRows(), q = $("wq").value.toLowerCase().trim(), qd = q.replace(/\D/g, "");
  const cnt = (k) => (k === "all" ? rows.length : rows.filter((r) => r.state === k).length);
  $("wfil").innerHTML = [["all", "ທັງໝົດ"], ["in", "ຢູ່ໃນປະກັນ"], ["out", "ໝົດປະກັນ"]].map((x) => '<button class="chip" data-wf="' + x[0] + '" aria-pressed="' + (wfil === x[0]) + '">' + x[1] + " " + cnt(x[0]) + "</button>").join("");
  const l = rows.filter((r) => (wfil === "all" || r.state === wfil) && (!q || ((r.i.name || "") + " " + (r.i.serial || "") + " " + (r.o.name || "")).toLowerCase().includes(q) || (qd.length >= 4 && phoneOf(r.o).replace(/\D/g, "").includes(qd)))).slice(0, 150);
  $("wlist").innerHTML = l.map((r) => {
    const b = r.w === Infinity ? '<span class="badge">ຕະຫຼອດຊີບ</span>' : r.state === "none" ? '<span class="badge low">ບໍ່ມີຂໍ້ມູນຮັບປະກັນ</span>' : r.state === "in" ? '<span class="badge">ຢູ່ໃນປະກັນ ເຫຼືອ ' + r.left + " ວັນ</span>" : '<span class="badge out">ໝົດປະກັນ</span>';
    return '<article class="ord s-' + (r.state === "out" ? "cancelled" : "delivered") + '" data-view="' + r.o._id + '"><div><b>' + esc(r.i.name) + " ×" + esc(r.i.qty) + '</b><span class="sub">' + (r.i.serial ? "S/N: " + esc(r.i.serial) : "ບໍ່ມີ Serial") + "</span></div>" +
      "<div>" + esc(r.o.name) + '<span class="sub">' + esc(phoneOf(r.o) || "ບໍ່ມີເບີ") + " · ຊື້ " + esc(fdate(r.t)) + '</span></div><div style="text-align:right">' + b + '<span class="sub">' + (r.end ? "ໝົດ " + esc(fdate(r.end).split(",")[0]) : "") + "</span></div></article>";
  }).join("") || '<div class="empty">ບໍ່ພົບລາຍການ. ຖ້າຍັງບໍ່ມີ ໃຫ້ເປີດອໍເດີ ແລ້ວໃສ່ Serial ຂອງສິນຄ້າ.</div>';
}
$("wq").oninput = drawWarranty;
$("wfil").onclick = (e) => { const b = e.target.closest("[data-wf]"); if (b) { wfil = b.dataset.wf; drawWarranty(); } };

// ---------- ການຊຳລະ: ປ້າຍ, ສະລິບ, QR ຮ້ານ ----------
const PAYM = { transfer: "ໂອນຜ່ານ QR", cash: "ຈ່າຍເງິນສົດ (ຕອນຮັບເຄື່ອງ / ທີ່ຮ້ານ)" };
const payState = (o) => (o.paid ? "paid" : o.hasSlip ? "slip" : o.payMethod === "cash" ? "cod" : o.payMethod === "transfer" ? "wait" : "none");
function payBadge(o) {
  if (o.paid) return ' <span class="badge">ຊຳລະແລ້ວ</span>';
  if (o.hasSlip) return ' <span class="badge low">ລໍຖ້າກວດສະລິບ</span>';
  if (o.payMethod === "transfer") return ' <span class="badge low">ລໍຖ້າໂອນ</span>';
  if (o.payMethod === "cash") return ' <span class="badge low">ເກັບເງິນປາຍທາງ</span>';
  return "";
}
const slipCache = {};
async function loadSlip() {
  const el = $("o-slip"), id = viewing; if (!el) return;
  try {
    if (!slipCache[id]) { const sn = await getDoc(doc(db, "slips", id)); slipCache[id] = sn.exists() ? (sn.data().img || "") : ""; }
    if ($("o-slip") && viewing === id) $("o-slip").innerHTML = slipCache[id] ? '<img class="slipimg" src="' + slipCache[id] + '" alt="ສະລິບ" title="ກົດເພື່ອຂະຫຍາຍ">' : "ບໍ່ພົບຮູບສະລິບ";
  } catch (e) { if ($("o-slip")) $("o-slip").textContent = "ໂຫຼດສະລິບບໍ່ໄດ້: " + (e.message || e); }
}
let qrData = "";
function drawQr() { $("st-qr-prev").innerHTML = qrData ? '<div><img src="' + qrData + '" alt="QR"><button type="button" id="st-qr-rm" aria-label="ລຶບ">&times;</button></div>' : ""; }
$("st-qr").onchange = async (e) => {
  try { const f = e.target.files[0]; if (f) { qrData = await shrink(f, 700, 0.92); drawQr(); } } catch (x) { fail(x); }
  e.target.value = "";
};
$("st-qr-prev").onclick = (e) => { if (e.target.id === "st-qr-rm") { qrData = ""; drawQr(); } };
$("opay").onchange = drawOrders;
