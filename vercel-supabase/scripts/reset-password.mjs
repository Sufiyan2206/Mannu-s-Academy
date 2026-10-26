// Sets a new password for an existing account, and lists the accounts that exist.
//   npm run reset-password -- you@example.com "NewPassword123"      (omit the arguments to just list the accounts)
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { loadEnv } from './env.mjs';

loadEnv();
const [email, password] = process.argv.slice(2);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
if (!email) {
  const { rows } = await db.query('select u.email, p.role, p.active, u.banned from auth.users u left join public.profiles p on p.id = u.id order by u.created_at');
  console.log(rows.length ? 'Accounts:' : 'There are no accounts yet. Create one with: npm run create-admin -- email password "Name"');
  for (const r of rows) console.log(`  ${r.email}  (${r.role}${r.active === false || r.banned ? ', switched off' : ''})`);
} else {
  if (!password || password.length < 8) { console.error('Give a new password of at least 8 characters.'); process.exit(1); }
  const r = await db.query('update auth.users set password_hash = $2, banned = false where lower(email) = lower($1)', [email.trim(), await bcrypt.hash(password, 11)]);
  if (!r.rowCount) { console.error(`No account with the email ${email}. Run this command with no arguments to see the accounts.`); process.exit(1); }
  await db.query('update public.profiles set active = true where id = (select id from auth.users where lower(email) = lower($1))', [email.trim()]);
  console.log(`Password changed for ${email}. You can sign in now.`);
}
await db.end();
