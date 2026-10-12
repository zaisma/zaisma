import { env } from "cloudflare:test";

/**
 * The test worker's scan queue also scans each upload (without an AI key, so it holds it). Wait for
 * that first, so it can't overwrite the scan a test runs itself.
 */
export async function queueScanDone(versionId: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (await env.DB.prepare("SELECT 1 FROM audit_log WHERE action IN ('scan-held', 'scan-rejected') AND reason LIKE ?").bind(`Version ${versionId}%`).first()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}
