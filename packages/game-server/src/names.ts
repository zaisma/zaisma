const ADJECTIVES = ["Swift", "Brave", "Quiet", "Lucky", "Bright", "Clever", "Sunny", "Bold", "Calm", "Fuzzy", "Jolly", "Nimble", "Rapid", "Sly", "Witty", "Zany", "Cosmic", "Mighty", "Tiny", "Wild"];
const ANIMALS = ["Fox", "Otter", "Panda", "Hawk", "Lynx", "Koala", "Badger", "Falcon", "Gecko", "Moose", "Owl", "Raven", "Seal", "Tiger", "Wolf", "Yak", "Bison", "Crane", "Heron", "Newt"];

function pick<T>(list: readonly T[], randomNumber: number): T {
  return list[randomNumber % list.length]!;
}

/** A friendly guest name like "Swift Fox 42". Guests can't type their own names. */
export function guestName(): string {
  const [adjectiveNumber, animalNumber, endNumber] = crypto.getRandomValues(new Uint32Array(3));
  return `${pick(ADJECTIVES, adjectiveNumber!)} ${pick(ANIMALS, animalNumber!)} ${10 + (endNumber! % 90)}`;
}

/** No 0/O or 1/I, so codes read out loud or typed from a screen don't get mixed up. */
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function roomCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => CODE_ALPHABET[byte & 31]).join("");
}

export function isRoomCode(code: string): boolean {
  return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(code);
}
