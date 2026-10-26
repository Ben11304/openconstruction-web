// Render PDF pages locally without depending on an iframe PDF plugin.
let loadingTask;
function close() {
  const previous = loadingTask; loadingTask = null;
  if (previous) void previous.destroy().catch(() => {});
}
async function render(blob, body, isCurrent) {
  close();
  const pdfjs = await import('/desktop/vendor/pdfjs/build/pdf.mjs');
  if (!isCurrent()) return;
  pdfjs.GlobalWorkerOptions.workerSrc = '/desktop/vendor/pdfjs/build/pdf.worker.mjs';
  const task = pdfjs.getDocument({
    data:new Uint8Array(await blob.arrayBuffer()), isEvalSupported:false, useWasm:false,
    cMapUrl:'/desktop/vendor/pdfjs/cmaps/', cMapPacked:true,
    standardFontDataUrl:'/desktop/vendor/pdfjs/standard_fonts/',
    wasmUrl:'/desktop/vendor/pdfjs/wasm/'
  });
  loadingTask = task;
  try {
    const pdf = await task.promise;
    if (!isCurrent()) { await task.destroy(); return; }
    const controls = document.createElement('div'); controls.className = 'oc-desktop-pdf-controls';
    const previous = document.createElement('button'); previous.textContent = 'Previous page'; previous.type = 'button';
    const next = document.createElement('button'); next.textContent = 'Next page'; next.type = 'button';
    const label = document.createElement('span'); label.setAttribute('aria-live','polite');
    const canvas = document.createElement('canvas'); canvas.dataset.desktopPdf = ''; canvas.style.maxWidth = '100%';
    canvas.setAttribute('role','img');
    controls.append(previous,label,next); body.append(controls,canvas);
    let number = 1, busy = false;
    async function draw() {
      if (busy || !isCurrent()) return;
      busy = true; previous.disabled = next.disabled = true;
      try {
        const page = await pdf.getPage(number);
        if (!isCurrent()) return;
        const base = page.getViewport({scale:1});
        const width = Math.min(820,Math.max(240,window.innerWidth - 100));
        const scale = Math.min(width / base.width * Math.min(devicePixelRatio || 1,2),Math.sqrt(8000000/(base.width*base.height)));
        const viewport = page.getViewport({scale});
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        canvas.style.width = width + 'px'; canvas.style.height = 'auto';
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        label.textContent = `Page ${number} of ${pdf.numPages}`;
        canvas.setAttribute('aria-label',label.textContent); canvas.dataset.rendered = 'true';
        page.cleanup();
      } catch (error) { if (isCurrent()) label.textContent = `Preview unavailable: ${error.message}`; }
      finally { busy = false; previous.disabled = number <= 1; next.disabled = number >= pdf.numPages; }
    }
    previous.onclick = () => { if (!busy && number > 1) { number--; void draw(); } };
    next.onclick = () => { if (!busy && number < pdf.numPages) { number++; void draw(); } };
    await draw();
  } catch (error) {
    if (isCurrent()) { const message = document.createElement('p'); message.textContent = `PDF preview unavailable: ${error.message}. You can download the file.`; body.append(message); }
  }
}
window.OCDesktopPDF = {render,close};
