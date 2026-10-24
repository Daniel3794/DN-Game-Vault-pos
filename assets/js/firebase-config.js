// ໃສ່ຄ່າຈາກ Firebase Console > Project settings > Your apps > Web app
// ໃຊ້ຄ່າຊຸດດຽວກັນກັບເວັບຮ້ານ (shop) ເພື່ອໃຫ້ໃຊ້ຖານຂໍ້ມູນດຽວກັນ
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAk3AapnGbC28F36gsnUbSqpRvdeKb8Eto",
  authDomain: "laotect.firebaseapp.com",
  projectId: "laotect",
  appId: "1:206015345141:web:2fc475c26af5d99980f0bc"
};
// ລິ້ງເວັບຮ້ານ (ໃຊ້ສະແດງປຸ່ມ "ເບິ່ງໜ້າຮ້ານ") ເຊັ່ນ "https://www.your-shop.com/" ປະໄວ້ຫວ່າງ = ບໍ່ສະແດງປຸ່ມ
export const shopUrl = "";

export const configured = firebaseConfig.apiKey !== "YOUR_API_KEY";
const app = configured ? initializeApp(firebaseConfig) : null;
export const db = app ? getFirestore(app) : null;
export const auth = app ? getAuth(app) : null;
