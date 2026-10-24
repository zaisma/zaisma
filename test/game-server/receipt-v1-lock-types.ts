// The receipt's v1 types, checked by npm run typecheck: what a v1 game server reads of a receipt, the codes it
// handles and the calls it makes must keep compiling, so later versions can only add (receipt-v1-lock.test.ts
// checks the same at run time). Change this file only to add to it.
import type { ReceiptClaims, ReceiptErrorCode, Room, Server } from "../../packages/game-server/src/index.ts";
import { RECEIPT_TOKEN_TYPE, RECEIPT_VERSION_NUMBER, ReceiptError, verifyReceipt, type PublicKey } from "../../packages/game-server/src/index.ts";

interface V1ReceiptClaims {
  sub: string;
  aud: string;
  iss: string;
  jti: string;
  receipt_version_number: number;
  purchase_id: string;
  purchased_at: string;
  purchase_status: string;
  item_name: string;
  item_kind: string;
  item_count: number;
  purchase_source: string;
  paid_minor_units: number | null;
  currency_code: string | null;
  game_account_id: string | null;
  iat: number;
  exp?: number;
}

export const v1Reads = (claims: ReceiptClaims): V1ReceiptClaims => claims;
export const v1Calls: Promise<V1ReceiptClaims> = verifyReceipt("t", [] as PublicKey[], { gameSlug: "sky-hopper", issuerUrl: "https://rooms.zaisma.com/receipts" });
export const v1RoomCall = (room: Room): Promise<V1ReceiptClaims> => room.verifyReceipt("t");
export const v1ServerCall = (server: Server): Promise<V1ReceiptClaims> => server.verifyReceipt("t");
export const v1Codes: ReceiptErrorCode[] = ["malformed", "unknown_key", "bad_signature", "expired", "wrong_game", "wrong_issuer", "wrong_kind", "wrong_version"];
export const v1Error: { code: ReceiptErrorCode; name: string; message: string } = new ReceiptError("malformed");
export const v1Constants: [string, number] = [RECEIPT_TOKEN_TYPE, RECEIPT_VERSION_NUMBER];
