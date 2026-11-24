/**
 * 同樂班級大屏｜資料端點（行事曆＋試算表＋抽籤線上報名）
 *
 * 一次性設定（編輯器左側「專案設定」→「指令碼屬性」新增）：
 *   TOKEN        自訂的存取代碼（例如 tongle-2026），大屏設定頁填同一組
 *   SHEET_ID     試算表網址中 /d/ 與 /edit 之間那一串
 *   CALENDAR_ID  （選填）要顯示的行事曆 ID；不填就用你的預設行事曆
 *
 * 試算表「今日畫面」分頁，第 1 列為標題，欄位順序固定：
 *   A 日期 (yyyy-MM-dd)｜B 學習目標｜C 提醒事項｜D 教材｜E 完成後
 *   同一格內要換行請按 Alt+Enter。
 *
 * 抽籤線上報名會自動建立「抽籤名單」分頁（欄位：房號、編號、姓名、單位、時間），
 * 活動結束後可直接刪除該分頁的列，讓之後的速度維持順暢。
 *

 * 【手機版與雲端同步】（v4 新增）
 *   1) 專案左側「＋」→「HTML」，檔名輸入 Mobile，貼上 Mobile.html 的全部內容。
 *   2) 試算表會自動出現「大屏內容」分頁（key／value／更新時間／刪除），請勿手動改動。
 *   3) 手機開啟：部署網址後面加上 ?page=m ，輸入與 TOKEN 相同的存取代碼即可編修。
 *   4) 大屏設定頁填入同一個網址與代碼後，會每 30 秒自動雙向同步（最後修改者為準）。
 *

 * 【未繳作業：雲端紀錄＋Google 表單】（v5 新增）
 *   1) 在 Apps Script 編輯器選函式 setupHwForm → 執行（第一次會要求授權，請全部允許）。
 *      會自動建立「作業繳交登記」表單、連到試算表，並在「執行記錄」印出表單網址。
 *   2) 試算表會有「homework」分頁（唯一真實資料）與表單的「表單回應」分頁。
 *   3) 大屏點座號與表單填寫，都會寫進「homework」，以最後修改者為準；資料永久保存。
 *   4) 只存「班級＋座號」，不存姓名。
 *
 * 【計分板：個人平時成績】（v6 新增）
 *   大屏計分板「點座號給分」會把每人每天的分數寫進「score」分頁（日期、班級、座號、組別、分數）。
 *   只存班級＋座號，不存姓名；大屏不顯示個人分數，老師可在大屏匯出 CSV，或直接在試算表查看。
 *
 * 部署：右上角「部署」→「新增部署作業」→ 類型「網頁應用程式」
 *   執行身分：我；誰可以存取：任何人（他校要掃 QR 報名，必須是「任何人」）
 *   更新程式碼後，要「管理部署作業 → 編輯 → 新版本」才會生效。
 */

var TZ = 'Asia/Taipei';
var MAX_ENTRANTS = 1000;
var LIST_SHEET = '抽籤名單';

function doGet(e) {
  var p = (e && e.parameter) || {};

  // 0) 手機版頁面與雲端同步
  if (String(p.page) === 'm') {
    return HtmlService.createHtmlOutputFromFile('Mobile')
      .setTitle('班級大屏・手機版')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (String(p.action) === 'score_get') {
    if (!tokenOk_(p.token)) return out_({ error: 'unauthorized' });
    try { return out_(scoreGet_(String(p.cls == null ? '' : p.cls), String(p.from || ''), String(p.to || ''))); }
    catch (err) { return out_({ error: String(err.message || err) }); }
  }
  if (String(p.action) === 'hw_get') {
    if (!tokenOk_(p.token)) return out_({ error: 'unauthorized' });
    try { return out_(hwGet_(String(p.date || ''), String(p.cls == null ? '*' : p.cls))); }
    catch (err) { return out_({ error: String(err.message || err) }); }
  }
  if (String(p.action) === 'admin_get') {
    if (!tokenOk_(p.token)) return out_({ error: 'unauthorized' });
    try { return out_(adminGet_()); } catch (err) { return out_({ error: String(err.message || err) }); }
  }
  if (String(p.action) === 'sync_get') {
    if (!tokenOk_(p.token)) return out_({ error: 'unauthorized' });
    try { return out_(syncGet_()); } catch (err) { return out_({ error: String(err.message || err) }); }
  }

  // 1) 報名頁（公開，用房號識別）
  if (p.join) {
    return joinPage_(String(p.join));
  }
  // 2) 抽籤主持端 API（需要 TOKEN）
  if (p.action) {
    return out_(api_(p));
  }

  // 3) 大屏資料
  if (!tokenOk_(p.token)) {
    return out_({ error: 'unauthorized' });
  }
  return out_(todayData_());
}

function todayData_() {
  var props = PropertiesService.getScriptProperties();
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  var result = {
    date: Utilities.formatDate(now, TZ, 'yyyy-MM-dd'),
    events: [],
    objectives: '', reminders: '', materials: '', next: ''
  };

  var calId = props.getProperty('CALENDAR_ID');
  var cal = calId ? CalendarApp.getCalendarById(calId) : CalendarApp.getDefaultCalendar();
  if (cal) {
    cal.getEvents(start, end).forEach(function (ev) {
      result.events.push({
        id: ev.getId(),
        title: ev.getTitle(),
        start: ev.getStartTime().getTime(),
        end: ev.getEndTime().getTime(),
        allDay: ev.isAllDayEvent(),
        location: ev.getLocation() || ''
      });
    });
  }

  var sheetId = props.getProperty('SHEET_ID');
  if (sheetId) {
    var sh = SpreadsheetApp.openById(sheetId).getSheetByName('今日畫面');
    if (sh && sh.getLastRow() > 1) {
      var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
      for (var i = 0; i < rows.length; i++) {
        var cell = rows[i][0];
        var key = (cell instanceof Date) ? Utilities.formatDate(cell, TZ, 'yyyy-MM-dd') : String(cell).trim();
        if (key === result.date) {
          result.objectives = String(rows[i][1] || '');
          result.reminders = String(rows[i][2] || '');
          result.materials = String(rows[i][3] || '');
          result.next = String(rows[i][4] || '');
          break;
        }
      }
    }
  }
  return result;
}

function tokenOk_(given) {
  var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  return !token || String(given || '') === token;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ==================== 雲端同步（大屏 ⇄ 手機版） ==================== */

var SYNC_SHEET = '大屏內容';
var SYNC_KEY_RE = /^(?:(?:cl|rt|lk|cd|tt|proj|note)\.[\w-]{1,64}|text\.(?:(?:admin|train)\.)?\d{4}-\d{2}-\d{2}\.(?:objectives|reminders|materials|next)|manifest)$/;
var SYNC_MAX_CHARS = 45000;

function syncSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('no-sheet-id');
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName(SYNC_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SYNC_SHEET);
    sh.getRange(1, 1, 1, 4).setValues([['key', 'value', 'updatedAt', 'deleted']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function syncGet_() {
  var sh = syncSheet_();
  var last = sh.getLastRow();
  var rows = [];
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 4).getValues().forEach(function (r) {
      if (!r[0]) return;
      rows.push({ k: String(r[0]), v: String(r[1] == null ? '' : r[1]), t: Number(r[2]) || 0,
                  del: r[3] === true || String(r[3]) === '1' || String(r[3]).toLowerCase() === 'true' });
    });
  }
  return { now: Date.now(), rows: rows };
}

// items: [{k, v, t, del?}]；較舊的修改不會覆蓋較新的
function syncSet_(items) {
  if (!Array.isArray(items)) return { error: 'bad-items' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = syncSheet_();
    var last = sh.getLastRow();
    var keys = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
    var times = last > 1 ? sh.getRange(2, 3, last - 1, 1).getValues() : [];
    var index = {};
    keys.forEach(function (r, i) { index[String(r[0])] = { row: i + 2, t: Number(times[i][0]) || 0 }; });
    var nowMs = Date.now();
    var applied = 0, skipped = 0;
    items.slice(0, 60).forEach(function (it) {
      var k = String(it && it.k || '');
      if (!SYNC_KEY_RE.test(k)) { skipped++; return; }
      var v = it.del ? '' : String(it.v == null ? '' : it.v);
      if (v.length > SYNC_MAX_CHARS) { skipped++; return; }
      var t = Number(it.t) || nowMs;
      if (t > nowMs + 60000) t = nowMs;
      var ex = index[k];
      if (ex && ex.t >= t) { skipped++; return; }
      var rowVals = [[k, v, t, it.del ? 1 : 0]];
      var row;
      if (ex) { row = ex.row; }
      else { row = sh.getLastRow() + 1; index[k] = { row: row, t: t }; }
      var rng = sh.getRange(row, 1, 1, 4);
      rng.setNumberFormat('@');          // 一律當純文字，避免 = 開頭被當成公式
      rng.setValues(rowVals);
      sh.getRange(row, 3).setNumberFormat('0');
      sh.getRange(row, 3).setValue(t);
      index[k].t = t;
      applied++;
    });
    return { ok: true, applied: applied, skipped: skipped, now: Date.now() };
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return out_({ error: 'bad-json' }); }
  if (!tokenOk_(body.token)) return out_({ error: 'unauthorized' });
  try {
    if (String(body.action) === 'sync_set') return out_(syncSet_(body.items));
    if (String(body.action) === 'score_set') return out_(scoreUpsert_(body.items));
    if (String(body.action) === 'hw_set') return out_(hwUpsert_(body.items, 'board'));
  } catch (err2) { return out_({ error: String(err2.message || err2) }); }
  return out_({ error: 'bad-action' });
}

// 手機版頁面（google.script.run）使用
function mGet(token) {
  if (!tokenOk_(token)) return { error: 'unauthorized' };
  var r = syncGet_();
  try { r.today = todayData_(); } catch (e) { r.today = null; }
  return r;
}
function mSet(token, items) {
  if (!tokenOk_(token)) return { error: 'unauthorized' };
  return syncSet_(items);
}


/* ==================== 未繳作業：雲端紀錄與表單 ==================== */

var HW_SHEET_DEFAULT = 'homework';   // 可用指令碼屬性 HW_TAB 改名
var HW_HEAD = ['key', '日期', '班級', '身分', '作業', '未繳座號', 'updatedAt', '來源', 'deleted'];
var HW_CLASS_DEFAULT = '一年忠班,二年忠班,三年忠班,四年忠班,五年忠班,六年忠班,特一,特二';   // 全校班級（只能從這裡選）
function hwClasses_() { return HW_CLASS_DEFAULT.split(','); }   // 固定名單；要增減班級請改上面這一行
function classOk_(c) { return c === '' || hwClasses_().indexOf(c) > -1; }
var HW_TAGS = ['導師', '科任・英語', '科任・自然', '科任・社會', '科任・體育', '科任・音樂', '科任・美勞', '科任・本土語', '科任・電腦', '科任・其他'];

function hwSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('no-sheet-id');
  var ss = SpreadsheetApp.openById(id);
  var name = PropertiesService.getScriptProperties().getProperty('HW_TAB') || HW_SHEET_DEFAULT;
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {               // 新建或空白的分頁：寫入標題列
    sh.getRange(1, 1, 1, HW_HEAD.length).setValues([HW_HEAD]);
    sh.setFrozenRows(1);
    sh.getRange('A:F').setNumberFormat('@');
  }
  return sh;
}

function hwSeats_(str) {
  var seen = {}, out = [];
  String(str || '').split(/[,，、;；\s]+/).forEach(function (x) {
    var n = parseInt(x, 10);
    if (n >= 1 && n <= 99 && !seen[n]) { seen[n] = 1; out.push(n); }
  });
  return out.sort(function (a, b) { return a - b; }).join(',');
}

// items: [{d,c,g,n,m,t,del}]；較舊的修改不會覆蓋較新的
function hwUpsert_(items, source) {
  if (!Array.isArray(items)) return { error: 'bad-items' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var created = false;
  var res;
  try {
    var sh = hwSheet_();
    var last = sh.getLastRow();
    var keys = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
    var times = last > 1 ? sh.getRange(2, 7, last - 1, 1).getValues() : [];
    var index = {};
    keys.forEach(function (r, i) { index[String(r[0])] = { row: i + 2, t: Number(times[i][0]) || 0 }; });
    var nowMs = Date.now(), applied = 0, skipped = 0;
    items.slice(0, 80).forEach(function (it) {
      var d = String(it.d || ''), c = String(it.c == null ? '' : it.c).trim(), g = String(it.g || '').trim(), n = String(it.n || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !classOk_(c) || g.length > 12 || !n || n.length > 20) { skipped++; return; }
      if (/^[=+\-@]/.test(n) || /^[=+\-@]/.test(c)) { skipped++; return; }
      var t = Number(it.t) || nowMs;
      if (t > nowMs + 60000) t = nowMs;
      var key = [d, c, g, n].join('|');
      var ex = index[key];
      if (ex && ex.t >= t) { skipped++; return; }
      var row;
      if (ex) { row = ex.row; } else { row = sh.getLastRow() + 1; created = true; }
      var rng = sh.getRange(row, 1, 1, 9);
      rng.setNumberFormat('@');
      rng.setValues([[key, d, c, g, n, it.del ? '' : hwSeats_(it.m), t, source || '', it.del ? 1 : 0]]);
      sh.getRange(row, 7).setNumberFormat('0');
      sh.getRange(row, 7).setValue(t);
      index[key] = { row: row, t: t };
      applied++;
    });
    res = { ok: true, applied: applied, skipped: skipped, now: Date.now() };
  } finally {
    lock.releaseLock();
  }
  if (created) { try { hwUpdateForm_(); } catch (e) {} }
  return res;
}

function hwGet_(date, cls) {
  try { hwImportForm_(); } catch (e) { /* 表單尚未建立或無權限時，不影響大屏讀取 */ }
  var sh = hwSheet_();
  var last = sh.getLastRow();
  var rows = [], dates = {};
  if (last > 1) {
    var from = Math.max(2, last - 3000 + 1);
    sh.getRange(from, 1, last - from + 1, 9).getValues().forEach(function (r) {
      if (!r[0]) return;
      var d = String(r[1]), c = String(r[2]);
      var del = r[8] === true || String(r[8]) === '1';
      if (cls === '*' || c === cls) { if (!del) dates[d] = 1; }
      if (date && d !== date) return;
      if (cls !== '*' && c !== cls) return;
      rows.push({ d: d, c: c, g: String(r[3]), n: String(r[4]), m: String(r[5] || ''), t: Number(r[6]) || 0, del: del, src: String(r[7] || '') });
    });
  }
  var list = Object.keys(dates).sort().reverse().slice(0, 60);
  return { now: Date.now(), rows: rows, dates: list };
}

/* 表單回應 → 作業紀錄（每次大屏讀取時順便匯入最近 300 筆；較舊的不會覆蓋較新的） */
function hwFindFormSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) return null;
  var found = null, fid = PropertiesService.getScriptProperties().getProperty('HW_FORM_ID');
  var sheets = SpreadsheetApp.openById(id).getSheets();
  if (fid) {   // 優先：真正連到目前表單的那個分頁（setupHwForm 跑過多次也不會抓錯）
    try { var furl = FormApp.openById(fid).getEditUrl().replace(/\/edit.*$/, '');
      sheets.forEach(function (sh) { var u = sh.getFormUrl(); if (!found && u && u.indexOf(fid) > -1) found = sh; }); } catch (e) {}
  }
  if (!found) sheets.forEach(function (sh) {
    var n = sh.getName();
    if (!found && (n.indexOf('表單回應') === 0 || n.indexOf('Form Responses') === 0)) found = sh;
  });
  return found;
}
function hwImportForm_() {
  var sh = hwFindFormSheet_();
  if (!sh || sh.getLastRow() < 2) return;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  function col(word) { for (var i = 0; i < head.length; i++) if (head[i].indexOf(word) > -1) return i; return -1; }
  var cT = 0, cC = col('班級'), cG = col('身分'), cN = col('作業'), cS = col('座號');
  if (cC < 0 || cG < 0 || cN < 0 || cS < 0) return;
  var last = sh.getLastRow(), from = Math.max(2, last - 299);
  var vals = sh.getRange(from, 1, last - from + 1, sh.getLastColumn()).getValues();
  var items = [];
  vals.forEach(function (r) {
    var ts = r[cT];
    if (!(ts instanceof Date)) return;
    var raw = String(r[cS] == null ? '' : r[cS]).trim();
    var seats = hwSeats_(raw);
    if (!seats && !/無|全繳|都繳|沒有|已繳/.test(raw)) return;
    var name = String(r[cN] || '').trim();
    if (!name) return;
    items.push({ d: Utilities.formatDate(ts, TZ, 'yyyy-MM-dd'), c: String(r[cC] || '').trim(), g: String(r[cG] || '').trim(),
                 n: name.slice(0, 20), m: seats, t: ts.getTime() });
  });
  if (items.length) hwUpsert_(items, 'form');
}

/* 一次性：建立表單並連到試算表（在編輯器執行 setupHwForm） */
function setupHwForm() {
  var props = PropertiesService.getScriptProperties();
  var sid = props.getProperty('SHEET_ID');
  if (!sid) throw new Error('請先設定指令碼屬性 SHEET_ID');
  hwSheet_();
  var form = FormApp.create('作業繳交登記');
  form.setDescription('請填「未繳」的座號（只填座號，不要填姓名）。全班都繳了，座號請填「無」。同一班、同一作業再次送出，會以最新一次為準。');
  form.setCollectEmail(false);
  var classes = hwClasses_();
  form.addListItem().setTitle('班級').setChoiceValues(classes).setRequired(true);
  form.addListItem().setTitle('身分（導師或科任科目）').setChoiceValues(HW_TAGS).setRequired(true);
  var q = form.addMultipleChoiceItem().setTitle('作業名稱').setRequired(true);
  q.setChoices([q.createChoice('（請選「其他」自行輸入）')]).showOtherOption(true);
  form.addTextItem().setTitle('未繳座號').setHelpText('例如：3, 5, 12　（全班都繳請填「無」）').setRequired(true);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sid);
  props.setProperty('HW_FORM_ID', form.getId());
  Logger.log('表單填寫網址：' + form.getPublishedUrl());
  Logger.log('表單編輯網址：' + form.getEditUrl());
  try { hwUpdateForm_(); } catch (e) {}
}

/* 大屏新增的作業名稱，同步成表單的選項（兩邊都可以新增） */
/* 一次性：把現有表單的「班級」下拉選項改成固定名單（在編輯器執行 fixHwFormClasses） */
function fixHwFormClasses() {
  var fid = PropertiesService.getScriptProperties().getProperty('HW_FORM_ID');
  if (!fid) throw new Error('找不到 HW_FORM_ID，請先執行 setupHwForm');
  var n = 0;
  FormApp.openById(fid).getItems(FormApp.ItemType.LIST).forEach(function (it) {
    if (it.getTitle() === '班級') { it.asListItem().setChoiceValues(hwClasses_()); n++; }
  });
  Logger.log(n ? '已更新班級選項：' + hwClasses_().join('、') : '表單裡沒有「班級」題目');
}

function hwUpdateForm_() {
  var props = PropertiesService.getScriptProperties();
  var fid = props.getProperty('HW_FORM_ID');
  if (!fid) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('hwform')) return;           // 5 分鐘內只更新一次
  cache.put('hwform', '1', 300);
  var sh = hwSheet_(), last = sh.getLastRow();
  if (last < 2) return;
  var from = Math.max(2, last - 400 + 1), names = [], seen = {};
  var rows = sh.getRange(from, 1, last - from + 1, 9).getValues().reverse();
  rows.forEach(function (r) {
    var n = String(r[4] || ''), del = String(r[8]) === '1';
    if (n && !del && !seen[n] && names.length < 40) { seen[n] = 1; names.push(n); }
  });
  if (!names.length) return;
  var form = FormApp.openById(fid);
  form.getItems(FormApp.ItemType.MULTIPLE_CHOICE).forEach(function (it) {
    if (it.getTitle() === '作業名稱') {
      var mc = it.asMultipleChoiceItem();
      mc.setChoices(names.map(function (n) { return mc.createChoice(n); })).showOtherOption(true);
    }
  });
}


/* ==================== 計分板：個人平時成績（每人每天一列） ==================== */

var SC_SHEET_DEFAULT = 'score';   // 可用指令碼屬性 SCORE_TAB 改名
var SC_HEAD = ['key', '日期', '班級', '座號', '組別', '分數', 'updatedAt'];

function scoreSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('no-sheet-id');
  var ss = SpreadsheetApp.openById(id);
  var name = PropertiesService.getScriptProperties().getProperty('SCORE_TAB') || SC_SHEET_DEFAULT;
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, SC_HEAD.length).setValues([SC_HEAD]);
    sh.setFrozenRows(1);
    sh.getRange('A:E').setNumberFormat('@');
  }
  return sh;
}

// items: [{d,c,s,g,p,t}]：p 為「該座號當天累計分數」（絕對值）；較舊的修改不會覆蓋較新的
function scoreUpsert_(items) {
  if (!Array.isArray(items)) return { error: 'bad-items' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = scoreSheet_();
    var last = sh.getLastRow();
    var keys = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
    var times = last > 1 ? sh.getRange(2, 7, last - 1, 1).getValues() : [];
    var index = {};
    keys.forEach(function (r, i) { index[String(r[0])] = { row: i + 2, t: Number(times[i][0]) || 0 }; });
    var nowMs = Date.now(), applied = 0, skipped = 0;
    items.slice(0, 120).forEach(function (it) {
      var d = String(it.d || ''), c = String(it.c == null ? '' : it.c).trim(), g = String(it.g == null ? '' : it.g).trim();
      var seat = parseInt(it.s, 10), p = parseInt(it.p, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !classOk_(c) || g.length > 12 || !(seat >= 1 && seat <= 99) || isNaN(p) || Math.abs(p) > 9999) { skipped++; return; }
      if (/^[=+\-@]/.test(c) || /^[=+\-@]/.test(g)) { skipped++; return; }
      var t = Number(it.t) || nowMs;
      if (t > nowMs + 60000) t = nowMs;
      var key = [d, c, seat].join('|');
      var ex = index[key];
      if (ex && ex.t >= t) { skipped++; return; }
      var row = ex ? ex.row : sh.getLastRow() + 1;
      var rng = sh.getRange(row, 1, 1, 7);
      rng.setNumberFormat('@');
      rng.setValues([[key, d, c, seat, g, p, t]]);
      sh.getRange(row, 6, 1, 2).setNumberFormat('0');
      sh.getRange(row, 6).setValue(p);
      sh.getRange(row, 7).setValue(t);
      index[key] = { row: row, t: t };
      applied++;
    });
    return { ok: true, applied: applied, skipped: skipped, now: Date.now() };
  } finally {
    lock.releaseLock();
  }
}

function scoreGet_(cls, from, to) {
  var sh = scoreSheet_();
  var last = sh.getLastRow();
  var rows = [];
  if (last > 1) {
    var start = Math.max(2, last - 5000 + 1);
    sh.getRange(start, 1, last - start + 1, 7).getValues().forEach(function (r) {
      if (!r[0]) return;
      var d = String(r[1]), c = String(r[2]);
      if (cls !== '*' && c !== cls) return;
      if (from && d < from) return;
      if (to && d > to) return;
      rows.push({ d: d, c: c, s: Number(r[3]), g: String(r[4] || ''), p: Number(r[5]) || 0, t: Number(r[6]) || 0 });
    });
  }
  return { now: Date.now(), rows: rows };
}

/* ==================== 抽籤：主持端 API ==================== */

function api_(p) {
  if (!tokenOk_(p.token)) return { error: 'unauthorized' };
  var room = String(p.room || '');
  if (!/^[A-Z0-9]{6}$/.test(room)) return { error: 'bad-room' };
  var st = getState_(room);

  switch (String(p.action)) {
    case 'roster': {
      var count = countOf_(room);
      if (p.have !== undefined && Number(p.have) === count) {
        return { same: true, count: count, closed: !!st.closed };
      }
      return { count: count, closed: !!st.closed, entries: entriesOf_(room) };
    }
    case 'publish': {
      var d;
      try { d = JSON.parse(String(p.data || '{}')); } catch (err) { return { error: 'bad-data' }; }
      st.round = Number(d.round) || 0;
      st.winners = (d.winners || []).slice(0, 50).map(function (w) {
        return { id: String(w.id || '').slice(0, 20), name: clean_(w.name) };
      });
      setState_(room, st);
      return { ok: true };
    }
    case 'close': st.closed = true; setState_(room, st); return { ok: true, closed: true };
    case 'open': st.closed = false; setState_(room, st); return { ok: true, closed: false };
  }
  return { error: 'bad-action' };
}

function getState_(room) {
  var raw = PropertiesService.getScriptProperties().getProperty('R_' + room);
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
function setState_(room, st) {
  PropertiesService.getScriptProperties().setProperty('R_' + room, JSON.stringify(st));
}

function clean_(s) {
  // 去掉控制字元與開頭的公式符號，避免試算表把姓名當公式執行
  return String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
    .replace(/^[=+\-@]+/, '').slice(0, 20);
}

function listSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('尚未設定 SHEET_ID');
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName(LIST_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LIST_SHEET);
    sh.appendRow(['房號', '編號', '姓名', '單位', '時間']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function rowsOf_(room) {
  var sh = listSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues().filter(function (r) {
    return String(r[0]) === room;
  });
}
function entriesOf_(room) {
  return rowsOf_(room).map(function (r) {
    return { id: String(r[1]), name: String(r[2]), org: String(r[3]) };
  });
}
function countOf_(room) {
  var cache = CacheService.getScriptCache();
  var c = cache.get('C_' + room);
  if (c !== null) return Number(c);
  var n = rowsOf_(room).length;
  cache.put('C_' + room, String(n), 21600);
  return n;
}

/* ==================== 抽籤：參加者（google.script.run 呼叫） ==================== */

function joinRoom(room, name, org) {
  room = String(room || '');
  if (!/^[A-Z0-9]{6}$/.test(room)) return { ok: false, msg: '房號不正確，請重新掃描 QR Code。' };
  name = clean_(name);
  org = clean_(org);
  if (!name) return { ok: false, msg: '請輸入姓名。' };
  if (getState_(room).closed) return { ok: false, msg: '報名已關閉。' };

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);   // 逾時會丟出例外，前端會自動重試
  try {
    var rows = rowsOf_(room);
    if (rows.length >= MAX_ENTRANTS) return { ok: false, msg: '名額已滿（' + MAX_ENTRANTS + ' 人）。' };
    var key = (name + '|' + org).toLowerCase();
    for (var i = 0; i < rows.length; i++) {
      if ((String(rows[i][2]) + '|' + String(rows[i][3])).toLowerCase() === key) {
        return { ok: true, id: String(rows[i][1]), name: name, dup: true };
      }
    }
    var id = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    listSheet_().appendRow([room, id, name, org, new Date()]);
    CacheService.getScriptCache().put('C_' + room, String(rows.length + 1), 21600);
    return { ok: true, id: id, name: name };
  } finally {
    lock.releaseLock();
  }
}

function getRoomState(room, id) {
  room = String(room || '');
  if (!/^[A-Z0-9]{6}$/.test(room)) return { ok: false };
  var st = getState_(room);
  var won = (st.winners || []).some(function (w) { return w.id === String(id || ''); });
  return { ok: true, round: st.round || 0, closed: !!st.closed, won: won };
}

function joinPage_(room) {
  if (!/^[A-Z0-9]{6}$/.test(room)) {
    return HtmlService.createHtmlOutput('房號不正確，請重新掃描 QR Code。');
  }
  var html = [
    '<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>加入抽籤</title><style>',
    'body{margin:0;font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif;background:#0e3a45;color:#12303a;min-height:100vh;display:flex;align-items:center;justify-content:center}',
    'main{background:#f6fbfa;border-radius:18px;padding:24px;width:min(92vw,420px);box-shadow:0 8px 30px rgba(0,0,0,.3)}',
    'h1{font-size:26px;margin:0 0 4px}.room{color:#5b7780;margin:0 0 18px}',
    'label{display:block;font-weight:700;margin:14px 0 6px}',
    'input{width:100%;box-sizing:border-box;font-size:18px;padding:12px;border:2px solid #d5e4e2;border-radius:10px}',
    'button{width:100%;margin-top:18px;font-size:19px;font-weight:700;padding:14px;border:0;border-radius:12px;background:#ff7a59;color:#fff}',
    'button:disabled{opacity:.5}#msg{margin:14px 0 0;font-size:17px;line-height:1.5}',
    '.big{font-size:28px;font-weight:900;text-align:center}',
    '</style></head><body><main>',
    '<h1>加入抽籤</h1><p class="room">房號 __ROOM__</p>',
    '<form id="f"><label for="n">姓名</label><input id="n" maxlength="20" autocomplete="name" required>',
    '<label for="o">單位／學校（選填）</label><input id="o" maxlength="20">',
    '<button id="b" type="submit">加入</button></form>',
    '<p id="msg"></p><button id="chk" type="button" hidden>查看是否中籤</button>',
    '<script>',
    'var ROOM="__ROOM__",KEY="draw_"+ROOM,me=null;',
    'var $=function(i){return document.getElementById(i)};',
    'function say(t,big){var m=$("msg");m.textContent=t;m.className=big?"big":""}',
    'function joined(r){me=r;$("f").hidden=true;$("chk").hidden=false;say("已加入：「"+r.name+"」。請看大螢幕，抽到時會顯示名字。")}',
    'try{var s=JSON.parse(localStorage.getItem(KEY)||"null");if(s&&s.id)joined(s)}catch(e){}',
    'function submit(t){',
    ' $("b").disabled=true;say("送出中…");',
    ' google.script.run.withSuccessHandler(function(r){',
    '  if(r&&r.ok){try{localStorage.setItem(KEY,JSON.stringify(r))}catch(e){}joined(r)}',
    '  else{say((r&&r.msg)||"加入失敗");$("b").disabled=false}',
    ' }).withFailureHandler(function(){',
    '  if(t<5){say("人數較多，自動重試中…");setTimeout(function(){submit(t+1)},1000+Math.random()*3000)}',
    '  else{say("連線失敗，請稍後再試。");$("b").disabled=false}',
    ' }).joinRoom(ROOM,$("n").value,$("o").value);',
    '}',
    '$("f").addEventListener("submit",function(e){e.preventDefault();submit(0)});',
    '$("chk").addEventListener("click",function(){',
    ' $("chk").disabled=true;',
    ' google.script.run.withSuccessHandler(function(r){$("chk").disabled=false;',
    '  if(r&&r.won)say("🎉 你被抽中了！",true);',
    '  else say(r&&r.round?"目前已抽 "+r.round+" 次，這次沒有抽到你。":"還沒開始抽籤。")',
    ' }).withFailureHandler(function(){$("chk").disabled=false;say("查詢失敗，請稍後再試。")}).getRoomState(ROOM,me&&me.id);',
    '});',
    '</script></main></body></html>'
  ].join('\n').replace(/__ROOM__/g, room);
  return HtmlService.createHtmlOutput(html).setTitle('加入抽籤');
}


/* ==================== 行政看板：公文未辦件數、今日請假（v8） ====================
 * 讀同一份試算表的兩個分頁（分頁名稱可用指令碼屬性 DOC_TAB、LEAVE_TAB 改）：
 *   「公文」：承辦單位、承辦人、文號、主旨（可再加一欄「狀態」，填已辦／已批／結案／歸檔等字樣的不計入未辦）
 *   「差假」：單位、姓名、表單、申請時間（例：起115-11-23(一) 15:00；訖115-11-23(一) 16:00；共計0日1時）
 * 只回傳「件數」與「請假姓名」：公文主旨、文號、承辦人不會離開試算表；假別（病假、事假…）也不回傳。
 */
var ADM_DOC_TAB = '公文';
var ADM_LEAVE_TAB = '差假';
var ADM_DONE_RE = /已辦|已批|已核|結案|歸檔|完成|銷號|作廢/;
var ADM_NOT_LEAVE_RE = /加班|刷卡|補登|忘打|未打|補簽/;

function adminGet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (!id) throw new Error('no-sheet-id');
  var ss = SpreadsheetApp.openById(id);
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  return {
    date: today,
    docs: adminDocs_(ss.getSheetByName(props.getProperty('DOC_TAB') || ADM_DOC_TAB)),
    leave: adminLeave_(ss.getSheetByName(props.getProperty('LEAVE_TAB') || ADM_LEAVE_TAB), today)
  };
}

function adminCol_(head, names) {
  for (var i = 0; i < head.length; i++) {
    var h = String(head[i]).replace(/\s/g, '');
    for (var k = 0; k < names.length; k++) if (h === names[k]) return i;
  }
  return -1;
}

function adminDocs_(sh) {
  var r = { pending: 0, byUnit: [], missing: !sh };
  if (!sh || sh.getLastRow() < 2) return r;
  var v = sh.getDataRange().getValues();
  var cNo = adminCol_(v[0], ['文號']), cUnit = adminCol_(v[0], ['承辦單位', '單位']);
  var cSt = adminCol_(v[0], ['狀態', '辦理狀態', '辦理情形']);
  if (cNo < 0) cNo = 2;
  var by = {};
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][cNo]).trim() === '') continue;
    if (cSt >= 0 && ADM_DONE_RE.test(String(v[i][cSt]))) continue;
    r.pending++;
    var u = cUnit >= 0 ? String(v[i][cUnit]).trim() || '未填單位' : '未填單位';
    by[u] = (by[u] || 0) + 1;
  }
  r.byUnit = Object.keys(by).map(function (u) { return { u: u, n: by[u] }; })
    .sort(function (a, b) { return b.n - a.n; });
  return r;
}

// 解析「起115-11-23(一) 15:00；訖115-11-23(一) 16:00；共計0日1時」→ {s:'yyyy-MM-dd', e:'yyyy-MM-dd', st:'15:00', et:'16:00', part:true}
function adminParseRange_(txt) {
  var m = String(txt).match(/起\s*(\d{2,3})-(\d{1,2})-(\d{1,2})[^\d]*?(\d{1,2}):(\d{2})[\s\S]*?訖\s*(\d{2,3})-(\d{1,2})-(\d{1,2})[^\d]*?(\d{1,2}):(\d{2})/);
  if (!m) return null;
  function d(y, mo, da) { return (Number(y) + 1911) + '-' + ('0' + mo).slice(-2) + '-' + ('0' + da).slice(-2); }
  function t(h, mi) { return ('0' + h).slice(-2) + ':' + mi; }
  var days = String(txt).match(/共計\s*(\d+)\s*日/);
  var s = d(m[1], m[2], m[3]), e = d(m[6], m[7], m[8]);
  return { s: s, e: e, st: t(m[4], m[5]), et: t(m[9], m[10]), part: !!days && Number(days[1]) === 0 && s === e };
}

function adminLeave_(sh, today) {
  var r = { total: 0, units: [], missing: !sh };
  if (!sh || sh.getLastRow() < 2) return r;
  var v = sh.getDataRange().getValues();
  var cU = adminCol_(v[0], ['單位']), cN = adminCol_(v[0], ['姓名']);
  var cF = adminCol_(v[0], ['表單', '假別']), cT = adminCol_(v[0], ['申請時間', '時間']);
  if (cU < 0) cU = 0; if (cN < 0) cN = 1; if (cF < 0) cF = 2; if (cT < 0) cT = 3;
  var by = {}, seen = {};
  for (var i = 1; i < v.length; i++) {
    var name = String(v[i][cN]).trim();
    if (!name || ADM_NOT_LEAVE_RE.test(String(v[i][cF]))) continue;
    var rg = adminParseRange_(v[i][cT]);
    if (!rg || today < rg.s || today > rg.e) continue;
    var unit = String(v[i][cU]).replace(/^同樂國小|^宜蘭縣員山鄉同樂國民小學/, '').trim() || '其他';
    var key = unit + '|' + name + '|' + rg.s + rg.st + rg.e + rg.et;
    if (seen[key]) continue;
    seen[key] = 1;
    (by[unit] = by[unit] || []).push({ n: name, t: rg.part ? rg.st + '–' + rg.et : '' });
  }
  var names = {};
  r.units = Object.keys(by).map(function (u) {
    var mine = {};
    by[u].forEach(function (p) { names[p.n] = 1; mine[p.n] = 1; });
    return { u: u, n: Object.keys(mine).length, people: by[u] };
  }).sort(function (a, b) { return b.n - a.n; });
  r.total = Object.keys(names).length;
  return r;
}
