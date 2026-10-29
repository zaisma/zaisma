/** A DER INTEGER for a positive number's bytes: the fewest bytes DER allows. */
export function integer(bytes: Buffer): Buffer;
/** A self-signed certificate for these names and addresses, with its key, as PEM text. */
export function makeCertificate(names: string[], nowMs?: number, serialBytes?: Buffer, durationDays?: number): { certificatePem: string; keyPem: string };
/** Whether a kept certificate still serves: it reads, covers every one of these names, and has more than a week left. */
export function isCertificateGood(kept: { certificatePem: string; keyPem: string }, names: string[], nowMs?: number): boolean;
