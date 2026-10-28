import { eq } from "drizzle-orm";
import { db, sessions, users } from "db.ts";
import { hashPassword } from "./auth.js";

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 8) {
  console.log("Kullanim: pnpm exec tsx src/reset-password.ts KULLANICI_ADI YENI_SIFRE (en az 8 karakter)");
  process.exit(1);
}
const u = db.select().from(users).where(eq(users.username, username)).get();
if (!u) {
  console.log("Kullanici bulunamadi:", username);
  process.exit(1);
}
db.update(users).set({ passwordHash: hashPassword(password) }).where(eq(users.id, u.id)).run();
db.delete(sessions).where(eq(sessions.userId, u.id)).run();
console.log(`${u.username} kullanicisinin sifresi degisti, acik oturumlari kapatildi.`);
process.exit(0);