/**
 * Demo data: creates a handful of users + a welcome group the first time the
 * database is empty, so a fresh install is immediately usable
 * (also handy for testing calls between two browser tabs).
 */
import * as store from './store.js';
import { config } from './config.js';
import { log, now } from './util.js';

export const DEMO_USERS = [
  { phone: '967771000001', name: 'أحمد الماسنجر', about: 'مرحباً، أنا أستخدم ماسنجر', locale: 'ar' },
  { phone: '967771000002', name: 'سارة', about: 'متاحة للمكالمات', locale: 'ar' },
  { phone: '967771000003', name: 'خالد', about: '', locale: 'ar' },
  { phone: '12025550123', name: 'Masingar Support', about: 'الدعم الفني', locale: 'en' },
];

export function seed() {
  if (!config.demoSeed) return { created: false, reason: 'disabled' };
  if (store.userCount() > 0) return { created: false, reason: 'not_empty' };

  const users = DEMO_USERS.map((u) => {
    const existing = store.getUserByPhone(u.phone);
    return existing || store.createUser(u);
  });

  // everybody knows everybody
  for (const u of users) {
    store.syncContacts(u.id, users.filter((x) => x.id !== u.id).map((x) => ({ hash: x.phone_hash, name: x.name })));
  }

  // a 1:1 chat between the first two users
  const { conversation: direct } = store.getOrCreateDirect(users[0].id, users[1].id);
  store.createMessage({
    conversationId: direct.id,
    senderId: users[0].id,
    type: 'text',
    body: 'مرحباً سارة! جربي مكالمة الفيديو من الأعلى 🎥',
    createdAt: now() - 60_000,
  });
  store.createMessage({
    conversationId: direct.id,
    senderId: users[1].id,
    type: 'text',
    body: 'أهلاً أحمد، الصوت والصورة ممتازان 👍',
    createdAt: now() - 30_000,
  });

  // a group with everyone
  const group = store.createConversation({
    type: 'group',
    title: 'مجموعة ماسنجر',
    createdBy: users[0].id,
    memberIds: users.map((u) => u.id),
  });
  store.createMessage({
    conversationId: group.id,
    senderId: users[0].id,
    type: 'text',
    body: 'أهلاً بكم في ماسنجر — دردشة ومكالمات صوتية وفيديو بجودة عالية حتى على الشبكات الضعيفة.',
    createdAt: now() - 10_000,
  });

  log('seed: demo users created ->', users.map((u) => `+${u.phone}`).join(', '));
  return { created: true, users: users.map((u) => ({ phone: '+' + u.phone, name: u.name })) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = seed();
  console.log(JSON.stringify(res, null, 2));
  if (res.created) console.log('\nDemo accounts (log in with any 6-digit code when SMS is not configured):');
  for (const u of DEMO_USERS) console.log(`  +${u.phone}   ${u.name}`);
  process.exit(0);
}
