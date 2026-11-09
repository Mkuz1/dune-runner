package dev.dunerunner.game;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

/**
 * In-app updates for the sideloaded APK.
 *
 * CI publishes every build of main to the public repo
 * Mkuz1/dune-runner-releases, next to a small version.json. At
 * launch (and on resume, at most once an hour) this reads that file and,
 * if its versionCode is higher than ours, offers the update. Accepting
 * downloads the APK with a progress bar and hands it to the system package
 * installer, which shows its usual "update this app?" confirmation.
 *
 * Updates only install over an APK signed with the same key, which is why
 * CI signs every published build with the project's release keystore.
 */
final class Updater {
    static final String ACTION_INSTALL_STATUS = "dev.dunerunner.game.INSTALL_STATUS";

    private static final String TAG = "DuneRunnerUpdater";
    private static final String VERSION_URL =
            "https://raw.githubusercontent.com/Mkuz1/dune-runner-releases/main/version.json";
    private static final String PAGE_URL = "https://github.com/Mkuz1/dune-runner-releases";
    private static final long RECHECK_MS = 1L * 3600 * 1000;    // launch, then on resume at most hourly

    private final Activity act;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private long lastCheck;
    private volatile boolean checking;
    private volatile boolean cancelled;
    private AlertDialog showing;
    /** Downloaded, waiting for the "install unknown apps" permission. */
    private File pendingApk;

    Updater(Activity activity) { this.act = activity; }

    /* ------------------------------------------------------------ check */

    /** Every time the game comes to the front (including launch). */
    void onResume() {
        if (pendingApk != null && canInstall()) {
            File f = pendingApk;
            pendingApk = null;
            install(f);
            return;
        }
        // give the game a moment to boot before putting a dialog over it
        ui.postDelayed(this::checkIfDue, 3500);
    }

    private void checkIfDue() {
        if (System.currentTimeMillis() - lastCheck < RECHECK_MS) return;
        check();
    }

    private void check() {
        if (checking || showing != null) return;
        checking = true;
        lastCheck = System.currentTimeMillis();
        new Thread(() -> {
            try {
                JSONObject v = new JSONObject(new String(get(VERSION_URL), "UTF-8"));
                int remote = v.getInt("versionCode");
                if (remote > currentVersionCode()) {
                    String name = v.optString("versionName", String.valueOf(remote));
                    String notes = v.optString("notes", "");
                    String apk = v.getString("apk");
                    long size = v.optLong("apkSize", -1);
                    ui.post(() -> offer(name, notes, apk, size));
                }
            } catch (Exception e) {
                Log.i(TAG, "update check skipped: " + e);     // offline, most likely
            } finally {
                checking = false;
            }
        }, "update-check").start();
    }

    private int currentVersionCode() {
        try {
            PackageInfo pi = act.getPackageManager().getPackageInfo(act.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? (int) pi.getLongVersionCode() : pi.versionCode;
        } catch (PackageManager.NameNotFoundException e) {
            return Integer.MAX_VALUE;    // never offer anything if we cannot tell
        }
    }

    private String currentVersionName() {
        try {
            return act.getPackageManager().getPackageInfo(act.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "?";
        }
    }

    /* ------------------------------------------------------------ prompt */

    private void offer(String name, String notes, String apkUrl, long size) {
        if (act.isFinishing() || showing != null) return;
        StringBuilder msg = new StringBuilder()
                .append("Dune Runner ").append(name).append(" is available — you have ")
                .append(currentVersionName()).append('.');
        if (!notes.isEmpty()) msg.append("\n\n").append(notes);
        if (size > 0) msg.append(String.format(Locale.US, "\n\nDownload: %.1f MB", size / 1048576.0));

        showing = new AlertDialog.Builder(act, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Update available")
                .setMessage(msg)
                .setPositiveButton("Download & install", (d, w) -> { showing = null; download(apkUrl, size); })
                .setNegativeButton("Later", (d, w) -> showing = null)
                .setOnCancelListener(d -> showing = null)
                .show();
    }

    /* ------------------------------------------------------------ download */

    private void download(String apkUrl, long expected) {
        ProgressBar bar = new ProgressBar(act, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(1000);
        TextView label = new TextView(act);
        label.setText("Starting…");
        label.setPadding(0, 18, 0, 0);
        LinearLayout box = new LinearLayout(act);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (22 * act.getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad / 2, pad, 0);
        box.addView(bar);
        box.addView(label);

        cancelled = false;
        AlertDialog dlg = new AlertDialog.Builder(act, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Downloading update")
                .setView(box)
                .setCancelable(false)
                .setNegativeButton("Cancel", (d, w) -> cancelled = true)
                .show();
        showing = dlg;

        File out = new File(act.getCacheDir(), "update.apk");
        new Thread(() -> {
            String error = null;
            try {
                HttpURLConnection c = open(apkUrl);
                long total = c.getContentLengthLong() > 0 ? c.getContentLengthLong() : expected;
                try (InputStream in = c.getInputStream(); OutputStream o = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    long done = 0, lastUi = 0;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        if (cancelled) throw new IOException("cancelled");
                        o.write(buf, 0, n);
                        done += n;
                        long now = System.currentTimeMillis();
                        if (now - lastUi > 120) {
                            lastUi = now;
                            final long d = done;
                            ui.post(() -> {
                                if (total > 0) bar.setProgress((int) (d * 1000 / total));
                                label.setText(String.format(Locale.US, "%.1f / %.1f MB",
                                        d / 1048576.0, Math.max(total, d) / 1048576.0));
                            });
                        }
                    }
                } finally {
                    c.disconnect();
                }
            } catch (Exception e) {
                error = cancelled ? null : e.getMessage();
                //noinspection ResultOfMethodCallIgnored
                out.delete();
            }
            final String err = error;
            ui.post(() -> {
                dlg.dismiss();
                showing = null;
                if (cancelled) return;
                if (err != null) fail("The download failed: " + err);
                else if (!canInstall()) askForInstallPermission(out);
                else install(out);
            });
        }, "update-download").start();
    }

    /* ------------------------------------------------------------ install */

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < 26 || act.getPackageManager().canRequestPackageInstalls();
    }

    /** Android 8+: the user has to allow this app to install updates once. */
    private void askForInstallPermission(File apk) {
        pendingApk = apk;
        showing = new AlertDialog.Builder(act, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("One-time permission")
                .setMessage("To install the update, allow Dune Runner to install apps on the next "
                        + "screen, then come back — the update continues by itself.")
                .setPositiveButton("Open settings", (d, w) -> {
                    showing = null;
                    act.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + act.getPackageName())));
                })
                .setNegativeButton("Not now", (d, w) -> { showing = null; pendingApk = null; })
                .setCancelable(false)
                .show();
    }

    /** Stream the APK into a PackageInstaller session; the system takes it from there. */
    private void install(File apk) {
        new Thread(() -> {
            try {
                PackageInstaller pi = act.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params =
                        new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(act.getPackageName());
                int id = pi.createSession(params);
                try (PackageInstaller.Session s = pi.openSession(id)) {
                    try (InputStream in = new FileInputStream(apk);
                         OutputStream o = s.openWrite("update.apk", 0, apk.length())) {
                        byte[] buf = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
                        s.fsync(o);
                    }
                    Intent cb = new Intent(act, MainActivity.class)
                            .setAction(ACTION_INSTALL_STATUS)
                            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT
                            | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                    s.commit(PendingIntent.getActivity(act, id, cb, flags).getIntentSender());
                }
            } catch (Exception e) {
                Log.w(TAG, "install failed", e);
                ui.post(() -> fail("Could not start the installer: " + e.getMessage()));
            }
        }, "update-install").start();
    }

    /** Called from MainActivity.onNewIntent with the installer's progress. */
    void onInstallStatus(Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        switch (status) {
            case PackageInstaller.STATUS_PENDING_USER_ACTION: {
                @SuppressWarnings("deprecation")
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) act.startActivity(confirm);
                break;
            }
            case PackageInstaller.STATUS_SUCCESS:
                break;          // the system restarts us on the new version
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                break;          // the user tapped Cancel on the system dialog
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
                fail("This copy of Dune Runner was signed with a different key, so Android will not "
                        + "update it in place. Uninstall it once, then install the latest APK from "
                        + PAGE_URL + " — future updates will then install normally.");
                break;
            default:
                String m = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                fail("The update was not installed" + (m != null ? ": " + m : "."));
        }
    }

    private void fail(String message) {
        if (act.isFinishing()) return;
        new AlertDialog.Builder(act, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Update")
                .setMessage(message)
                .setPositiveButton("OK", null)
                .show();
    }

    /* ------------------------------------------------------------ http */

    private static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setUseCaches(false);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "DuneRunner-Android");
        int code = c.getResponseCode();
        if (code != 200) {
            c.disconnect();
            throw new IOException("HTTP " + code);
        }
        return c;
    }

    private static byte[] get(String url) throws IOException {
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            return b.toByteArray();
        } finally {
            c.disconnect();
        }
    }
}
