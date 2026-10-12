// Password hashing with PBKDF2-SHA256 via Web Crypto (DESIGN.md → Passwords).
// 100,000 iterations is the most Workers allows; Better Auth's default scrypt can exceed the free plan's CPU limit.
// Stored as "pbkdf2$<iterations>$<salt b64>$<hash b64>".
const ITERATIONS = 100_000;
const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const [scheme, iter, salt, expected] = hash.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !expected) return false;
  const actual = await derive(password, unb64(salt), Number(iter));
  const want = unb64(expected);
  if (actual.length !== want.length) return false;
  let diff = 0; // constant-time compare
  for (let i = 0; i < actual.length; i++) diff |= (actual[i] ?? 0) ^ (want[i] ?? 0);
  return diff === 0;
}
