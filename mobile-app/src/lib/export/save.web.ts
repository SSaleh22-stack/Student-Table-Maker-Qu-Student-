/** Web: export files are downloaded, and PDF/print use the browser's print dialog. */
import type { ExportFile } from './save';

const download = (href: string, name: string) => {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
};

export async function shareFile({ name, mimeType, data }: ExportFile): Promise<void> {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mimeType }));
  download(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Prints the page in a hidden frame; the browser's dialog also offers "Save as PDF". */
export async function printHtml(html: string): Promise<void> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    throw new Error('print unavailable');
  }
  doc.open();
  doc.write(html);
  doc.close();
  // Let the web font load before printing.
  await new Promise((resolve) => setTimeout(resolve, 600));
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 60_000);
}

export async function sharePdf(html: string, _name: string): Promise<void> {
  await printHtml(html);
}

/** `data` is a data: URL from captureRef on web. */
export async function shareImage(data: string, name: string): Promise<void> {
  download(data, name);
}
