import { isPaymentQrPayload, PAYMENT_QR_LABEL } from '@touchgrass/shared';
import jsQRModule from 'jsqr';
import sharp from 'sharp';

// jsQR ships as UMD: under Node's CommonJS interop the decoder is the module's `default`.
const jsQR = jsQRModule.default;

/** QR codes are decoded on a copy no larger than this (plenty for a code that fills part of a photo). */
const SCAN_EDGE = 1024;

/**
 * Whether an image carries a QR code that pays someone outside TouchGrass (a UPI or bank QR, D-228). Plan covers
 * and chat photos are scanned when processed; the label holds a plan or a plan-chat message that uses them, while
 * direct messages between friends stay as they are.
 */
export async function hasPaymentQrCode(image: Buffer): Promise<boolean> {
  const { data, info } = await sharp(image)
    .resize(SCAN_EDGE, SCAN_EDGE, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const found = jsQR(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    info.width,
    info.height,
    {
      inversionAttempts: 'attemptBoth',
    },
  );
  return found !== null && isPaymentQrPayload(found.data);
}

export const PAYMENT_QR = { name: PAYMENT_QR_LABEL, confidence: 100 } as const;

/** Read side: the asset was labelled as a payment QR when it was processed. */
export function isPaymentQrAsset(asset: {
  moderationLabels: { name: string; confidence: number }[] | null;
}): boolean {
  return (asset.moderationLabels ?? []).some((l) => l.name === PAYMENT_QR_LABEL);
}
