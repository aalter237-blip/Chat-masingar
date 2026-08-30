# النشر المجاني خطوة بخطوة (بدون بطاقة بنكية إطلاقاً)

هذا الأسهل للمستخدم غير التقني: **Render** (تشغيل السيرفر مجاناً) +
**Supabase** (حفظ البيانات مجاناً حتى لا تُمسح عند إعادة تشغيل الخطة المجانية).

> الخطة المجانية في Render «تنام» بعد خمول ١٥ دقيقة — أول من يفتح التطبيق بعدها
> ينتظر ٣٠-٦٠ ثانية ثم يعمل طبيعياً. للاستخدام الدائم الكامل بدون انتظار
> تحتاج خادماً مدفوعاً (~٣$/شهر) أو Oracle المجاني (يتطلب بطاقة للتحقق فقط).

---

## الخطوة ١ — ادمج التحديثات في المستودع

افتح [Pull Request #13](https://github.com/aalter237-blip/Chat-masingar/pull/13)
واضغط **Merge pull request** (الزر الأخضر) حتى يصبح كود «ماسنجر لايت» هو الرئيسي.

## الخطوة ٢ — أنشئ قاعدة بيانات Supabase (٥ دقائق)

1. ادخل [supabase.com](https://supabase.com) → **Start your project** → سجّل بحساب GitHub.
2. **New project** → اختر اسماً (مثل `masingar`) → اضغط **Create new project** وانتظر دقيقة.
3. من القائمة اليسرى افتح **SQL Editor** → ألصق هذا واضغط **Run**:

```sql
create table if not exists app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;
```

4. من **Project Settings → API** انسخ قيمتين:
   - **Project URL** (مثل `https://xxxx.supabase.co`)
   - **service_role key** (سري — اضغط reveal)

## الخطوة ٣ — شغّل السيرفر على Render (٥ دقائق)

1. ادخل [render.com](https://render.com) → **Get Started** → سجّل بحساب **GitHub** نفسه.
2. **New +** → **Web Service** → اختر مستودع `Chat-masingar` → **Connect**.
3. املأ:
   - **Name**: `masingar-lite` (أي اسم)
   - **Region**: Frankfurt (الأقرب لمنطقتنا)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server/src/index.js`
   - **Instance Type**: Free
4. افتح **Advanced → Add Environment Variable** وأضف الثلاثة:

   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | الرابط الذي نسخته (ينتهي بـ supabase.co) |
   | `SUPABASE_SERVICE_KEY` | المفتاح service_role |
   | `JOIN_CODE` | رقم سري من ٤ أرقام تختاره (مثل `4521`) |

5. اضغط **Create Web Service** وانتظر ٢-٣ دقائق حتى يظهر **Live**.
6. أعلى الصفحة ستجد رابط تطبيقك، مثل: `https://masingar-lite.onrender.com` ← هذا هو **رابط سيرفرك**.

## الخطوة ٤ — افتح التطبيق

- **من المتصفح (الأسهل)**: افتح الرابط من Chrome على الجوال → ⋮ → **إضافة إلى الشاشة الرئيسية**.
- **من تطبيق الأندرويد**: افتح التطبيق → أدخل الرابط في نافذة «عنوان السيرفر» → حفظ ✓.
  (إن ظهرت شاشة خطأ: زر **تغيير عنوان السيرفر**).

## الخطوة ٥ — وزّع رمز الانضمام على دائرتك

أرسل لأفراد دائرتك (٥ كحد أقصى): الرابط + رمز `JOIN_CODE`.
أول من يسجل يكتب اسمه ورقم هاتفه ويظهر للجميع — وعند اكتمال الخمسة يُغلق التسجيل تلقائياً.

---

## التحقق أن كل شيء سليم

| أين | ماذا تبحث عنه |
|---|---|
| Render → Logs | سطر `تم تحميل الحالة من Supabase (...)` أو `حفظ : Supabase خارجي مفعّل` |
| Supabase → Table Editor | جدول `app_state` فيه سطر `main` بعد أول رسالة |
| التطبيق | الرسائل تبقى موجودة حتى بعد إعادة نشر الخدمة في Render |

## أسئلة متكررة

**Restarted الخدمة والرسائل اختفت؟**
تأكد أن متغيري `SUPABASE_URL` و`SUPABASE_SERVICE_KEY` مضبوطان في Render (Environment)
وأنك نفّذت SQL الخطوة ٢. أول رسالة بعد الضبط تعيد التخزين.

**أريد تغيير رمز الانضمام؟**
Render → Environment → عدّل `JOIN_CODE` → Save (يعيد التشغيل تلقائياً).

**نسيت الرمز/أريد تصفير الدائرة؟**
Supabase → Table Editor → `app_state` → احذف السطر → أعد نشر الخدمة.

**أريد أكثر من ٥ أعضاء؟**
Render → Environment → `MAX_MEMBERS=8` مثلاً → Save.
