/**
 * gas_import.js — one-time import of the product list from the old software.
 *
 * 1. Export the product list from the current POS as Excel or CSV.
 * 2. Paste it into the "Import" tab under the headers:
 *    Code | Name | Category | Type | Price | Cost | Stock | Shop
 *    Type is UNIQUE or SKU (blank = SKU). Shop is S1 or S2. Category: a name of the Lists tab's item_category (a
 *    built-in's old name finds its row); another name becomes the catch-all.
 * 3. Run importProductsFromSheet() from the editor. The log shows what was imported and skipped.
 *
 * Codes that already match a blank tag id (S1-0042) are used directly; any other code
 * becomes the Alias of the next blank tag in that shop, so the old code still finds the item.
 */
function importProductsFromSheet() {
  var rows = gasTable('Import').map(function (o) {
    return { Code: o.Code, Name: o.Name, Category: o.Category, Type: o.Type, Price: o.Price, Cost: o.Cost, Stock: o.Stock, Shop: o.Shop };
  });
  if (!rows.length) { Logger.log('Import tab is empty.'); return; }
  var owner = gasStore.listStaff().filter(function (s) { return s.role === 'owner'; })[0] || { id: 'import', name: 'import', shop: 'S1', role: 'owner' };
  var result = importProducts(buildPorts(), rows, owner);
  Logger.log('Imported ' + result.done.length + ', skipped ' + result.skipped.length);
  result.done.forEach(function (d) { Logger.log('  ' + d.code + ' -> ' + d.id + (d.alias ? ' (alias ' + d.alias + ')' : '') + ' stock ' + d.stock); });
  result.skipped.forEach(function (s) { Logger.log('  skipped ' + s.code + ': ' + s.reason); });
}
