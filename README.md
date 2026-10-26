# DN Game Vault – ເວັບຫຼັງບ້ານ (ສຳລັບເຈົ້າຂອງຮ້ານ)

ເວັບນີ້ແຍກຈາກເວັບຮ້ານ (`shop`) ແຕ່ໃຊ້ **ຖານຂໍ້ມູນ Firebase ດຽວກັນ**. ປິດບໍ່ໃຫ້ Google ຄົ້ນຫາເຈິ (noindex).

```
backoffice/
├── index.html              ສົ່ງຕໍ່ໄປ admin.html
├── login.html              ເຂົ້າສູ່ລະບົບ
├── admin.html              ຫຼັງບ້ານ (ພາບລວມ, ອໍເດີ, ສິນຄ້າ, ຮັບເຄື່ອງ, ຮັບປະກັນ, ລາຍງານ, ຕັ້ງຄ່າ)
├── robots.txt, firebase.json
├── assets/
│   ├── css/admin.css
│   ├── js/
│   │   ├── firebase-config.js   ⭐ ໃສ່ຄ່າ Firebase + ລິ້ງເວັບຮ້ານ (shopUrl)
│   │   ├── admin.js, login.js
│   └── img/
└── setup/
    ├── firestore.rules                 ວາງໃນ Firebase Console > Firestore > Rules
    └── google-sheets-apps-script.gs    ວາງໃນ Google Sheet > Extensions > Apps Script
```

## ຕັ້ງຄ່າ
1. ແກ້ `assets/js/firebase-config.js`: ໃສ່ຄ່າ Firebase (ຄ່າດຽວກັນກັບ shop) ແລະ `shopUrl` (ລິ້ງເວັບຮ້ານ).
2. **Authentication → Settings → Authorized domains**: ເພີ່ມໂດເມນຂອງເວັບຫຼັງບ້ານ (ບໍ່ດັ່ງນັ້ນ login ຈະບໍ່ໄດ້).
3. ວາງ `setup/firestore.rules` ໃນ Firestore Rules ແລະ ປ່ຽນ `YOUR_ADMIN_EMAIL`. (Rules ຊຸດດຽວນີ້ໃຊ້ກັບທັງສອງເວັບ.)
4. ສ້າງຜູ້ໃຊ້ admin ໃນ Authentication (Email/Password).
5. ອັບໂຫຼດໂຟນເດີນີ້ (ບໍ່ຕ້ອງອັບ `setup/`) ຂຶ້ນ Hosting ຄົນລະ site ກັບເວັບຮ້ານ.

ຖ້າຈຳກັດ API key ດ້ວຍ HTTP referrer ໃນ Google Cloud ໃຫ້ເພີ່ມໂດເມນຂອງທັງສອງເວັບ.

## ກວດສະລິບ / ຢືນຢັນຮັບເງິນ
- ໃນເມນູ "ອໍເດີ" ກົດອໍເດີ → ເຫັນສະລິບ (ກົດຂະຫຍາຍໄດ້) ແລ້ວກົດ "ຢືນຢັນຮັບເງິນແລ້ວ". ກອງອໍເດີຕາມການຊຳລະໄດ້ (ລໍຖ້າກວດສະລິບ / ຍັງບໍ່ຊຳລະ / ຊຳລະແລ້ວ).
- ຮູບ QR ຮັບເງິນປ່ຽນໄດ້ໃນເມນູ "ຕັ້ງຄ່າ". **ຕ້ອງວາງ `setup/firestore.rules` ອັນໃໝ່** (ມີກົດ `slips`).
