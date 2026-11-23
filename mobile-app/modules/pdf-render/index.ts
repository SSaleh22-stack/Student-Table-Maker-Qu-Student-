/**
 * The local Expo module `PdfRender` (contract: ./src/PdfRender.types.ts, P04).
 * - iOS (P10): ios/PdfRenderModule.swift, PDFKit on one serial queue with a render journal.
 * - Android (P10A): net.qustudent.pdfrender.PdfRenderModule, bundled PDFium in a ':pdf' process.
 *
 * `PdfRenderNative` is null on web, in Expo Go and in builds made before the module was added, so
 * importing this file never throws. App code does not call it directly: it goes through
 * src/notebook/pdf/engine.ts (`pdfEngine`), which maps every rejection to a PdfError and turns a
 * missing module into PdfError('no-native').
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { PDF_RENDER_MODULE_NAME, type PdfRenderNativeModule } from './src/PdfRender.types';

export * from './src/PdfRender.types';

export const PdfRenderNative: PdfRenderNativeModule | null =
  Platform.OS === 'ios' || Platform.OS === 'android' ? requireOptionalNativeModule<PdfRenderNativeModule>(PDF_RENDER_MODULE_NAME) : null;

/** True when this build has the native renderer. */
export const pdfRenderPresent = PdfRenderNative !== null;
