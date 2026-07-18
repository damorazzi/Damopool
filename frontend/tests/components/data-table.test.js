import test from "node:test";
import assert from "node:assert/strict";
import { dataTableSpec } from "../../src/components/data-table.js";

const COLUMNS = [
  { key: "window", label: "Window" },
  { key: "accepted", label: "Accepted", align: "right" },
  { key: "avgSdiff", label: "Avg Sdiff", align: "right" },
];

const ROWS = [
  { window: "15 min", accepted: "10", avgSdiff: "100.00" },
  { window: "1 hour", accepted: "40", avgSdiff: "120.00" },
];

test("dataTableSpec", async (t) => {
  await t.test("wraps a table in a keyboard-reachable, labelled scroll region", () => {
    const spec = dataTableSpec({ caption: "Rolling windows", columns: COLUMNS, rows: ROWS });
    assert.equal(spec.className, "data-table-wrap");
    assert.equal(spec.attrs.role, "region");
    assert.equal(spec.attrs.tabindex, "0");
    assert.equal(spec.attrs["aria-label"], "Rolling windows");
    const table = spec.children[0];
    assert.equal(table.tag, "table");
    assert.equal(table.className, "data-table");
    assert.equal(table.attrs.role, "table");
  });

  await t.test("the wrap region falls back to a generic aria-label when no caption is given", () => {
    const spec = dataTableSpec({ columns: COLUMNS, rows: ROWS });
    assert.equal(spec.attrs["aria-label"], "Data table");
  });

  await t.test("explicit table/rowgroup/row roles survive regardless of the responsive CSS display override", () => {
    const spec = dataTableSpec({ columns: COLUMNS, rows: ROWS });
    const table = spec.children[0];
    const thead = table.children.find((c) => c.tag === "thead");
    const tbody = table.children.find((c) => c.tag === "tbody");
    assert.equal(thead.attrs.role, "rowgroup");
    assert.equal(tbody.attrs.role, "rowgroup");
    assert.equal(thead.children[0].attrs.role, "row");
    assert.equal(tbody.children[0].attrs.role, "row");
  });

  await t.test("renders a visually-hidden caption when provided, none when omitted", () => {
    const withCaption = dataTableSpec({ caption: "Rolling windows", columns: COLUMNS, rows: ROWS });
    const table = withCaption.children[0];
    assert.equal(table.children[0].tag, "caption");
    assert.equal(table.children[0].className, "visually-hidden");
    assert.equal(table.children[0].text, "Rolling windows");

    const withoutCaption = dataTableSpec({ columns: COLUMNS, rows: ROWS });
    const table2 = withoutCaption.children[0];
    assert.equal(table2.children[0].tag, "thead");
  });

  await t.test("header row has one <th scope=col> per column, with align modifier on right-aligned columns", () => {
    const spec = dataTableSpec({ columns: COLUMNS, rows: ROWS });
    const table = spec.children[0];
    const thead = table.children.find((c) => c.tag === "thead");
    const headerCells = thead.children[0].children;

    assert.equal(headerCells.length, 3);
    assert.equal(headerCells[0].attrs.scope, "col");
    assert.equal(headerCells[0].attrs.role, "columnheader");
    assert.equal(headerCells[0].className, "data-table__h");
    assert.equal(headerCells[0].text, "Window");
    assert.equal(headerCells[1].className, "data-table__h data-table__h--right");
  });

  await t.test("body has one row per data row, one cell per column, each cell carrying its own data-label", () => {
    const spec = dataTableSpec({ columns: COLUMNS, rows: ROWS });
    const table = spec.children[0];
    const tbody = table.children.find((c) => c.tag === "tbody");

    assert.equal(tbody.children.length, 2);
    const firstRowCells = tbody.children[0].children;
    assert.equal(firstRowCells.length, 3);
    assert.equal(firstRowCells[0].attrs["data-label"], "Window");
    assert.equal(firstRowCells[0].attrs.role, "cell");
    assert.equal(firstRowCells[0].text, "15 min");
    assert.equal(firstRowCells[1].className, "data-table__cell data-table__cell--right");
    assert.equal(firstRowCells[1].text, "10");
  });

  await t.test("a missing/null cell value renders as a placeholder dash, not 'null'/'undefined'", () => {
    const spec = dataTableSpec({ columns: COLUMNS, rows: [{ window: "24h", accepted: null, avgSdiff: undefined }] });
    const table = spec.children[0];
    const tbody = table.children.find((c) => c.tag === "tbody");
    const cells = tbody.children[0].children;
    assert.equal(cells[1].text, "--");
    assert.equal(cells[2].text, "--");
  });

  await t.test("zero rows renders an empty tbody, not a throw", () => {
    const spec = dataTableSpec({ columns: COLUMNS, rows: [] });
    const table = spec.children[0];
    const tbody = table.children.find((c) => c.tag === "tbody");
    assert.deepEqual(tbody.children, []);
  });

  await t.test("rows default to an empty array when omitted entirely", () => {
    assert.doesNotThrow(() => dataTableSpec({ columns: COLUMNS }));
  });

  await t.test("throws for missing or empty columns", () => {
    assert.throws(() => dataTableSpec({ rows: ROWS }), /columns must be a non-empty array/);
    assert.throws(() => dataTableSpec({ columns: [], rows: ROWS }), /columns must be a non-empty array/);
  });

  await t.test("extra className is appended to the table element", () => {
    const spec = dataTableSpec({ columns: COLUMNS, rows: ROWS, className: "pool-rolling-windows" });
    assert.equal(spec.children[0].className, "data-table pool-rolling-windows");
  });

  await t.test("cell and label text pass through as text, never markup", () => {
    const raw = "<img src=x onerror=alert(1)>";
    const spec = dataTableSpec({
      columns: [{ key: "x", label: raw }],
      rows: [{ x: raw }],
    });
    const table = spec.children[0];
    const thead = table.children.find((c) => c.tag === "thead");
    const tbody = table.children.find((c) => c.tag === "tbody");
    assert.equal(thead.children[0].children[0].text, raw);
    assert.equal(tbody.children[0].children[0].text, raw);
    assert.equal(tbody.children[0].children[0].tag, "td");
  });
});
