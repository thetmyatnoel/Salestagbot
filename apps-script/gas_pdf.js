/**
 * gas_pdf.js — turns a report (core_report.js) into a PDF blob.
 * Writes the report into the hidden "Print" tab, exports that tab as A4 PDF
 * through the Sheets export endpoint, and returns the blob for Telegram.
 * Burmese text relies on the export's font handling; check the first real
 * PDF on a phone and switch the font below if any glyphs are missing.
 * Round 6, revision 3: a report with an image (the measurement PDF of a session with a drawing: report.image = {url,
 * caption}, core_orders.js measurementReport) ends with a caption row and GAS_PDF_IMAGE_ROWS blank rows that the
 * picture covers (240 x 360 px at the default row height, so the export's print range takes it in); the Drive file of
 * the URL is placed over them before the flush. A picture that cannot be fetched is one Errors row (pdf_image) and the
 * PDF prints without it. The Print tab's earlier pictures are removed first (clear() keeps over-grid images).
 */
var GAS_PDF_IMAGE_ROWS = 18;
var GAS_PDF_IMAGE_SIZE = { width: 240, height: 360 };

var gasPdf = {
  make: function (report) {
    var ss = gasSpreadsheet();
    var sh = ss.getSheetByName('Print') || ss.insertSheet('Print');
    sh.clear();
    sh.getImages().forEach(function (im) { im.remove(); });
    var rows = [], bold = [], numberRows = [];
    rows.push([report.title]); bold.push(rows.length);
    if (report.subtitle) rows.push([report.subtitle]);
    (report.sections || []).forEach(function (sec) {
      rows.push(['']);
      if (sec.heading) { rows.push([sec.heading]); bold.push(rows.length); }
      rows.push(sec.columns.slice()); bold.push(rows.length);
      sec.rows.forEach(function (r) { rows.push(r.slice()); numberRows.push(rows.length); });
      (sec.totals || []).forEach(function (r) { rows.push(r.slice()); bold.push(rows.length); numberRows.push(rows.length); });
    });
    if (report.footer) { rows.push(['']); rows.push([report.footer]); }
    var imageRow = 0;
    if (report.image && report.image.url) {
      rows.push(['']);
      rows.push([report.image.caption || '']); bold.push(rows.length);
      imageRow = rows.length + 1;
      for (var b = 0; b < GAS_PDF_IMAGE_ROWS; b++) rows.push(['']);
    }
    var width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, 1);
    var padded = rows.map(function (r) { while (r.length < width) r.push(''); return r; });
    var range = sh.getRange(1, 1, padded.length, width);
    range.setValues(padded);
    range.setFontFamily('Noto Sans Myanmar');
    range.setFontSize(10);
    range.setVerticalAlignment('top');
    sh.getRange(1, 1).setFontSize(14);
    bold.forEach(function (r) { sh.getRange(r, 1, 1, width).setFontWeight('bold'); });
    numberRows.forEach(function (r) { sh.getRange(r, 1, 1, width).setNumberFormat('#,##0'); });
    sh.autoResizeColumns(1, width);
    if (imageRow) {
      try {
        var id = /[-\w]{25,}/.exec(String(report.image.url));
        if (!id) throw new Error('no Drive file id in ' + report.image.url);
        sh.insertImage(DriveApp.getFileById(id[0]).getBlob(), 1, imageRow).setWidth(GAS_PDF_IMAGE_SIZE.width).setHeight(GAS_PDF_IMAGE_SIZE.height);
      } catch (err) {
        try { gasStore.logError('pdf_image', err, '', String(report.image.url)); } catch (ignore) {}
      }
    }
    SpreadsheetApp.flush();

    var url = ss.getUrl().replace(/\/edit.*$/, '') + '/export?format=pdf&gid=' + sh.getSheetId() +
      '&size=A4&portrait=true&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenum=UNDEFINED&fzr=false' +
      '&top_margin=0.5&bottom_margin=0.5&left_margin=0.5&right_margin=0.5';
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('PDF export ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
    return res.getBlob().setName((report.fileName || 'report') + '.pdf').setContentType('application/pdf');
  }
};

/** Manual check from the editor: builds this month's PDF and saves it to Drive. */
function previewMonthlyPdf() {
  var ports = buildPorts();
  var blob = gasPdf.make(buildReport(ports, 'month', { shop: null, now: new Date() }));
  var file = DriveApp.createFile(blob);
  Logger.log('Saved ' + file.getName() + ' at ' + file.getUrl());
}
