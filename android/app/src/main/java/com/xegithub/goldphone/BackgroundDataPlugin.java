package com.xegithub.goldphone;

import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

@CapacitorPlugin(name = "BackgroundData")
public class BackgroundDataPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        Context context = getContext();
        GoldForegroundService.start(context);
        call.resolve(toJs(GoldForegroundService.statusJson(context)));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();
        GoldForegroundService.stop(context);
        JSObject ret = new JSObject();
        ret.put("running", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(toJs(GoldForegroundService.statusJson(getContext())));
    }

    @PluginMethod
    public void syncRules(PluginCall call) {
        String rules = call.getString("rules", "[]");
        Context context = getContext();
        GoldForegroundService.saveRules(context, rules);
        call.resolve(toJs(GoldForegroundService.statusJson(context)));
    }

    private JSObject toJs(JSONObject obj) {
        try {
            return JSObject.fromJSONObject(obj);
        } catch (Exception e) {
            JSObject fallback = new JSObject();
            fallback.put("running", GoldForegroundService.isRunning());
            fallback.put("error", String.valueOf(e));
            return fallback;
        }
    }
}
