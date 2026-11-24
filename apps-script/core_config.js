/**
 * core_config.js — shared constants.
 *
 * "core_*" files are plain scripts with no imports. The same files run in
 * three places: Google Apps Script (production), Node (poc/run_scenario.js)
 * and the browser simulator. Keep them free of any platform API.
 */
var CFG = {
  UNDO_WINDOW_MIN: 30,        // undo button works this long after a commit
  LAST_ITEM_TTL_SEC: 600,     // a scan stays "current" for voice notes this long
  STATE_TTL_SEC: 1800,        // multi-step flows (new item, credit, deposit) expire
  ADD_STATE_TTL_SEC: 600,     // a ➕ name prompt or a 🔢 account-number prompt left open (core_bot.js setState)
  RESTOCK_LOOP_TTL_SEC: 180,  // Telegram's ☰ 📦 restock loop (round 6b, G3): it ends 3 minutes after its last prompt
  CONFIRM_TTL_SEC: 1800,      // AI proposals waiting for a tap expire
  MIN_CONFIDENCE: 0.7,        // below this the bot shows buttons instead of a confirm screen
  LOW_STOCK_DEFAULT: 2,
  OVERDUE_DAYS: 30,           // credits older than this are flagged in the summary
  NOTEBOOK_MAX_LINES: 20,     // lines read from one notebook photo
  DEFAULT_PRICE_PRESETS: [10000, 15000, 20000, 25000, 30000],
  DEPOSIT_PRESETS: [50000, 100000, 200000, 300000],
  RESTOCK_PRESETS: [1, 5, 10, 20],
  SHOP_IDS: ['S1', 'S2'],
  SHOP_NAMES: { S1: 'ဆိုင် ၁', S2: 'ဆိုင် ၂' },
  // The owner's Shops screen (round 6, revision 3): the longest name, address and phone a shop_<field>_<id> Settings value
  // may hold when it is written by the app's `setting` entry (core_sync.js syncSettingReason). One row per CFG.SHOP_IDS.
  SHOP_TEXT_MAX: { name: 40, address: 80, phone: 40 },
  CATEGORIES: ['ထမီ', 'လုံချည်', 'အင်္ကျီ', 'ဝတ်စုံ', 'အခြား'],
  CATEGORY_EMOJI: { 'ထမီ': '👗', 'လုံချည်': '🧣', 'အင်္ကျီ': '👚', 'ဝတ်စုံ': '🧥', 'အခြား': '🧵' },
  // Item categories (round 6b, G2): the Lists tab's item_category list. Its five built-in rows (legacyListRows) carry
  // these fixed keys, parallel to CATEGORIES, so the Sheet's first seed, a phone's lists_json seed and the server's sync
  // seed agree on every device; listKeyFor never makes one of them. The row keyed 'other' is the catch-all: always
  // offered, always the last option, what a piece with no chosen category gets (core_ledger.js itemCategoryOptions).
  ITEM_CATEGORY_KEYS: ['htamein', 'longyi', 'eingyi', 'wutsone', 'other'],
  ITEM_CATEGORY_NEUTRAL: '🔖',   // Telegram's emoji of a category with no Detail and no built-in emoji
  // The sample (round 6b, G1): its own sign in Telegram (the toggle, the item card, the item rows); 🧵 stays the
  // catch-all category's emoji. A name containing SAMPLE_WORD is never an item category (a sample is the switch).
  SAMPLE_EMOJI: '🎨',
  SAMPLE_WORD: 'နမူနာ',
  TX: {
    SALE: 'SALE', RESTOCK: 'RESTOCK', RETURN: 'RETURN', EXPENSE: 'EXPENSE',
    TRANSFER_OUT: 'TRANSFER_OUT', TRANSFER_IN: 'TRANSFER_IN', ADJUST: 'ADJUST',
    PAYMENT: 'PAYMENT',                 // cash received later against a credit sale
    DEPOSIT: 'DEPOSIT',                 // cash received in advance for an order
    DEPOSIT_APPLIED: 'DEPOSIT_APPLIED', // a held deposit consumed by a sale (not cash)
    FEE: 'FEE'                          // cancellation fee of a custom order: Amount > 0, Cash 0, no stock; revenue, no receipt number
  },
  ITEM_TYPE: { UNIQUE: 'UNIQUE', SKU: 'SKU' },
  STATUS: { BLANK: 'BLANK', ACTIVE: 'ACTIVE', SOLD: 'SOLD' },
  SOURCE: { BUTTON: 'BUTTON', VOICE: 'VOICE', PHOTO: 'PHOTO', TEXT: 'TEXT', UNDO: 'UNDO', SYSTEM: 'SYSTEM', NOTEBOOK: 'NOTEBOOK', IMPORT: 'IMPORT' },
  INTENT: {
    SALE: 'SALE', RESTOCK: 'RESTOCK', RETURN: 'RETURN', EXPENSE: 'EXPENSE', TRANSFER: 'TRANSFER',
    PAYMENT: 'PAYMENT', DEPOSIT: 'DEPOSIT', QUERY: 'QUERY', NEW_ITEM_INFO: 'NEW_ITEM_INFO', UNKNOWN: 'UNKNOWN',
    METHOD: 'METHOD',                   // "how the last thing was paid" (Wave နဲ့ ပေးသွားတယ်), no amount, no item
    ORDER: 'ORDER'                      // a custom tailoring order (ဒေါ်မြင့် ဝမ်းဆက် တစ်ထည် အော်ဒါ): opens the new-order flow pre-filled
  },
  // Custom tailoring (plan 13.4, docs/design-round-2/design-B-tailoring.md with the critic's fixes).
  // Order ids continue each shop's paper voucher series: V1-2532 (shop 1), V2-0101 (shop 2); Settings order_next_no_S1/S2.
  // The delivery sale group and the deep link (/start V1-2532) carry the same id; a line is V1-2532-1.
  ORDER_STATUS: { ORDERED: 'ORDERED', CUTTING: 'CUTTING', SEWING: 'SEWING', READY: 'READY', DELIVERED: 'DELIVERED', CANCELLED: 'CANCELLED' },
  ORDER_FLOW: ['ORDERED', 'CUTTING', 'SEWING', 'READY'],   // forward only; DELIVERED and CANCELLED are terminal
  ORDER_STATUS_EMOJI: { ORDERED: '📝', CUTTING: '✂️', SEWING: '🧵', READY: '✅', DELIVERED: '🚚', CANCELLED: '✖️' },
  DUE_PRESETS: [7, 14, 21, 30],       // Settings due_presets overrides
  ORDER_REMIND_DAYS: 3,               // Settings order_remind_days: the 21:00 summary lists orders due within this many days
  FABRIC_PRESETS: ['ပိုး', 'ချည်', 'ပုဝါ'],   // Settings fabric_presets overrides
  ORDERS_PAGE: 8,                     // open orders listed per page
  ORDER_DESIGN_BUTTONS: 6,            // designs offered as buttons on the new-order screen
  MEAS_SOURCE: { CHAT: 'CHAT', PHOTO: 'PHOTO', COPY: 'COPY', FORM: 'FORM' },
  MEAS_GROUPS: ['upper', 'sleeve', 'waist_hip', 'skirt', 'trouser', 'general'],   // Burmese titles: Messages mg_<group>
  // The one notes field of a session (round 6, revision 3): the MeasureFields row with this key holds up to MEAS_NOTE_MAX
  // characters on the phone and on the server (every other value keeps SYNC.MEAS_VALUE_MAX).
  MEAS_NOTE_KEY: 'note',
  MEAS_NOTE_MAX: 300,
  // The unified measurement form (docs/design-round-2/forms-extraction.md): the 31 value cells of the printed
  // sheet plus the margin note. Seeded into the MeasureFields tab, where the family renames, reorders or hides
  // fields; the key never changes once used (it is the Measurements column header). Multi = number of
  // slash-separated values written in one cell (လက်ဝ 36/30/20). Type text = not a number (ထမိန် ဘယ်/ညာ).
  // The design code or photo of a line lives on the order (OrderItems.DesignCode, Designs.PhotoURL), not here.
  MEASURE_FIELDS: [
    ['neck', 'လည်ပင်း', 'Neck', 'upper', 1, 'number'],
    ['shoulder', 'ပုခုံး', 'Shoulder width', 'upper', 1, 'number'],
    ['chest_width', 'ရင်ကျယ်', 'Front chest width', 'upper', 1, 'number'],
    ['back_width', 'ကျောကျယ်', 'Back width', 'upper', 1, 'number'],
    ['over_bust', 'ရင်ပေါ်ပတ်လည်', 'Over-bust circumference', 'upper', 1, 'number'],
    ['bust', 'ရင်', 'Bust', 'upper', 1, 'number'],
    ['under_bust', 'ရင်အောက်ပတ်လည်', 'Under-bust circumference', 'upper', 1, 'number'],
    ['bust_height', 'ရင်မြင့်', 'Bust height (shoulder to bust point)', 'upper', 1, 'number'],
    ['bust_distance', 'ရင်ကွာ', 'Bust point distance', 'upper', 1, 'number'],
    ['armhole', 'ချိုင်း', 'Armhole', 'upper', 1, 'number'],
    ['upper_arm', 'လက်မောင်းရင်း', 'Upper arm (at arm root)', 'sleeve', 1, 'number'],
    ['elbow', 'တံတောင်ဆစ်', 'Elbow circumference', 'sleeve', 1, 'number'],
    ['sleeve_round', 'လက်ဝ', 'Sleeve round (3 values: upper / elbow / wrist)', 'sleeve', 3, 'number'],
    ['sleeve_length', 'လက်အရှည်', 'Sleeve length (3 values: short / elbow / full)', 'sleeve', 3, 'number'],
    ['waist_drop', 'ခါးအကျ', 'Waist drop (shoulder to waist)', 'waist_hip', 1, 'number'],
    ['waist', 'ခါး', 'Waist', 'waist_hip', 1, 'number'],
    ['hip_drop', 'တင်အကျ', 'Hip drop (waist to hip)', 'waist_hip', 1, 'number'],
    ['high_hip', 'တင်သေး', 'High hip (small hip)', 'waist_hip', 1, 'number'],
    ['hip', 'တင်ကြီး', 'Full hip', 'waist_hip', 1, 'number'],
    ['body_length', 'ကိုယ်အရှည်', 'Body / blouse length', 'waist_hip', 1, 'number'],
    ['front_length', 'ရှေ့ကိုယ်အရှည်', 'Front body length', 'waist_hip', 1, 'number'],
    ['back_length', 'နောက်ကိုယ်အရှည်', 'Back body length', 'waist_hip', 1, 'number'],
    ['htamein_length', 'ထမိန်အရှည်', 'Htamein (skirt) length', 'skirt', 1, 'number'],
    ['htamein_side', 'ထမိန် ဘယ်/ညာ', 'Htamein opening side (left / right)', 'skirt', 1, 'text'],
    ['htamein_style', 'ထမိန် အမျိုးအစား', 'Htamein type / style', 'skirt', 1, 'text'],
    ['trouser_round', 'ဘောင်းဘီ ဝ', 'Trouser round (girth)', 'trouser', 1, 'number'],
    ['thigh', 'ပေါင်ရင်း', 'Thigh', 'trouser', 1, 'number'],
    ['waist_to_knee', 'ခါးမှဒူး', 'Waist to knee', 'trouser', 1, 'number'],
    ['knee', 'ဒူး', 'Knee', 'trouser', 1, 'number'],
    ['trouser_length', 'ဘောင်းဘီ အရှည်', 'Trouser length', 'trouser', 1, 'number'],
    ['leg_opening', 'ခြေဝ', 'Leg opening / ankle', 'trouser', 1, 'number'],
    ['note', 'မှတ်ချက်', 'Fitting note (margin notes such as "No Bra", "109")', 'general', 1, 'text']
  ],
  // Payment methods (Ledger.Method). The pay_method rows of the Lists tab are the accounts once the tab has rows
  // (LIST_NAMES below); on a sheet without them Settings pay_methods overrides this list. CASH always comes first.
  METHOD: { CASH: 'CASH', KBZ: 'KBZ', WAVE: 'WAVE', BANK: 'BANK' },
  DEFAULT_PAY_METHODS: ['CASH', 'KBZ', 'WAVE', 'BANK'],
  // A method key rides inside callback data (PM|<36-char group id>|<KEY> = 40 bytes + key, Telegram allows 64):
  // keys longer than this are dropped from the 🏦 buttons and logged (payMethods). Labels live in Messages method_<KEY>.
  METHOD_KEY_MAX_BYTES: 12,
  // Expense categories (Ledger.Category keys). Settings expense_categories = "key:label,..." overrides.
  // Keys are ASCII and stored; labels are shown and may be renamed without touching history.
  EXPENSE_CATEGORIES: [['fabric', 'အထည်ဖိုး'], ['thread', 'ချည်ဖိုး'], ['labour', 'လက်ခ'], ['transport', 'ကားခ'],
                       ['phone', 'ဖုန်းဘေလ်'], ['food', 'ထမင်းဖိုး'], ['electric', 'မီးဖိုး'], ['rent', 'ဆိုင်ခ'], ['other', 'အခြား']],
  EXPENSE_EMOJI: { fabric: '🧵', thread: '🪡', labour: '✂️', transport: '🚕', phone: '📱', food: '🍚', electric: '💡', rent: '🏠', other: '📦' },
  EXPENSE_PRESETS: [5000, 10000, 20000, 30000, 50000],   // Settings expense_presets overrides
  QTY_GRID: [2, 3, 4, 5, 6, 7, 8, 9],                   // the 🔢 quantity grid on SKU cards; "type it" covers the rest
  MAX_SALE_QTY: 999,
  BASKET_MAX_LINES: 10,            // the lines of one sale or one restock (round 6: commitBasket, commitRestockGroup)
  BASKET_NAME_MAX: 24,             // an item name on the Telegram review card and in basket_name
  // Settings sale_flow = form (the app's forms and the Telegram review card) or quick (the one-tap card with the
  // corrective buttons); saleFlow(ports) reads it on every tap.
  SALE_FLOW: { FORM: 'form', QUICK: 'quick' },
  SALE_DUE_PRESETS: [7, 14, 30],   // Settings sale_due_presets overrides: the day buttons of "when is the rest paid"
  SALE_DUE_MAX_DAYS: 365,          // the farthest promised date a seller may type
  MAX_BANK_BUTTONS: 12,       // 🏦 buttons under a reply (one per non-cash account); the method rows wrap, the rest is dropped and logged
  // Option lists (round 4): the Lists tab holds one row per option the buttons offer. Four lists: the bank and
  // wallet accounts (pay_method, the keys of Ledger.Method), the expense categories (keys of Ledger.Category), the
  // fabrics and (round 6b, G2) the item categories (item_category: the item stores the row's NAME, as before). A sheet
  // without the tab reads the Settings rows above as before (core_ledger.js legacyListRows). item_category is LAST, so
  // the first seed of the Lists tab writes its five built-in rows after the three round-4 lists.
  LIST_NAMES: ['pay_method', 'expense_category', 'fabric', 'item_category'],
  LIST_CODES: { pm: 'pay_method', ec: 'expense_category', fb: 'fabric', ic: 'item_category' },   // short codes inside callback data
  LIST_PREFIX: { pay_method: 'B', expense_category: 'c', fabric: 'f', item_category: 'i' },     // first letter of a generated key without one
  // Kind (round 5): 'wallet' or 'bank' on a pay_method row (the guided sale lists wallets by name and offers one
  // 🏛 ဘဏ် button for the banks). A blank Kind is a wallet; the legacy BANK key is a bank by name (core_ledger.js methodKind).
  LIST_COLS: ['List', 'Key', 'Label', 'Active', 'Order', 'Shop', 'Detail', 'Note', 'Kind'],
  LIST_KINDS: ['wallet', 'bank'],
  LIST_KEY_MAX_BYTES: 12,     // same limit as METHOD_KEY_MAX_BYTES: a method key rides in PM|<uuid>|<KEY>
  LIST_LABEL_MAX: 40,
  LIST_DETAIL_MAX: 80,        // account number and holder (pay_method), emoji (expense_category, item_category)
  CUST_MENU_RECENT: 6,        // customers listed under 👤 ဝယ်သူများ
  CUST_HISTORY_LINES: 8,      // ledger lines on a customer card
  CUST_NAME_MAX: 60,          // a buyer's name as the app's buyer form stores it (commitCustomer)
  CUST_NOTE_MAX: 100,         // a buyer's note, the same
  // Row types a rewrite (mirror + replacement in the same group) may touch.
  REWRITABLE_TX: { SALE: 1, RETURN: 1, PAYMENT: 1, DEPOSIT: 1, EXPENSE: 1 },
  // Column order of the tabs. gas_store.js, gas_setup.js and the simulator all follow this.
  ITEM_COLS: ['ItemID', 'Shop', 'Name', 'Category', 'Type', 'Price', 'Cost', 'PhotoURL', 'PhotoFileID',
              'Status', 'Stock', 'CreatedAt', 'CreatedBy', 'Sample', 'Alias', 'Rev', 'UpdatedAt'],
  // Cash = signed money that actually moved on this row. Amount = value of the event.
  // SALE: Amount = price x qty, Cash = paid now. PAYMENT/DEPOSIT: both = cash received.
  // DEPOSIT_APPLIED: Amount = deposit consumed, Cash = 0. EXPENSE: both negative.
  // Method = how the cash moved (CASH, KBZ, WAVE, BANK). Category = expense category key.
  // Seq, ReceivedAt, DeviceID = stamped by the server when a row arrives (sync). ReceiptNo = R1-A-000231 on SALE rows.
  // DueDay (round 5, the 27th and last column) = yyyy-mm-dd text on the SALE row of a group that still owes at commit
  // time and whose seller chose a date; '' otherwise (full payment, "not sure", every other row type, mirrors, old rows).
  // Last is the only safe place: both Sheet writers are positional by this order and ensureColumns appends at the end.
  LEDGER_COLS: ['TxID', 'GroupID', 'Time', 'Day', 'Shop', 'ItemID', 'Type', 'Qty', 'UnitPrice', 'Amount', 'Cash',
                'CostAtSale', 'CustomerID', 'RefGroupID', 'Note', 'Source', 'Transcript', 'StaffID', 'UpdateID', 'ReversesTxID',
                'Method', 'Category', 'Seq', 'ReceivedAt', 'DeviceID', 'ReceiptNo', 'DueDay'],
  STAFF_COLS: ['TelegramUserID', 'Name', 'DefaultShop', 'Role', 'Active'],
  ERROR_COLS: ['Time', 'Where', 'Message', 'UpdateID', 'Payload'],
  // Columns F:K of Customers are a view the script rewrites; Rev/UpdatedAt are for sync.
  CUSTOMER_COLS: ['CustomerID', 'Name', 'Phone', 'Note', 'CreatedAt', 'Bought', 'Paid', 'Owed', 'DepositHeld', 'LastVisit', 'Visits', 'Rev', 'UpdatedAt'],
  // Sync tabs (section 14 of the plan).
  DEVICE_COLS: ['DeviceID', 'TokenHash', 'StaffID', 'Shop', 'Role', 'Label', 'Platform', 'Status', 'CreatedAt', 'LastSeen',
                'AppVersion', 'PendingCount', 'ReceiptLetter', 'EnrollCodeHash', 'EnrollExpires', 'Note'],
  SYNCLOG_COLS: ['Time', 'DeviceID', 'Transport', 'RowsPushed', 'RowsPulled', 'DurationMs', 'Result', 'AppVersion', 'Note'],
  QUARANTINE_COLS: ['Time', 'DeviceID', 'GroupID', 'Reason', 'RowsJSON'],
  AIJOB_COLS: ['JobID', 'DeviceID', 'Kind', 'Status', 'ResultJSON', 'Error', 'CreatedAt', 'DoneAt', 'ItemID'],
  // Custom tailoring tabs. Orders and OrderItems are updated in place like Items (status, dates, tag);
  // money is never stored on them (orderMoney computes it from the ledger). Measurements: the fixed
  // columns, then one column per MeasureFields.Key, every value kept as TEXT ('36/30/20', '17.5', '7/3/20').
  ORDER_COLS: ['OrderID', 'Shop', 'CustomerID', 'OrderedDay', 'DueDay', 'DeliveredDay', 'Status', 'StatusAt', 'StatusBy', 'Total',
               'MeasID', 'Notes', 'CreatedBy', 'CreatedAt', 'VoucherSentAt', 'CancelNote', 'PrevStatus'],
  ORDER_ITEM_COLS: ['OrderID', 'Line', 'DesignCode', 'Fabric', 'Description', 'Qty', 'UnitPrice', 'Amount', 'Cost', 'ItemID'],
  // EntryID: the phone's outbox entry a FORM session came from (blank for a Telegram session). The sync server answers a
  // resent entry dup by it (core_sync.js syncApplyMeasurementEntry); on a sheet set up before it, it is appended at the end.
  // Sketch (round 6, revision 3): the session's drawing on the front-view figure ('1F:<strokes>'), blank without one; it
  // is appended at the end on a tab set up before it, and never read as a measurement field.
  MEAS_FIXED_COLS: ['MeasID', 'CustomerID', 'OrderID', 'Day', 'StaffID', 'Source', 'PhotoURL', 'Notes', 'EntryID', 'Sketch'],
  MEAS_FIELD_COLS: ['Key', 'LabelMy', 'LabelEn', 'Group', 'Multi', 'Type', 'Order', 'Active'],
  DESIGN_COLS: ['DesignCode', 'Name', 'Category', 'PhotoURL', 'PhotoFileID', 'BasePrice', 'DaysToMake', 'Active', 'Note'],
  // Credits and Deposits are views the script rewrites after every credit-related ledger write.
  // DueDay = the promised date of the SALE row ('' when none); Overdue = past DueDay, or past OVERDUE_DAYS when undated (creditOverdue).
  CREDIT_COLS: ['GroupID', 'Day', 'Shop', 'CustomerID', 'Customer', 'ItemID', 'Item', 'Total', 'Cash', 'Payments', 'DepositUsed', 'Owed', 'Days', 'DueDay', 'Overdue'],
  // Earmarked = the part of Held that belongs to open vouchers ("V1-2532: 100,000"); the rest is the customer's free pool.
  DEPOSIT_COLS: ['CustomerID', 'Customer', 'Received', 'Used', 'Held', 'LastDay', 'Earmarked'],
  IMPORT_COLS: ['Code', 'Name', 'Category', 'Type', 'Price', 'Cost', 'Stock', 'Shop']
};

/** Column letter for a header name, for Sheet formulas: colLetter(CFG.LEDGER_COLS, 'Amount') -> 'J'. */
function colLetter(cols, name) {
  var i = cols.indexOf(name);
  if (i < 0) throw new Error('No column ' + name);
  var s = '';
  i += 1;
  while (i > 0) {
    var m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function shopName(ports, shopId) {
  var v = ports.store.getSetting('shop_name_' + shopId, null);
  return v || CFG.SHOP_NAMES[shopId] || shopId;
}

function otherShop(shopId) {
  return shopId === 'S1' ? 'S2' : 'S1';
}

function categoryEmoji(category) {
  return CFG.CATEGORY_EMOJI[category] || '🧵';
}

function settingOn(ports, key) {
  var v = ports.store.getSetting(key, false);
  return v === true || v === 1 || String(v).toUpperCase() === 'TRUE' || String(v) === '1';
}

/**
 * Settings ai (round 6, revision 3): the owner's one AI switch for every phone and the bot. A missing row reads ON
 * (today's behaviour); FALSE, 0, OFF or NO in any case (or the boolean false, the number 0) reads OFF. Never cached.
 */
function aiOn(ports) {
  var v = ports.store.getSetting('ai', true);
  return !(v === false || v === 0 || /^\s*(FALSE|0|OFF|NO)\s*$/i.test(String(v)));
}

/**
 * Settings sale_flow: 'quick' when the value is the word quick in any case, else 'form' (the default; round 5's steps
 * reads as form). Never cached.
 */
function saleFlow(ports) {
  return String(ports.store.getSetting('sale_flow', CFG.SALE_FLOW.FORM) || '').trim().toLowerCase() === CFG.SALE_FLOW.QUICK ? CFG.SALE_FLOW.QUICK : CFG.SALE_FLOW.FORM;
}

/* ------------------------------ custom orders: id helpers ------------------------------ */

/** 'V1-2532' (shop digit, dash, the voucher number of that shop's paper series). */
function isOrderId(s) { return /^V\d+-\d{1,8}$/.test(String(s || '')); }

/** 'V1-2532-1': a voucher line, used as the ledger ItemID when no tag is attached and as the tag's Alias when one is. */
function isOrderLineId(s) { return /^V\d+-\d{1,8}-\d{1,3}$/.test(String(s || '')); }

function orderIdOfLine(lineId) {
  var m = String(lineId || '').match(/^(V\d+-\d{1,8})-\d{1,3}$/);
  return m ? m[1] : null;
}

/** The voucher number the family knows (2532) from the id V1-2532. */
function orderNo(orderId) {
  var m = String(orderId || '').match(/^V\d+-(\d+)$/);
  return m ? String(Number(m[1])) : String(orderId || '');
}

/** Shop of an order id: V1-... -> S1. */
function orderShop(orderId) {
  var m = String(orderId || '').match(/^V(\d+)-/);
  return m ? 'S' + m[1] : '';
}

/** The id of voucher number n of a shop's series: orderIdFor('S1', 2532) -> 'V1-2532', orderIdFor('S2', 101) -> 'V2-0101'. */
function orderIdFor(shop, n) {
  var no = Math.round(Number(n)) || 0;
  return 'V' + String(shop || '').replace(/\D/g, '') + '-' + (no < 10000 ? ('0000' + no).slice(-4) : String(no));
}

/**
 * 'tsl 18', 'TSL-0018', 'tsl18' all become 'TSL-18'; digits alone become '-18'. '' when there is nothing to match.
 * Here (not in core_orders.js) because both stores match design aliases with it in getDesign.
 */
function normDesignCode(code) {
  var s = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  var m = s.match(/^([A-Z]*)(\d*)$/);
  if (!m || (!m[1] && !m[2])) return '';
  return m[1] + '-' + (m[2] ? String(Number(m[2])) : '');
}

function shopRegistry(ports) {
  var raw = ports.store.getSetting && ports.store.getSetting('shop_registry', '');
  if (typeof raw === 'string' && /^\[/.test(raw)) return JSON.parse(raw);
  return ['S1', 'S2'].map(function (id) { return { id: id, active: true }; });
}

/** Called at each request and app render, after the local Settings mirror is available. */
function loadShopRegistry(ports) {
  if (!ports || !ports.store || !ports.store.getSetting) return;
  var raw = ports.store.getSetting('shop_registry', '');
  if ((typeof raw !== 'string' || !/^\[/.test(raw)) && !CFG.registryLoaded) return;
  CFG.SHOP_IDS = shopRegistry(ports).map(function (s) { return s.id; });
  CFG.registryLoaded = !!raw;
}

function activeShopIds(ports) {
  return shopRegistry(ports).filter(function (s) { return s.active; }).map(function (s) { return s.id; });
}

function officeRole(role) {
  return !!role && role !== 'owner' && String(role).split('+').indexOf('staff') < 0;
}

function hasJob(staff, job) {
  return !!staff && (staff.role === 'owner' || String(staff.role).split('+').indexOf(job) >= 0);
}
function staffShops(staff) {
  return staff.role === 'owner' ? CFG.SHOP_IDS.slice() : (staff.shops && staff.shops.length ? staff.shops.slice() : [staff.shop]);
}

// A phone may deliver a saved entry after its shop has closed.
function shopAcceptsEntry(ports, id, time) {
  return !shopRegistry(ports).some(function (s) {
    return s.id === id && !s.active && (!s.closedAt || !time || new Date(time).getTime() >= new Date(s.closedAt).getTime());
  });
}
