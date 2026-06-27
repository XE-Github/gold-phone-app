package com.xegithub.goldphone;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * 应用内 OTA 的「唤起系统安装器」薄原生封装（阶段4）。
 *
 * 现成 Capacitor 插件都不适合旁加载安装：file-opener 故意「without installation support」，
 * app-update 走 Google Play 流程。故自写这一个方法：把已下载的 apk 文件经 FileProvider 转
 * content:// URI，构造 ACTION_VIEW Intent（apk MIME）唤起系统安装器。
 *
 * 诚实边界：仅负责把用户送到系统安装弹窗；最终「安装」需用户在系统弹窗确认（Android 安全机制，
 * 无法静默）。调用方还需 REQUEST_INSTALL_PACKAGES 权限 + 用户允许「安装未知应用」。
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    @PluginMethod
    public void installApk(PluginCall call) {
        String filePath = call.getString("filePath");
        if (filePath == null || filePath.isEmpty()) {
            call.reject("filePath 为空");
            return;
        }

        try {
            // @capacitor/filesystem getUri 返回 file:// 绝对路径；去掉 scheme 取真实路径
            String path = filePath.startsWith("file://") ? Uri.parse(filePath).getPath() : filePath;
            if (path == null) {
                call.reject("无法解析文件路径：" + filePath);
                return;
            }
            File apk = new File(path);
            if (!apk.exists()) {
                call.reject("apk 文件不存在：" + path);
                return;
            }

            // 经 FileProvider 暴露为 content:// URI（authorities 与 Manifest 中的 ${applicationId}.fileprovider 一致）
            String authority = getContext().getPackageName() + ".fileprovider";
            Uri contentUri = FileProvider.getUriForFile(getContext(), authority, apk);

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            // 从插件上下文启动需要 NEW_TASK
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            getContext().startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("launched", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("唤起安装器失败：" + e.getMessage(), e);
        }
    }
}
