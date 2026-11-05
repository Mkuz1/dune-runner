package dev.dunerunner.game;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.res.AssetManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Dune Runner — a full-screen WebView host.
 *
 * The whole game (HTML, JS, three.js) ships inside assets/game and runs
 * offline. The only network use is the update check (see Updater).
 *
 * Why the assets are served instead of loaded as file:// —
 *   Browsers refuse to load ES modules from a file:// URL: the origin is
 *   "null" and the module fetch is blocked by CORS, so <script type="module">
 *   silently never executes. The game is built from ES modules, so loading
 *   file:///android_asset/... leaves it stuck on the loading screen forever.
 *   Instead every request to the reserved host appassets.androidplatform.net
 *   is intercepted and answered straight out of the APK. That gives the page
 *   a real https origin, which also makes it a secure context, so localStorage
 *   and everything else behaves exactly as it does on the web build.
 *
 * Layout changes — rotation, folding, unfolding, split-screen, desktop
 * windowing on Chromebooks — are all declared in configChanges, so the
 * Activity is never recreated and the WebGL context is never lost.
 */
public class MainActivity extends Activity {

    /** Reserved by Google for exactly this purpose; it never resolves on DNS. */
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String ASSET_PREFIX = "/assets/";
    private static final String GAME_URL =
            "https://" + ASSET_HOST + ASSET_PREFIX + "game/index.html";

    private WebView web;
    private Updater updater;

    @SuppressLint({"SetJavaScriptEnabled"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setBackgroundDrawableResource(R.color.game_bg);

        // Draw behind the notch / hole-punch on every device that has one.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setSustainedPerformanceMode(true);
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#05080b"));
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // Never inset the content: the game draws edge to edge and keeps its
        // own controls clear of the cutout with env(safe-area-inset-*).
        root.setFitsSystemWindows(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            root.setOnApplyWindowInsetsListener((v, insets) -> WindowInsets.CONSUMED);
        }

        web = new WebView(this);
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(Color.parseColor("#05080b"));
        web.setFitsSystemWindows(false);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setOnLongClickListener(v -> true);       // no text-selection popups
        web.setHapticFeedbackEnabled(false);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);            // localStorage for saved settings
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);             // not needed: we serve the assets
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);   // WebAudio starts on tap
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setTextZoom(100);                      // ignore the system font scale
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setOffscreenPreRaster(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(false);     // nothing is loaded from the net
        }

        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        web.setWebViewClient(new AssetClient(getAssets()));
        web.setWebChromeClient(new WebChromeClient());

        root.addView(web);
        setContentView(root);

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(GAME_URL);

        goImmersive();
        updater = new Updater(this);
    }

    /** The package installer reports back here (launchMode is singleTask). */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && Updater.ACTION_INSTALL_STATUS.equals(intent.getAction()) && updater != null) {
            updater.onInstallStatus(intent);
        }
    }

    /* ------------------------------------------------------------------
       Serve everything under assets/game from a virtual https origin.
    ------------------------------------------------------------------ */
    private static class AssetClient extends WebViewClient {
        private final AssetManager assets;
        private static final Map<String, String> MIME = new HashMap<>();
        static {
            MIME.put("html", "text/html");
            MIME.put("js",   "text/javascript");
            MIME.put("mjs",  "text/javascript");
            MIME.put("css",  "text/css");
            MIME.put("json", "application/json");
            MIME.put("webmanifest", "application/manifest+json");
            MIME.put("png",  "image/png");
            MIME.put("jpg",  "image/jpeg");
            MIME.put("jpeg", "image/jpeg");
            MIME.put("svg",  "image/svg+xml");
            MIME.put("ico",  "image/x-icon");
            MIME.put("woff2","font/woff2");
            MIME.put("txt",  "text/plain");
        }

        AssetClient(AssetManager assets) { this.assets = assets; }

        private static boolean isText(String mime) {
            return mime.startsWith("text/") || mime.contains("json")
                    || mime.contains("javascript") || mime.contains("svg");
        }

        private WebResourceResponse serve(Uri uri) {
            String path = uri.getPath();
            if (path == null || !path.startsWith(ASSET_PREFIX)) return null;
            if (path.contains("..")) return notFound();

            String assetPath = path.substring(ASSET_PREFIX.length());
            if (assetPath.isEmpty() || assetPath.endsWith("/")) assetPath += "index.html";

            int dot = assetPath.lastIndexOf('.');
            String ext = dot >= 0 ? assetPath.substring(dot + 1).toLowerCase() : "";
            String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";

            try {
                InputStream in = assets.open(assetPath);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                return new WebResourceResponse(
                        mime, isText(mime) ? "utf-8" : null,
                        200, "OK", headers, in);
            } catch (IOException e) {
                return notFound();
            }
        }

        private WebResourceResponse notFound() {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    new HashMap<>(), new java.io.ByteArrayInputStream(new byte[0]));
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (ASSET_HOST.equals(u.getHost())) return serve(u);
            return null;
        }

        // Older WebViews still call the String overload for some sub-resources.
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            Uri u = Uri.parse(url);
            if (ASSET_HOST.equals(u.getHost())) return serve(u);
            return null;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            // The game is entirely local; block navigation anywhere else.
            return !ASSET_HOST.equals(req.getUrl().getHost());
        }
    }

    /** Hide the status and navigation bars, and bring them back on a swipe. */
    private void goImmersive() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) goImmersive();
    }

    /**
     * Fold, unfold, rotate, split-screen: the Activity survives thanks to
     * configChanges, so we only re-assert immersive mode and let the WebView
     * re-layout. The game listens for its own resize event.
     */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        goImmersive();
        if (web != null) {
            web.requestLayout();
            web.evaluateJavascript("window.dispatchEvent(new Event('resize'));", null);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) { web.onPause(); web.pauseTimers(); }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) { web.resumeTimers(); web.onResume(); }
        goImmersive();
        if (updater != null) updater.onResume();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) { finish(); return true; }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.loadUrl("about:blank");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
