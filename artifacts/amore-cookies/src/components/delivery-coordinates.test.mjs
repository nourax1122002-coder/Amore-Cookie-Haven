import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoordinate } from './delivery-coordinates.ts';

test('manual latitude and longitude accept finite values including explicit zero and boundaries', () => {
  for (const [raw, kind, expected] of [['29.3759','lat',29.3759],['47.9774','lng',47.9774],
    ['0','lat',0],['-90','lat',-90],['180','lng',180],[' +10.5 ','lng',10.5]]) {
    assert.equal(parseCoordinate(raw, kind), expected);
  }
});
test('Arabic and Persian digits can be entered without changing geographic meaning', () => {
  assert.equal(parseCoordinate('٢٩٫٣٧٥٩','lat'),29.3759);
  assert.equal(parseCoordinate('۴۷.۹۷۷۴','lng'),47.9774);
});
test('blank, malformed and out-of-range values never become an assumed point', () => {
  for (const raw of ['', ' ', 'NaN', 'Infinity', '1e2', '--1', '<script>', '29,4', '91','-91']) {
    assert.equal(parseCoordinate(raw,'lat'),null,raw);
  }
  assert.equal(parseCoordinate('181','lng'),null);
  assert.equal(parseCoordinate('-181','lng'),null);
});
