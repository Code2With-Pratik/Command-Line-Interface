/* ----------------------------------------------------------------------------
   CLIDesk — export a card to PNG (canvas via inlined SVG) or PDF (print).
   Dependency-free.
---------------------------------------------------------------------------- */

// Curated set of style props worth copying so the cloned node renders standalone.
const STYLE_PROPS = [
  'color', 'background-color', 'background', 'font-family', 'font-size', 'font-weight',
  'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-decoration',
  'white-space', 'word-break', 'overflow-wrap', 'padding', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'margin', 'border', 'border-radius', 'box-shadow',
  'display', 'width', 'max-width', 'box-sizing', 'opacity',
];

function inlineStyles(src: Element, dest: Element) {
  const cs = getComputedStyle(src);
  let style = '';
  for (const prop of STYLE_PROPS) {
    const v = cs.getPropertyValue(prop);
    if (v) style += `${prop}:${v};`;
  }
  dest.setAttribute('style', style);
  const sKids = src.children;
  const dKids = dest.children;
  for (let i = 0; i < sKids.length; i++) {
    if (dKids[i]) inlineStyles(sKids[i], dKids[i]);
  }
}

function sanitize(name: string): string {
  return (name || 'card').replace(/[^\w\-]+/g, '_').slice(0, 60) || 'card';
}

/** Render a DOM node to a PNG file and trigger download. */
export async function downloadImage(node: HTMLElement, filename: string) {
  const rect = node.getBoundingClientRect();
  const scale = 2;
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);

  const clone = node.cloneNode(true) as HTMLElement;
  inlineStyles(node, clone);
  clone.style.margin = '0';

  const xml = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml">${xml}</div>` +
    `</foreignObject></svg>`;

  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#141417';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      try {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `${sanitize(filename)}.png`;
        a.click();
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Could not render image'));
    img.src = url;
  });
}

/** Open the card content in a print frame so the user can "Save as PDF". */
export function downloadPdf(title: string, innerHtml: string) {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);

  const doc = frame.contentWindow!.document;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${sanitize(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Indie+Flower&family=Merienda:wght@300..900&display=swap" rel="stylesheet">
    <style>
      *{box-sizing:border-box}
      body{font-family:"Indie Flower",cursive;color:#111;margin:32px;line-height:1.6}
      h1{font-family:"Merienda",cursive;font-size:28px;margin:0 0 16px}
      a{color:#5b3ad6}
      pre,code{font-family:Consolas,monospace;font-size:13px}
      pre{background:#1e1e1e;color:#d4d4d4;padding:16px;border-radius:8px;white-space:pre-wrap;word-break:break-word}
      .body{white-space:pre-wrap;word-break:break-word;font-size:16px}
    </style></head><body>
      <h1>${escapeHtml(title)}</h1>
      <div class="body">${innerHtml}</div>
    </body></html>`);
  doc.close();

  // Give fonts a moment, then print and clean up.
  const win = frame.contentWindow!;
  const done = () => setTimeout(() => frame.remove(), 1000);
  win.onafterprint = done;
  setTimeout(() => {
    win.focus();
    win.print();
    done();
  }, 350);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
