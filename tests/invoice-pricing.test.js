'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pricing = require('../lib/pricing');
const tax = require('../lib/tax');
const invoice = require('../lib/invoice');
const reports = require('../lib/reports');

test('Order totals use HSN rates and apply coupon discount before GST', function () {
  const result = pricing.computeTotals([
    { id: 1, name: 'Rice', hsn: '1006', price: 200, qty: 1 },
    { id: 2, name: 'Tea', hsn: '0902', price: 100, qty: 1 }
  ], 'WELCOME');

  assert.deepEqual({
    subtotal: result.subtotal,
    discount: result.discount,
    taxable: result.taxable,
    tax: result.tax,
    cgst: result.cgst,
    sgst: result.sgst,
    total: result.total
  }, {
    subtotal: 300,
    discount: 15,
    taxable: 285,
    tax: 26.6,
    cgst: 13.3,
    sgst: 13.3,
    total: 311.6
  });
  assert.deepEqual(result.lines.map(function (line) {
    return [line.gstPercent, line.discount, line.taxable, line.tax];
  }), [[5, 10, 190, 9.5], [18, 5, 95, 17.1]]);
});

test('Invoice figures match the billed HSN GST, coupon discount, and total', function () {
  const items = [
    { id: 1, name: 'Rice', hsn: '1006', price: 200, qty: 1 },
    { id: 2, name: 'Tea', hsn: '0902', price: 100, qty: 1 }
  ];
  const billed = pricing.computeTotals(items, 'WELCOME');
  const order = { coupon: 'WELCOME', items: items };
  const invoiced = invoice.computeInvoiceFigures(order);

  assert.deepEqual({
    subtotal: invoiced.subtotal,
    discount: invoiced.discount,
    tax: invoiced.tax,
    cgst: invoiced.cgst,
    sgst: invoiced.sgst,
    total: invoiced.total
  }, {
    subtotal: billed.subtotal,
    discount: billed.discount,
    tax: billed.tax,
    cgst: billed.cgst,
    sgst: billed.sgst,
    total: billed.total
  });
  assert.deepEqual(invoiced.rows.map(function (row) {
    return [row.gstPercent, row.lineTax];
  }), [[5, 9.5], [18, 17.1]]);

  const html = invoice.render(order);
  assert.match(html, /<td>CGST<\/td><td class="r">[^0-9]*13\.30/);
  assert.match(html, /<td>SGST<\/td><td class="r">[^0-9]*13\.30/);
});

test('Invoice SAVE10 discount, HSN GST, and total match the billed capped discount', function () {
  const items = [{ id: 5, name: 'Groundnut Oil', hsn: '1508', price: 1120, qty: 2 }];
  const billed = pricing.computeTotals(items, 'SAVE10');
  const invoiced = invoice.computeInvoiceFigures({ coupon: 'SAVE10', items: items });

  assert.deepEqual([billed.discount, billed.tax, billed.total], [150, 104.5, 2194.5]);
  assert.deepEqual([invoiced.discount, invoiced.tax, invoiced.total], [billed.discount, billed.tax, billed.total]);
  assert.deepEqual(invoiced.rows.map(function (row) {
    return [row.gstPercent, row.lineTax];
  }), [[5, 104.5]]);
});

test('Invoice and order totals interpret decimal gstRate consistently', function () {
  const item = { name: 'Rate override', gstRate: 0.05, price: 100, qty: 1 };

  assert.equal(tax.getRateForItem(item), 0.05);
  assert.deepEqual(pricing.computeTotals([item], '').lines.map(function (line) {
    return [line.gstPercent, line.tax];
  }), [[5, 5]]);
  const invoiced = invoice.computeInvoiceFigures({ items: [item] });
  assert.deepEqual(invoiced.rows.map(function (row) {
    return [row.gstPercent, row.lineTax];
  }), [[5, 5]]);
  assert.equal(invoiced.total, 105);
});

test('CURRENT BEHAVIOUR: GST split rounds half up and puts the remainder in SGST', function () {
  assert.deepEqual(tax.splitCgstSgst(0.05), { cgst: 0.03, sgst: 0.02 });
});

test('GST reconciliation matches billed figures and skips cancelled orders', function () {
  const db = {
    orders: [
      {
        id: 44,
        date: '01/02/2022',
        customer: 'In-memory customer',
        coupon: 'SAVE10',
        status: 'completed',
        subtotal: 2240,
        discount: 150,
        tax: 104.5,
        total: 2194.5,
        items: [{ id: 5, name: 'Groundnut Oil', hsn: '1508', price: 1120, qty: 2 }]
      },
      {
        id: 45,
        status: 'cancelled',
        subtotal: 0,
        discount: 0,
        tax: 0,
        total: 0,
        items: []
      }
    ]
  };

  const result = reports.getGstReconciliation(db);

  assert.equal(result.totalChecked, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.totalDelta, 0);
  assert.deepEqual({
    invoiceTax: result.rows[0].invoiceTax,
    ledgerTax: result.rows[0].ledgerTax,
    invoiceTotal: result.rows[0].invoiceTotal,
    ledgerTotal: result.rows[0].ledgerTotal,
    delta: result.rows[0].delta,
    matched: result.rows[0].matched
  }, {
    invoiceTax: 104.5,
    ledgerTax: 104.5,
    invoiceTotal: 2194.5,
    ledgerTotal: 2194.5,
    delta: 0,
    matched: true
  });
});
