/**
 * Phones: write export files to the app's cache folder and open the share sheet
 * (save to Files, AirDrop, WhatsApp, email, open in Calendar/Excel…).
 *
 * Every shared file is written by us into `Paths.cache`. Files made by other modules (the PDF
 * printer, the screenshot) live in folders this app may not share from — Expo Go on Android
 * refuses them — so we take their bytes as base64 and write our own copy.
 */
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { PAGE } from './html';

export interface ExportFile {
  /** File name with extension, e.g. "qu-schedule.ics" */
  name: string;
  mimeType: string;
  /** iOS type identifier, so the share sheet offers the right apps */
  uti?: string;
  data: string | Uint8Array;
}

const share = async (uri: string, mimeType: string, uti: string | undefined, title: string) => {
  if (!(await Sharing.isAvailableAsync())) throw new Error('sharing unavailable');
  await Sharing.shareAsync(uri, { mimeType, UTI: uti, dialogTitle: title });
};

/** Writes base64 bytes to our cache folder under `name` and shares that file. */
const shareBase64 = async (base64: string, name: string, mimeType: string, uti: string) => {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  await file.write(base64, { encoding: 'base64' });
  await share(file.uri, mimeType, uti, name);
};

export async function shareFile({ name, mimeType, uti, data }: ExportFile): Promise<void> {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  await file.write(data);
  await share(file.uri, mimeType, uti, name);
}

export async function sharePdf(html: string, name: string): Promise<void> {
  const { base64 } = await Print.printToFileAsync({ html, width: PAGE.width, height: PAGE.height, base64: true });
  if (!base64) throw new Error('empty pdf');
  await shareBase64(base64, name, 'application/pdf', 'com.adobe.pdf');
}

/** The system print window (it also offers "Save as PDF"). */
export async function printHtml(html: string): Promise<void> {
  await Print.printAsync({ html, width: PAGE.width, height: PAGE.height });
}

/** `data` is the PNG as base64 (captureRef with result "base64"). */
export async function shareImage(data: string, name: string): Promise<void> {
  await shareBase64(data, name, 'image/png', 'public.png');
}
