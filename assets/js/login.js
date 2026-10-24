// ໜ້າເຂົ້າສູ່ລະບົບ: ສຳເລັດແລ້ວໄປ admin.html, ຖ້າເຂົ້າລະບົບຢູ່ແລ້ວຂ້າມໄປ admin ເລີຍ
import { auth, configured, shopUrl } from "./firebase-config.js";
import { onAuthStateChanged, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const $ = (id) => document.getElementById(id);
if (shopUrl) { $("backlink").href = shopUrl; $("backlink").hidden = false; }

if (!configured) {
  $("login").innerHTML = '<div class="brand"><img src="assets/img/logo.png" alt="" width="36" height="36"> DN Game Vault</div><p class="err">ຍັງບໍ່ໄດ້ໃສ່ຄ່າ Firebase. ເປີດ assets/js/firebase-config.js ແລ້ວແກ້ຄ່າກ່ອນ.</p>';
} else {
  onAuthStateChanged(auth, (u) => { if (u) location.replace("admin.html"); });
  $("login").onsubmit = (e) => {
    e.preventDefault(); $("msg").textContent = ""; $("go").disabled = true;
    signInWithEmailAndPassword(auth, $("email").value, $("pass").value)
      .catch(() => { $("msg").textContent = "ອີເມວ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກ"; $("go").disabled = false; });
  };
}
