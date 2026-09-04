/**
 * فحص واختبار شامل لواجهة API — ماسنجر لايت
 */
import assert from 'node:assert/strict';

const BASE = process.env.TEST_URL || 'http://localhost:3000';

async function req(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function runSmokeTests() {
  console.log('🧪 بدء الفحص الشامل لـ API على:', BASE);

  // 1. فحص معلومات الدائرة
  const circle = await req('/api/circle');
  assert.equal(circle.status, 200, 'Circle info must return 200');
  assert.equal(circle.data.ok, true, 'Circle info ok must be true');
  console.log('  ✓ GET /api/circle ناجح:', circle.data.name);

  // 2. طلب كود تسجيل الدخول لمستخدم تجريبي
  const testPhone = '+966500000001';
  const authReq = await req('/api/auth/request', {
    method: 'POST',
    body: { phone: testPhone },
  });
  assert.equal(authReq.status, 200);
  assert.ok(authReq.data.code, 'Auth code must be returned in private circle mode');
  const code = authReq.data.code;
  console.log('  ✓ POST /api/auth/request ناجح والكود المستلم:', code);

  // 3. التحقق والتسجيل
  const authVerify = await req('/api/auth/verify', {
    method: 'POST',
    body: { phone: testPhone, code, name: 'فاحص النظام' },
  });
  assert.equal(authVerify.status, 200);
  assert.ok(authVerify.data.token, 'Token must be returned');
  const token = authVerify.data.token;
  const authHeaders = { Authorization: `Bearer ${token}` };
  console.log('  ✓ POST /api/auth/verify ناجح وتم إصدار الجلسة بنجاح');

  // 4. فحص الحالة الشاملة
  const state = await req('/api/state', { headers: authHeaders });
  assert.equal(state.status, 200);
  assert.equal(state.data.ok, true);
  assert.ok(state.data.me.phone.includes('966500000001'));
  console.log('  ✓ GET /api/state ناجح والمستخدم الحالي:', state.data.me.name);

  // 5. تعديل الاسم والحالة (Profile Update)
  const updateMe = await req('/api/me', {
    method: 'PUT',
    headers: authHeaders,
    body: { name: 'فاحص النظام 2', bio: 'أقوم باختبار الأداء 🚀' },
  });
  assert.equal(updateMe.status, 200);
  assert.equal(updateMe.data.me.name, 'فاحص النظام 2');
  assert.equal(updateMe.data.me.bio, 'أقوم باختبار الأداء 🚀');
  console.log('  ✓ PUT /api/me ناجح وتم تحديث الاسم والبيو');

  // 6. إرسال رسالة نصية واستطلاع رأي
  const msgSend = await req('/api/messages', {
    method: 'POST',
    headers: authHeaders,
    body: {
      text: 'مرحبا! هذا اختبار آلي للرسائل',
      poll: {
        question: 'هل النظام يعمل بسلاسة؟',
        options: ['نعم بنسبة 100%', 'ممتاز جداً'],
      },
    },
  });
  assert.equal(msgSend.status, 200);
  assert.ok(msgSend.data.message.id);
  assert.ok(msgSend.data.message.poll);
  const msgId = msgSend.data.message.id;
  console.log('  ✓ POST /api/messages ناجح وتم إنشاء رسالة واستطلاع رأي');

  // 7. التصويت على استطلاع الرأي
  const voteRes = await req(`/api/messages/${msgId}/vote`, {
    method: 'POST',
    headers: authHeaders,
    body: { optionId: 'opt_1' },
  });
  assert.equal(voteRes.status, 200);
  assert.equal(voteRes.data.poll.options[0].voters.length, 1);
  console.log('  ✓ POST /api/messages/:id/vote ناجح');

  // 8. التفاعل مع الرسالة بإيموجي
  const reactRes = await req(`/api/messages/${msgId}/react`, {
    method: 'POST',
    headers: authHeaders,
    body: { emoji: '❤️' },
  });
  assert.equal(reactRes.status, 200);
  assert.ok(reactRes.data.reactions['❤️']);
  console.log('  ✓ POST /api/messages/:id/react ناجح');

  // 9. إنشاء منشور في الخلاصة
  const postRes = await req('/api/posts', {
    method: 'POST',
    headers: authHeaders,
    body: { text: 'منشور تجريبي للفحص التلقائي' },
  });
  assert.equal(postRes.status, 200);
  const postId = postRes.data.post.id;
  console.log('  ✓ POST /api/posts ناجح');

  // 10. الإعجاب والتعليق على المنشور
  const likeRes = await req(`/api/posts/${postId}/like`, { method: 'POST', headers: authHeaders });
  assert.equal(likeRes.status, 200);
  const commentRes = await req(`/api/posts/${postId}/comments`, {
    method: 'POST',
    headers: authHeaders,
    body: { text: 'تعليق رائع ومكتمل' },
  });
  assert.equal(commentRes.status, 200);
  console.log('  ✓ POST /api/posts/:id/like و comments ناجح');

  // 11. نشر حالة (Status)
  const statusRes = await req('/api/statuses', {
    method: 'POST',
    headers: authHeaders,
    body: { text: 'حالة تجريبية لمدة 24 ساعة', bgColor: '#128C7E' },
  });
  assert.equal(statusRes.status, 200);
  console.log('  ✓ POST /api/statuses ناجح');

  // 12. البحث الموحد
  const searchRes = await req('/api/search?q=اختبار', { headers: authHeaders });
  assert.equal(searchRes.status, 200);
  assert.ok(searchRes.data.total >= 1);
  console.log('  ✓ GET /api/search ناجح ونتائج البحث:', searchRes.data.total);

  // 13. حذف الرسالة
  const delMsg = await req(`/api/messages/${msgId}`, { method: 'DELETE', headers: authHeaders });
  assert.equal(delMsg.status, 200);
  console.log('  ✓ DELETE /api/messages/:id ناجح');

  // 14. تفريغ جميع الرسائل
  const clearAllRes = await req('/api/messages', { method: 'DELETE', headers: authHeaders });
  assert.equal(clearAllRes.status, 200);
  assert.equal(clearAllRes.data.ok, true);
  console.log('  ✓ DELETE /api/messages (مسح سجل المحادثة) ناجح');

  console.log('🎉 اكتملت جميع اختبارات API Smoke Tests بنجاح تام 100%!');
}

runSmokeTests().catch((err) => {
  console.error('❌ فشل فحص API:', err);
  process.exit(1);
});
