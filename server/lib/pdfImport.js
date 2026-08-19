import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const COLUMN_GAP = 20; // points; minimum horizontal gap between distinct table columns

function clusterColumns(items) {
  const xs = [...new Set(items.map(it => Math.round(it.x)))].sort((a, b) => a - b);
  const edges = [];
  let start = xs[0];
  for (let i = 1; i <= xs.length; i++) {
    if (i === xs.length || xs[i] - xs[i - 1] > COLUMN_GAP) { edges.push(start); start = xs[i]; }
  }
  return edges;
}

function columnIndex(edges, x) {
  let i = 0;
  for (let j = 0; j < edges.length; j++) if (edges[j] <= x + 1) i = j;
  return i;
}

export async function extractPdfTable(buffer, password) {
  let doc;
  try {
    doc = await getDocument({ data: new Uint8Array(buffer), password: password || undefined }).promise;
  } catch (e) {
    if (e.name === "PasswordException") throw e;
    throw Object.assign(new Error("Could not read this PDF: " + e.message), { status: 400 });
  }

  const rows = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter(it => it.str.trim() !== "")
      .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
    if (!items.length) continue;

    const edges = clusterColumns(items);

    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    let line = null, lineY = null;
    for (const it of items) {
      if (lineY === null || Math.abs(it.y - lineY) > 2.5) { line = []; lines.push(line); lineY = it.y; }
      line.push(it);
    }

    for (const ln of lines) {
      ln.sort((a, b) => a.x - b.x);
      const cells = new Array(edges.length).fill("");
      for (const it of ln) {
        const i = columnIndex(edges, it.x);
        cells[i] = cells[i] ? cells[i] + " " + it.str : it.str;
      }
      if (cells.some(c => c)) rows.push(cells);
    }
  }
  return rows;
}

/**
 * Same extraction, flattened to one string per line with "|" between columns.
 * The column markers matter: which column an amount sits in is often the only
 * thing distinguishing a debit from a credit.
 */
export async function extractPdfLines(buffer, password) {
  const rows = await extractPdfTable(buffer, password);
  return rows.map(cells => cells.join(" | ").replace(/(\s*\|\s*)+$/, "").trim()).filter(Boolean);
}
