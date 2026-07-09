package com.xegithub.goldphone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class GoldForegroundService extends Service {
    public static final String ACTION_START = "com.xegithub.goldphone.action.START_BACKGROUND_DATA";
    public static final String ACTION_STOP = "com.xegithub.goldphone.action.STOP_BACKGROUND_DATA";
    public static final String CHANNEL_ID = "gold_background_data";
    public static final String ALERT_CHANNEL_ID = "gold_background_alerts";
    public static final String PREFS = "gold_background_data_prefs";
    public static final String KEY_RULES = "rules";
    public static final String KEY_SNAPSHOT = "snapshot";
    public static final String KEY_LAST_SUCCESS = "lastSuccess";
    public static final String KEY_LAST_ERROR = "lastError";
    private static final int NOTIFICATION_ID = 8801;
    private static final int FETCH_SECONDS = 15;
    private static final double TROY_OUNCE_GRAMS = 31.1035;
    private static volatile boolean running = false;
    private static ScheduledExecutorService executor;
    private final Set<String> lockedRules = new HashSet<>();

    public static boolean isRunning() {
        return running;
    }

    public static void start(Context context) {
        Intent intent = new Intent(context, GoldForegroundService.class);
        intent.setAction(ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, GoldForegroundService.class);
        intent.setAction(ACTION_STOP);
        context.startService(intent);
    }

    public static void saveRules(Context context, String rulesJson) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_RULES, rulesJson == null ? "[]" : rulesJson)
            .apply();
    }

    public static JSONObject statusJson(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject out = new JSONObject();
        try {
            out.put("running", running);
            out.put("lastSuccess", prefs.getLong(KEY_LAST_SUCCESS, 0));
            String error = prefs.getString(KEY_LAST_ERROR, null);
            if (error != null) out.put("lastError", error);
            String snapshot = prefs.getString(KEY_SNAPSHOT, null);
            if (snapshot != null) out.put("snapshot", new JSONObject(snapshot));
        } catch (Exception ignored) {
        }
        return out;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopLoop();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        running = true;
        startForeground(NOTIFICATION_ID, buildServiceNotification("后台数据服务运行中"));
        startLoop();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopLoop();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void startLoop() {
        if (executor != null && !executor.isShutdown()) return;
        executor = Executors.newSingleThreadScheduledExecutor();
        executor.execute(this::safeFetchOnce);
        executor.scheduleAtFixedRate(this::safeFetchOnce, FETCH_SECONDS, FETCH_SECONDS, TimeUnit.SECONDS);
    }

    private void stopLoop() {
        running = false;
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
    }

    private void safeFetchOnce() {
        try {
            JSONObject payload = fetchMarketPayload();
            SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            long now = System.currentTimeMillis();
            prefs.edit()
                .putString(KEY_SNAPSHOT, payload.toString())
                .putLong(KEY_LAST_SUCCESS, now)
                .remove(KEY_LAST_ERROR)
                .apply();
            evaluateAlerts(payload.optJSONArray("quotes"));
            updateServiceNotification("后台已更新 " + formatTime(now));
        } catch (Exception e) {
            getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_LAST_ERROR, e.getMessage() == null ? String.valueOf(e) : e.getMessage())
                .apply();
            updateServiceNotification("后台更新失败，仍在重试");
        }
    }

    private JSONObject fetchMarketPayload() throws Exception {
        String[] symbols = new String[]{"hf_XAU", "USDCNY", "gds_AU9999", "gds_AUTD", "nf_AU0", "sh518880"};
        String text = httpGet("https://hq.sinajs.cn/list=" + join(symbols), "GB18030");
        Map<String, JSONObject> byId = new HashMap<>();
        Pattern p = Pattern.compile("var hq_str_([^=]+)=\"([^\"]*)\";");
        Matcher m = p.matcher(text);
        while (m.find()) {
            JSONObject q = parseSina(m.group(1), m.group(2));
            if (q != null) byId.put(q.getString("instrumentId"), q);
        }
        JSONObject xau = byId.get("xau-usd");
        JSONObject fx = byId.get("usd-cny");
        if (xau != null && fx != null) {
            double price = xau.getDouble("price") * fx.getDouble("price") / TROY_OUNCE_GRAMS;
            JSONObject q = new JSONObject();
            q.put("instrumentId", "xau-cny");
            q.put("price", round2(price));
            q.put("timestamp", xau.optString("timestamp"));
            q.put("source", "Android后台计算：XAU/USD × USD/CNY ÷ 31.1035");
            if (xau.has("change")) q.put("change", round2(xau.getDouble("change") * fx.getDouble("price") / TROY_OUNCE_GRAMS));
            if (xau.has("changePercent")) q.put("changePercent", xau.getDouble("changePercent"));
            byId.put("xau-cny", q);
        }

        JSONArray quotes = new JSONArray();
        String[] order = new String[]{"xau-cny", "xau-usd", "usd-cny", "sge-au9999", "sge-autd", "shfe-au-main", "gold-etf-518880"};
        for (String id : order) {
            JSONObject q = byId.get(id);
            if (q != null) quotes.put(q);
        }
        long now = System.currentTimeMillis();
        JSONObject payload = new JSONObject();
        payload.put("quotes", quotes);
        payload.put("warnings", new JSONArray().put("Android后台原生抓取：覆盖行情/交易所标的；银行积存金仍以前台 Node 数据为准"));
        payload.put("serverTime", now);
        payload.put("quotesUpdatedAt", now);
        return payload;
    }

    private JSONObject parseSina(String symbol, String raw) throws Exception {
        if (raw == null || raw.length() == 0) return null;
        String[] f = raw.split(",", -1);
        String id;
        double price;
        Double previous = null;
        String timestamp = isoNow();
        String source = "新浪财经（Android后台）";
        if (symbol.equals("hf_XAU")) {
            id = "xau-usd";
            price = number(f, 0);
            previous = nullableNumber(f, 8);
            timestamp = chinaTimestamp(get(f, 12), get(f, 6));
            source = "新浪财经·伦敦金（Android后台）";
        } else if (symbol.equals("USDCNY")) {
            id = "usd-cny";
            price = number(f, 8);
            previous = nullableNumber(f, 1);
            timestamp = chinaTimestamp(get(f, 10), get(f, 0));
            source = "新浪财经·美元兑人民币（Android后台）";
        } else if (symbol.equals("gds_AU9999")) {
            id = "sge-au9999";
            price = number(f, 0);
            previous = nullableNumber(f, 7);
            timestamp = chinaTimestamp(get(f, 12), get(f, 6));
            source = "新浪财经·SGE现货（Android后台）";
        } else if (symbol.equals("gds_AUTD")) {
            id = "sge-autd";
            price = number(f, 0);
            previous = nullableNumber(f, 7);
            timestamp = chinaTimestamp(get(f, 12), get(f, 6));
            source = "新浪财经·SGE延期（Android后台）";
        } else if (symbol.equals("nf_AU0")) {
            id = "shfe-au-main";
            price = number(f, 8);
            previous = nullableNumber(f, 10);
            timestamp = chinaTimestamp(get(f, 17), timeHhmmss(get(f, 1)));
            source = "新浪财经·SHFE沪金主力（Android后台）";
        } else if (symbol.equals("sh518880")) {
            id = "gold-etf-518880";
            price = number(f, 3);
            previous = nullableNumber(f, 2);
            timestamp = chinaTimestamp(get(f, 30), get(f, 31));
            source = "新浪财经·沪市ETF（Android后台）";
        } else {
            return null;
        }
        JSONObject q = new JSONObject();
        q.put("instrumentId", id);
        q.put("price", price);
        q.put("timestamp", timestamp);
        q.put("source", source);
        if (previous != null && previous > 0) {
            q.put("change", round3(price - previous));
            q.put("changePercent", round2((price - previous) / previous * 100));
        }
        return q;
    }

    private void evaluateAlerts(JSONArray quotes) throws Exception {
        if (quotes == null) return;
        Map<String, Double> prices = new HashMap<>();
        for (int i = 0; i < quotes.length(); i++) {
            JSONObject q = quotes.getJSONObject(i);
            prices.put(q.getString("instrumentId"), q.getDouble("price"));
        }
        String rulesRaw = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_RULES, "[]");
        JSONArray rules = new JSONArray(rulesRaw == null ? "[]" : rulesRaw);
        for (int i = 0; i < rules.length(); i++) {
            JSONObject r = rules.getJSONObject(i);
            if (!r.optBoolean("enabled", true)) {
                lockedRules.remove(r.optString("id"));
                continue;
            }
            String id = r.optString("id");
            String instrumentId = r.optString("instrumentId");
            Double price = prices.get(instrumentId);
            if (id.length() == 0 || price == null) continue;
            double threshold = r.optDouble("threshold", Double.NaN);
            if (Double.isNaN(threshold) || threshold <= 0) continue;
            String direction = r.optString("direction", "above");
            boolean meets = direction.equals("below") ? price <= threshold : price >= threshold;
            if (meets && !lockedRules.contains(id)) {
                lockedRules.add(id);
                showAlert(instrumentId, direction, threshold, price);
            } else if (!meets) {
                lockedRules.remove(id);
            }
        }
    }

    private void showAlert(String instrumentId, String direction, double threshold, double price) {
        String label = labelFor(instrumentId);
        String dirWord = direction.equals("below") ? "跌破" : "突破";
        Notification notification = new NotificationCompat.Builder(this, ALERT_CHANNEL_ID)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(label + " " + dirWord + " " + String.format(Locale.US, "%.2f", threshold))
            .setContentText("后台当前 " + String.format(Locale.US, "%.2f", price))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build();
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify((int) (System.currentTimeMillis() % Integer.MAX_VALUE), notification);
    }

    private void ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel service = new NotificationChannel(CHANNEL_ID, "黄金看板后台数据", NotificationManager.IMPORTANCE_LOW);
        service.setDescription("保持黄金看板后台原生数据服务运行");
        manager.createNotificationChannel(service);
        NotificationChannel alerts = new NotificationChannel(ALERT_CHANNEL_ID, "黄金看板后台提醒", NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription("后台到价提醒");
        manager.createNotificationChannel(alerts);
    }

    private Notification buildServiceNotification(String text) {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("黄金看板后台数据服务")
            .setContentText(text)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void updateServiceNotification(String text) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildServiceNotification(text));
    }

    private String httpGet(String url, String charset) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(8000);
        conn.setRequestProperty("User-Agent", "Mozilla/5.0 gold-phone-app-android-bg/0.1");
        conn.setRequestProperty("Referer", "https://finance.sina.com.cn");
        try {
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
            InputStream is = conn.getInputStream();
            BufferedReader br = new BufferedReader(new InputStreamReader(is, Charset.forName(charset)));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line).append('\n');
            br.close();
            return sb.toString();
        } finally {
            conn.disconnect();
        }
    }

    private static String join(String[] a) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < a.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(a[i]);
        }
        return sb.toString();
    }

    private static String get(String[] f, int i) {
        return i >= 0 && i < f.length ? f[i] : "";
    }

    private static double number(String[] f, int i) throws Exception {
        Double n = nullableNumber(f, i);
        if (n == null) throw new Exception("字段无价格");
        return n;
    }

    private static Double nullableNumber(String[] f, int i) {
        try {
            String s = get(f, i).trim();
            if (s.length() == 0 || s.equals("--")) return null;
            return Double.parseDouble(s);
        } catch (Exception e) {
            return null;
        }
    }

    private static String chinaTimestamp(String date, String time) {
        if (date != null && date.length() > 0 && time != null && time.length() > 0) return date + "T" + time + "+08:00";
        return isoNow();
    }

    private static String isoNow() {
        return new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).format(new java.util.Date());
    }

    private static String timeHhmmss(String raw) {
        if (raw != null && raw.length() == 6) return raw.substring(0, 2) + ":" + raw.substring(2, 4) + ":" + raw.substring(4, 6);
        return raw == null ? "" : raw;
    }

    private static double round2(double n) {
        return Math.round(n * 100.0) / 100.0;
    }

    private static double round3(double n) {
        return Math.round(n * 1000.0) / 1000.0;
    }

    private static String formatTime(long ms) {
        return new java.text.SimpleDateFormat("HH:mm:ss", Locale.CHINA).format(new java.util.Date(ms));
    }

    private static String labelFor(String id) {
        if (id.equals("xau-cny")) return "人民币理论金价";
        if (id.equals("xau-usd")) return "伦敦金";
        if (id.equals("usd-cny")) return "美元汇率";
        if (id.equals("sge-au9999")) return "Au99.99";
        if (id.equals("sge-autd")) return "Au(T+D)";
        if (id.equals("shfe-au-main")) return "沪金主力";
        if (id.equals("gold-etf-518880")) return "518880 ETF";
        return id;
    }
}
