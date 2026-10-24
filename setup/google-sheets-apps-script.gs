// ວິທີໃຊ້: ເປີດ Google Sheet ໃໝ່ > Extensions > Apps Script > ລຶບໂຄ້ດເດີມ ແລ້ວວາງໂຄ້ດນີ້ທັງໝົດ
// ແກ້ SECRET ເປັນລະຫັດລັບຂອງເຈົ້າ > Deploy > New deployment > Web app
//   Execute as: Me | Who has access: Anyone > Deploy > ກ໊ອບ Web app URL ໄປໃສ່ໃນໜ້າ ລາຍງານ ຂອງ admin
const SECRET = "ປ່ຽນເປັນລະຫັດລັບຂອງເຈົ້າ";
const SHEET_NAME = "ຍອດຂາຍລາຍເດືອນ";
const HEAD = ["ເດືອນ", "ຈຳນວນອໍເດີ", "ອອນລາຍ", "ໜ້າຮ້ານ", "ຍອດຂາຍ (ກີບ)", "ສິນຄ້າຂາຍດີ", "ອັບເດດເມື່ອ", "ກຳໄລ (ກີບ)"];

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const b = JSON.parse(e.postData.contents);
    if (b.token !== SECRET) return out({ ok: false, error: "ລະຫັດລັບບໍ່ຕົງກັບ Apps Script" });
    lock.waitLock(10000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    if (sh.getLastRow() === 0) {
      sh.appendRow(HEAD);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, HEAD.length).setFontWeight("bold");
      sh.getRange("A:A").setNumberFormat("@"); // ເກັບເດືອນເປັນຂໍ້ຄວາມ ບໍ່ໃຫ້ກາຍເປັນວັນທີ
      sh.getRange("E:E").setNumberFormat("#,##0");
      sh.getRange("G:G").setNumberFormat("yyyy-mm-dd hh:mm");
      sh.getRange("H:H").setNumberFormat("#,##0");
    }
    if (sh.getRange(1, 8).getValue() === "") { sh.getRange(1, 8).setValue(HEAD[7]).setFontWeight("bold"); sh.getRange("H:H").setNumberFormat("#,##0"); } // ຊີດເກົ່າ: ເພີ່ມຫົວຄໍລຳກຳໄລ
    const months = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
    (b.rows || []).forEach(function (r) {
      const vals = [r.month, r.orders, r.web, r.store, r.revenue, r.top || "", new Date(), r.profit || 0];
      const i = months.indexOf(r.month);
      if (i >= 0) sh.getRange(i + 2, 1, 1, vals.length).setValues([vals]); // ເດືອນເກົ່າ: ອັບເດດແຖວເດີມ
      else { sh.appendRow(vals); months.push(r.month); }                  // ເດືອນໃໝ່: ເພີ່ມແຖວ
    });
    return out({ ok: true, count: (b.rows || []).length, url: ss.getUrl() });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
