p = Path("src/App.tsx")
t = p.read_text()
old = "const { askGemini } = await import('./services/gemini-direct');"
new = """const { runLocalAgent } = await import('./services/local-agent');
        const local = await runLocalAgent(activeKey || '', userText);
        const data: AgentResponse = { speech: local.speech, steps: local.steps } as any;
        const { askGemini } = await import('./services/gemini-direct');"""
print("FOUND" if old in t else "NOT_FOUND")
if old in t:
    p.write_text(t.replace(old, new, 1))
    print("UPDATED")
EOF

python3 fix_app.py
git add src/App.tsx && git commit -m "Wire App to local agent" && git push
cat > fix_dup.py << 'EOF'
from pathlib import Path
p = Path("src/App.tsx")
t = p.read_text()
old = "const data: AgentResponse = await res.json();"
if old not in t:
    print("NOT_FOUND")
else:
    t = t.replace(old, "/* data already set by local agent */", 1)
    p.write_text(t)
    print("UPDATED")
EOF

python3 fix_dup.py
git add src/App.tsx && git commit -m "Fix duplicate data declaration" && git push
python3 fix_dup.py
git add src/App.tsx
git commit -m "Fix duplicate data declaration"
git push
cat > android/app/src/main/java/com/sanna/ai/VoiceAgentPlugin.java << 'EOF'
package com.sanna.ai;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.content.Intent;
import android.media.AudioManager;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.ArrayList;

@CapacitorPlugin(name = "VoiceAgent")
public class VoiceAgentPlugin extends Plugin {

    @PluginMethod
    public void isServiceEnabled(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", SannaAccessibilityService.instance != null);
        call.resolve(result);
    }

    @PluginMethod
    public void launchApp(PluginCall call) {
        String pkg = call.getString("packageName");
        if (pkg == null) { call.reject("packageName required"); return; }
        try {
            Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
            if (intent == null) { call.reject("App not found"); return; }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
EOF

cat >> android/app/src/main/java/com/sanna/ai/VoiceAgentPlugin.java << 'EOF'

    @PluginMethod
    public void performGlobalAction(PluginCall call) {
        if (SannaAccessibilityService.instance == null) { call.reject("Service off"); return; }
        String action = call.getString("action");
        int act = android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME;
        if ("back".equals(action)) act = android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK;
        if ("recents".equals(action)) act = android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_RECENTS;
        if ("notifications".equals(action)) act = android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS;
        if ("quick_settings".equals(action)) act = android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS;
        SannaAccessibilityService.instance.performGlobalAction(act);
        call.resolve();
    }

    @PluginMethod
    public void clickByText(PluginCall call) {
        String text = call.getString("text");
        if (SannaAccessibilityService.instance == null) { call.reject("Service off"); return; }
        boolean ok = SannaAccessibilityService.instance.clickByText(text);
        JSObject result = new JSObject();
        result.put("success", ok);
        call.resolve(result);
    }

    @PluginMethod
    public void tap(PluginCall call) {
        Float x = call.getFloat("x");
        Float y = call.getFloat("y");
        if (SannaAccessibilityService.instance == null) { call.reject("Service off"); return; }
        SannaAccessibilityService.instance.tap(x, y);
        call.resolve();
    }

    @PluginMethod
    public void swipe(PluginCall call) {
        if (SannaAccessibilityService.instance == null) { call.reject("Service off"); return; }
        SannaAccessibilityService.instance.swipe(
            call.getFloat("x1"), call.getFloat("y1"),
            call.getFloat("x2"), call.getFloat("y2"),
            call.getLong("duration", 300L)
        );
        call.resolve();
    }
EOF

cat >> android/app/src/main/java/com/sanna/ai/VoiceAgentPlugin.java << 'EOF'

    @PluginMethod
    public void inputText(PluginCall call) {
        String text = call.getString("text");
        if (SannaAccessibilityService.instance == null) { call.reject("Service off"); return; }
        AccessibilityNodeInfo root = SannaAccessibilityService.instance.getRootInActiveWindow();
        boolean ok = false;
        if (root != null) {
            AccessibilityNodeInfo focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            if (focused != null) {
                android.os.Bundle args = new android.os.Bundle();
                args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
                ok = focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
            }
        }
        JSObject result = new JSObject();
        result.put("success", ok);
        call.resolve(result);
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Integer percent = call.getInt("percent", 50);
        AudioManager am = (AudioManager) getContext().getSystemService(android.content.Context.AUDIO_SERVICE);
        int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        am.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(max * percent / 100f), 0);
        call.resolve();
    }

    @PluginMethod
    public void getScreenText(PluginCall call) {
        JSObject result = new JSObject();
        result.put("texts", new com.getcapacitor.JSArray());
        if (SannaAccessibilityService.instance == null) { call.resolve(result); return; }
        AccessibilityNodeInfo root = SannaAccessibilityService.instance.getRootInActiveWindow();
        ArrayList<String> texts = new ArrayList<>();
        collectText(root, texts);
        result.put("texts", new com.getcapacitor.JSArray(texts));
        call.resolve(result);
    }

    private void collectText(AccessibilityNodeInfo node, ArrayList<String> out) {
        if (node == null) return;
        CharSequence t = node.getText();
        if (t != null && t.length() > 0) out.add(t.toString());
        for (int i = 0; i < node.getChildCount(); i++) collectText(node.getChild(i), out);
    }
}
EOF

git add android/app/src/main/java/com/sanna/ai/VoiceAgentPlugin.java
git commit -m "Expand native agent actions: apps, system, type, volume, screen"
git push
cat > src/services/local-agent.ts << 'EOF'
import { askGemini } from './gemini-direct';

export async function runLocalAgent(apiKey: string, message: string, screenText: string = '') {
  const prompt =
    'You are Sanna, an Arabic Android voice agent. Understand dialect. ' +
    'Return JSON only: {"speech":"Arabic spoken reply","steps":[{"action":"open_app|click_by_text|type_text|home|back|notifications|set_volume","target":"","value":""}]} ' +
    'If user wants WhatsApp use target com.whatsapp. ' +
    'Screen: ' + screenText + ' User: ' + message;

  let speech = '';
  let steps: any[] = [];

  try {
    const raw = await askGemini(apiKey, prompt);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      speech = parsed.speech || '';
      steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    } else {
      speech = raw;
    }
  } catch (e) {
    speech = 'Gemini request failed';
  }

  const t = message.toLowerCase();
  if (t.includes('whatsapp') || t.includes('واتس')) steps.push({ action: 'open_app', target: 'com.whatsapp' });
  if (t.includes('youtube') || t.includes('يوتيوب')) steps.push({ action: 'open_app', target: 'com.google.android.youtube' });
  if (t.includes('home') || t.includes('رئيسي')) steps.push({ action: 'home' });
  if (t.includes('back') || t.includes('رجوع')) steps.push({ action: 'back' });

  if (!speech) speech = 'تم.';
  return { speech, steps };
}
EOF

git add src/services/local-agent.ts
git commit -m "Add understanding, screen context, and voice action mapping"
git push
git add android/app/src/main/java/com/sanna/ai/VoiceAgentPlugin.java src/services/local-agent.ts src/App.tsx
git status
git commit -m "Voice understand and execute tasks"
git push
cat > android/app/src/main/java/com/sanna/ai/SannaNotificationListener.java << 'EOF'
package com.sanna.ai;

import android.app.Notification;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.util.ArrayList;
import java.util.List;

public class SannaNotificationListener extends NotificationListenerService {
    public static SannaNotificationListener instance;
    public static String lastTitle = "";
    public static String lastText = "";
    public static String lastPkg = "";

    public static class Item {
        public String pkg, title, text, key;
    }

    @Override
    public void onListenerConnected() {
        instance = this;
    }

    @Override
    public void onListenerDisconnected() {
        instance = null;
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || sbn.getNotification() == null) return;
        Notification n = sbn.getNotification();
        CharSequence t = n.extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence x = n.extras.getCharSequence(Notification.EXTRA_TEXT);
        lastPkg = sbn.getPackageName();
        lastTitle = t == null ? "" : t.toString();
        lastText = x == null ? "" : x.toString();
    }

    public List<Item> snapshot() {
        ArrayList<Item> out = new ArrayList<>();
        StatusBarNotification[] all = getActiveNotifications();
        if (all == null) return out;
        for (StatusBarNotification sbn : all) {
            Item it = new Item();
            it.pkg = sbn.getPackageName();
            it.key = sbn.getKey();
            Notification n = sbn.getNotification();
            CharSequence t = n.extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence x = n.extras.getCharSequence(Notification.EXTRA_TEXT);
            it.title = t == null ? "" : t.toString();
            it.text = x == null ? "" : x.toString();
            out.add(it);
        }
        return out;
    }
}
EOF

python3 - << 'PY'
from pathlib import Path
p = Path("android/app/src/main/java/com/sanna/ai/VoiceAgentPlugin.java")
t = p.read_text()
if "getNotifications" in t:
    print("ALREADY")
else:
    add = '''
    @PluginMethod
    public void getNotifications(PluginCall call) {
        com.getcapacitor.JSArray arr = new com.getcapacitor.JSArray();
        if (SannaNotificationListener.instance != null) {
            for (SannaNotificationListener.Item it : SannaNotificationListener.instance.snapshot()) {
                JSObject o = new JSObject();
                o.put("pkg", it.pkg);
                o.put("title", it.title);
                o.put("text", it.text);
                arr.put(o);
            }
        }
        JSObject result = new JSObject();
        result.put("items", arr);
        result.put("lastTitle", SannaNotificationListener.lastTitle);
        result.put("lastText", SannaNotificationListener.lastText);
        call.resolve(result);
    }
}
'''
        t = t.rstrip()
        if t.endswith("}"):
            t = t[:-1] + add
            p.write_text(t)
            print("UPDATED")
        else:
            print("NO_END")
PY

cat > fix_notif.py << 'EOF'
from pathlib import Path
p = Path("android/app/src/main/java/com/sanna/ai/VoiceAgentPlugin.java")
t = p.read_text()
if "getNotifications" in t:
    print("ALREADY")
else:
    add = """
    @PluginMethod
    public void getNotifications(PluginCall call) {
        com.getcapacitor.JSArray arr = new com.getcapacitor.JSArray();
        if (SannaNotificationListener.instance != null) {
            for (SannaNotificationListener.Item it : SannaNotificationListener.instance.snapshot()) {
                JSObject o = new JSObject();
                o.put("pkg", it.pkg);
                o.put("title", it.title);
                o.put("text", it.text);
                arr.put(o);
            }
        }
        JSObject result = new JSObject();
        result.put("items", arr);
        result.put("lastTitle", SannaNotificationListener.lastTitle);
        result.put("lastText", SannaNotificationListener.lastText);
        call.resolve(result);
    }
}
"""
    t = t.rstrip()
    if t.endswith("}"):
        p.write_text(t[:-1] + add)
        print("UPDATED")
    else:
        print("NO_END")
EOF

python3 fix_notif.py
git add android/app/src/main/java/com/sanna/ai/SannaNotificationListener.java android/app/src/main/java/com/sanna/ai/VoiceAgentPlugin.java
git commit -m "Read new notifications"
git push
cat > src/services/local-agent.ts << 'EOF'
import { askGemini } from './gemini-direct';

export async function runLocalAgent(apiKey: string, message: string, screenText: string = '') {
  const prompt =
    'You are Sanna, a warm human-like Arabic voice companion. Speak naturally like a person, short spoken sentences, matching the user dialect. ' +
    'Do not sound like a robot. If the user greets, greet back warmly. If they ask to do something on the phone, do it. ' +
    'Return JSON only: {"speech":"natural Arabic reply","steps":[{"action":"open_app|click_by_text|type_text|home|back|notifications","target":"","value":""}]} ' +
    'Screen: ' + screenText + ' User: ' + message;

  let speech = '';
  let steps: any[] = [];
  try {
    const raw = await askGemini(apiKey, prompt);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      speech = parsed.speech || '';
      steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    } else {
      speech = raw;
    }
  } catch (e) {
    speech = 'حاضر، حاول تاني.';
  }
  if (!speech) speech = 'تمام.';
  return { speech, steps };
}
EO

cat > src/services/local-agent.ts << 'EOF'
import { askGemini } from './gemini-direct';

export async function runLocalAgent(apiKey: string, message: string, screenText: string = '') {
  const prompt =
    'You are Sanna, a warm human-like Arabic voice companion. Speak naturally, short spoken Arabic, matching dialect. Return JSON only: {"speech":"...","steps":[{"action":"open_app|click_by_text|type_text|home|back|notifications","target":"","value":""}]} Screen: ' +
    screenText + ' User: ' + message;
  let speech = '';
  let steps: any[] = [];
  try {
    const raw = await askGemini(apiKey, prompt);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      speech = parsed.speech || '';
      steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    } else {
      speech = raw;
    }
  } catch (e) {
    speech = 'OK, try again.';
  }
  if (!speech) speech = 'OK';
  return { speech, steps };
}
EOF

git add src/services/local-agent.ts && git commit -m "Human-like Arabic conversation" && git push
cat > add_gestures.py << 'EOF'
from pathlib import Path
p = Path("android/app/src/main/java/com/sanna/ai/VoiceAgentPlugin.java")
t = p.read_text()
if "swipeUp" in t:
    print("ALREADY")
else:
    add = r'''
    @PluginMethod
    public void swipeUp(PluginCall call) { swipeDir(call, 0, 1); }
    @PluginMethod
    public void swipeDown(PluginCall call) { swipeDir(call, 0, -1); }
    @PluginMethod
    public void swipeLeft(PluginCall call) { swipeDir(call, 1, 0); }
    @PluginMethod
    public void swipeRight(PluginCall call) { swipeDir(call, -1, 0); }

    private void swipeDir(PluginCall call, int dx, int dy) {
        if (SannaAccessibilityService.instance == null) { call.reject("Service off"); return; }
        android.util.DisplayMetrics m = getContext().getResources().getDisplayMetrics();
        float cx = m.widthPixels / 2f;
        float cy = m.heightPixels / 2f;
        float x2 = cx - dx * m.widthPixels * 0.35f;
        float y2 = cy - dy * m.heightPixels * 0.35f;
        SannaAccessibilityService.instance.swipe(cx, cy, x2, y2, 350);
        call.resolve();
    }
}
'''
    t = t.rstrip()
    if t.endswith("}"):
        p.write_text(t[:-1] + add)
        print("UPDATED")
    else:
        print("NO_END")
EOF

python3 add_gestures.py
cat > add_lock.py << 'EOF'
from pathlib import Path
p = Path("android/app/src/main/java/com/sanna/ai/VoiceAgentPlugin.java")
t = p.read_text()
if "lockScreen" in t:
    print("ALREADY")
else:
    add = '''
    @PluginMethod
    public void lockScreen(PluginCall call) {
        if (SannaAccessibilityService.instance == null) { call.reject("Service off"); return; }
        SannaAccessibilityService.instance.performGlobalAction(
            android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN
        );
        call.resolve();
    }
}
'''
    t = t.rstrip()
    if t.endswith("}"):
        p.write_text(t[:-1] + add)
        print("UPDATED")
    else:
        print("NO_END")
EOF

python3 add_lock.py
git add android/app/src/main/java/com/sanna/ai/VoiceAgentPlugin.java
git commit -m "Add lock screen and gesture actions"
git push
cd ~
curl -L -o sanna-ai.zip https://github.com/aalter237-blip/sanna-ai-arabic-voice-assistant/archive/refs/heads/main.zip
ls -lh sanna-ai.zip
cd ~
curl -L -o sanna-ai.zip https://github.com/aalter237-blip/sanna-ai-arabic-voice-assistant/archive/refs/heads/main.zip
ls -lh sanna-ai.zip
pkg update && pkg upgrade -y
pkg install clang cmake git wget
pkg install llama-cpp
pkg update && pkg upgrade -y
pkg install git cmake clang make libandroid-spawn wget
cd ~
git clone --depth 1 https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build
cmake --build build -j 4
