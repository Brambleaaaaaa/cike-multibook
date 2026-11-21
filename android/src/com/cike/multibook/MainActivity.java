package com.cike.multibook;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.AssetFileDescriptor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String APP_HOST = "app.cike.local";
    // 英文发音包体积大、条目多，打成单文件容器以避免 APK 的 65535 条目上限。
    private static final String EN_AUDIO_PACK = "assets/audio/en/pack.bin";
    private static final Pattern EN_AUDIO_PATH =
            Pattern.compile("^/assets/audio/en/(?:en|sen)-\\d{5}\\.mp3$");
    private static final String DEFAULT_LANGUAGE = "en-US";
    private static final int FILE_CHOOSER_REQUEST = 7101;
    private static final int STORAGE_REQUEST = 7102;
    private static final int CAMERA_REQUEST = 7103;
    private static final int CAMERA_STORAGE_REQUEST = 7104;
    private static final int WEB_CAMERA_PERMISSION_REQUEST = 7105;
    private static final String AI_PREFS = "cike_ai_secure";
    private static final String AI_KEYSTORE_ALIAS = "cike-ai-master";
    private static final String AI_KEY_PREFIX = "api_key_";

    private WebView webView;
    private TextToSpeech textToSpeech;
    private volatile boolean ttsReady;
    private volatile boolean ttsInitializing = true;
    private final Object speechLock = new Object();
    private final Map<String, String> utteranceLanguages = new HashMap<>();
    private int utteranceCounter = 0;
    private String currentUtteranceId = "";
    private String currentSpeechLanguage = DEFAULT_LANGUAGE;
    private PendingSpeech pendingSpeech;
    private ValueCallback<Uri[]> filePathCallback;
    private ValueCallback<Uri[]> pendingCameraCallback;
    private PermissionRequest pendingWebPermission;
    private Uri pendingCaptureUri;
    private String pendingFilename;
    private String pendingMime;
    private String pendingBase64;

    private static class PendingSpeech {
        final String text;
        final String language;
        final float rate;
        final String utteranceId;
        final String wordId;

        PendingSpeech(String text, String language, float rate, String utteranceId, String wordId) {
            this.text = text;
            this.language = language;
            this.rate = rate;
            this.utteranceId = utteranceId;
            this.wordId = wordId;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(Color.rgb(24, 59, 53));
            getWindow().setNavigationBarColor(Color.rgb(238, 240, 231));
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            );
        }

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(238, 240, 231));
        setContentView(webView);
        configureWebView();
        setupTextToSpeech();
        webView.loadUrl("https://" + APP_HOST + "/index.html");
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        settings.setTextZoom(100);
        // 在线朗读要把音频先取回本地再播放，取回过程会脱离点击手势，
        // 因此这里放开自动播放限制；所有播放仍由用户点击朗读按钮触发。
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setBlockNetworkLoads(true);

        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view,
                    WebResourceRequest request
            ) {
                Uri uri = request.getUrl();
                if (APP_HOST.equals(uri.getHost())) {
                    String path = uri.getPath();
                    if (path != null && EN_AUDIO_PATH.matcher(path).matches()) {
                        return serveEnPackAudio(path);
                    }
                    return serveAsset(path, request.getRequestHeaders());
                }
                return responseError();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params
            ) {
                if (params.isCaptureEnabled() && acceptsImage(params.getAcceptTypes())) {
                    startCameraCapture(callback);
                    return true;
                }
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (Exception error) {
                    filePathCallback = null;
                    Toast.makeText(
                            MainActivity.this,
                            "无法打开文件选择器",
                            Toast.LENGTH_SHORT
                    ).show();
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        boolean wantsCamera = false;
                        for (String resource : request.getResources()) {
                            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                                wantsCamera = true;
                                break;
                            }
                        }
                        if (!wantsCamera) {
                            request.deny();
                            return;
                        }
                        if (checkSelfPermission(Manifest.permission.CAMERA)
                                == PackageManager.PERMISSION_GRANTED) {
                            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                            return;
                        }
                        if (pendingWebPermission != null) {
                            pendingWebPermission.deny();
                        }
                        pendingWebPermission = request;
                        requestPermissions(
                                new String[]{Manifest.permission.CAMERA},
                                WEB_CAMERA_PERMISSION_REQUEST
                        );
                    }
                });
            }
        });
    }

    private boolean acceptsImage(String[] acceptTypes) {
        if (acceptTypes == null || acceptTypes.length == 0) return true;
        for (String type : acceptTypes) {
            if (type == null) continue;
            if (type.equals("image/*") || type.startsWith("image/")) return true;
        }
        return false;
    }

    private void startCameraCapture(final ValueCallback<Uri[]> callback) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
            if (filePathCallback != null) filePathCallback.onReceiveValue(null);
            filePathCallback = callback;
            pendingCameraCallback = callback;
            requestPermissions(
                    new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                    CAMERA_STORAGE_REQUEST
            );
            return;
        }
        openCamera(callback);
    }

    private void openCamera(final ValueCallback<Uri[]> callback) {
        ContentValues values = new ContentValues();
        values.put(
                MediaStore.Images.Media.DISPLAY_NAME,
                "cike-avatar-" + System.currentTimeMillis() + ".jpg"
        );
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(
                    MediaStore.Images.Media.RELATIVE_PATH,
                    Environment.DIRECTORY_PICTURES + "/Cike"
            );
        }
        Uri target = null;
        try {
            target = getContentResolver().insert(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    values
            );
        } catch (Exception ignored) {
            // Fall through to the failure toast below.
        }
        if (target == null) {
            callback.onReceiveValue(null);
            Toast.makeText(
                    MainActivity.this,
                    "无法创建照片文件",
                    Toast.LENGTH_SHORT
            ).show();
            return;
        }
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        intent.putExtra(MediaStore.EXTRA_OUTPUT, target);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (filePathCallback != null) filePathCallback.onReceiveValue(null);
        filePathCallback = callback;
        pendingCaptureUri = target;
        try {
            startActivityForResult(intent, CAMERA_REQUEST);
        } catch (Exception error) {
            filePathCallback = null;
            pendingCaptureUri = null;
            getContentResolver().delete(target, null, null);
            callback.onReceiveValue(null);
            Toast.makeText(
                    MainActivity.this,
                    "没有可用的相机应用",
                    Toast.LENGTH_SHORT
            ).show();
        }
    }

    private boolean handleUrl(Uri uri) {
        if (APP_HOST.equals(uri.getHost())) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            Toast.makeText(this, "无法打开外部链接", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private HashMap<String, long[]> enAudioIndex = null;
    private long enAudioDataStart = 0;

    private static void readFully(InputStream stream, byte[] buffer) throws IOException {
        int offset = 0;
        while (offset < buffer.length) {
            int read = stream.read(buffer, offset, buffer.length - offset);
            if (read < 0) throw new IOException("unexpected end of pack");
            offset += read;
        }
    }

    // 索引格式："CIKEPK1\n" + 4 字节大端 JSON 长度 + JSON + 连续音频数据。
    private synchronized HashMap<String, long[]> enAudioIndex()
            throws IOException, JSONException {
        if (enAudioIndex != null) return enAudioIndex;
        AssetFileDescriptor descriptor = getAssets().openFd(EN_AUDIO_PACK);
        FileInputStream stream = new FileInputStream(descriptor.getFileDescriptor());
        try {
            stream.getChannel().position(descriptor.getStartOffset());
            byte[] magic = new byte[8];
            readFully(stream, magic);
            if (!"CIKEPK1\n".equals(new String(magic, StandardCharsets.US_ASCII))) {
                throw new IOException("bad en audio pack");
            }
            byte[] lengthBytes = new byte[4];
            readFully(stream, lengthBytes);
            long jsonLength = ((lengthBytes[0] & 0xFFL) << 24)
                    | ((lengthBytes[1] & 0xFFL) << 16)
                    | ((lengthBytes[2] & 0xFFL) << 8)
                    | (lengthBytes[3] & 0xFFL);
            if (jsonLength <= 0 || jsonLength > 64L * 1024 * 1024) {
                throw new IOException("bad en audio index");
            }
            byte[] jsonBytes = new byte[(int) jsonLength];
            readFully(stream, jsonBytes);
            JSONObject files = new JSONObject(new String(jsonBytes, StandardCharsets.UTF_8))
                    .getJSONObject("files");
            HashMap<String, long[]> index = new HashMap<>();
            Iterator<String> keys = files.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                JSONArray pair = files.getJSONArray(key);
                index.put(key, new long[]{pair.getLong(0), pair.getLong(1)});
            }
            enAudioDataStart = descriptor.getStartOffset() + 12 + jsonLength;
            enAudioIndex = index;
            return index;
        } finally {
            try {
                stream.close();
            } catch (IOException ignored) {
                // Ignore.
            }
            try {
                descriptor.close();
            } catch (IOException ignored) {
                // Ignore.
            }
        }
    }

    private WebResourceResponse serveEnPackAudio(String requestPath) {
        String name = requestPath.startsWith("/") ? requestPath.substring(1) : requestPath;
        int slash = name.lastIndexOf('/');
        if (slash >= 0) name = name.substring(slash + 1);
        AssetFileDescriptor descriptor = null;
        FileInputStream stream = null;
        try {
            long[] range = enAudioIndex().get(name);
            if (range == null || range[1] <= 0 || range[1] > 2 * 1024 * 1024) {
                return responseError();
            }
            descriptor = getAssets().openFd(EN_AUDIO_PACK);
            stream = new FileInputStream(descriptor.getFileDescriptor());
            stream.getChannel().position(enAudioDataStart + range[0]);
            byte[] data = new byte[(int) range[1]];
            readFully(stream, data);
            return new WebResourceResponse(
                    "audio/mpeg",
                    null,
                    200,
                    "OK",
                    null,
                    new ByteArrayInputStream(data)
            );
        } catch (Exception error) {
            return responseError();
        } finally {
            if (stream != null) {
                try {
                    stream.close();
                } catch (IOException ignored) {
                    // Ignore.
                }
            }
            if (descriptor != null) {
                try {
                    descriptor.close();
                } catch (IOException ignored) {
                    // Ignore.
                }
            }
        }
    }

    private WebResourceResponse serveAsset(String requestPath, Map<String, String> requestHeaders) {
        String assetPath = requestPath == null || requestPath.isEmpty()
                ? "index.html"
                : requestPath.substring(1);
        if (assetPath.contains("..") || assetPath.startsWith("/")) {
            return responseError();
        }
        String range = null;
        if (requestHeaders != null) {
            range = requestHeaders.get("Range");
            if (range == null) range = requestHeaders.get("range");
        }
        AssetFileDescriptor descriptor = null;
        if (isMediaAsset(assetPath)) {
            try {
                descriptor = getAssets().openFd(assetPath);
                return serveAssetRange(assetPath, descriptor, range);
            } catch (IOException ignored) {
                if (descriptor != null) {
                    try {
                        descriptor.close();
                    } catch (IOException ignoredClose) {
                        // Ignore.
                    }
                }
            }
        }
        try {
            InputStream stream = getAssets().open(assetPath);
            return new WebResourceResponse(
                    mimeType(assetPath),
                    "UTF-8",
                    200,
                    "OK",
                    null,
                    stream
            );
        } catch (IOException error) {
            try {
                InputStream stream = getAssets().open(assetPath.replace('/', '\\'));
                return new WebResourceResponse(
                        mimeType(assetPath),
                        "UTF-8",
                        200,
                        "OK",
                        null,
                        stream
                );
            } catch (IOException ignored) {
                // Continue to the normal not-found response.
            }
            return responseError();
        }
    }

    private WebResourceResponse serveAssetRange(
            String assetPath,
            AssetFileDescriptor descriptor,
            String range
    ) throws IOException {
        long total = descriptor.getLength();
        if (total <= 0) {
            descriptor.close();
            throw new IOException("Unknown asset length");
        }
        long start = 0;
        long end = total - 1;
        boolean partial = false;
        if (range != null && range.startsWith("bytes=")) {
            String spec = range.substring(6).split(",")[0].trim();
            int dash = spec.indexOf('-');
            if (dash >= 0) {
                try {
                    String left = spec.substring(0, dash).trim();
                    String right = spec.substring(dash + 1).trim();
                    if (!left.isEmpty()) start = Long.parseLong(left);
                    if (!right.isEmpty()) end = Long.parseLong(right);
                    partial = true;
                } catch (NumberFormatException ignored) {
                    partial = false;
                    start = 0;
                    end = total - 1;
                }
            }
        }
        if (!partial) {
            start = 0;
            end = total - 1;
        }
        if (start < 0) start = 0;
        if (end >= total) end = total - 1;
        if (start > end || start >= total) {
            descriptor.close();
            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Range", "bytes */" + total);
            return new WebResourceResponse(
                    mimeType(assetPath),
                    null,
                    416,
                    "Range Not Satisfiable",
                    headers,
                    new ByteArrayInputStream(new byte[0])
            );
        }
        FileInputStream stream = descriptor.createInputStream();
        skipFully(stream, start);
        long length = end - start + 1;
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Type", mimeType(assetPath));
        headers.put("Accept-Ranges", "bytes");
        headers.put("Content-Length", String.valueOf(length));
        headers.put("Cache-Control", "no-store");
        if (partial) {
            headers.put("Content-Range", "bytes " + start + "-" + end + "/" + total);
        }
        InputStream body = new LimitedInputStream(stream, length, descriptor);
        return new WebResourceResponse(
                mimeType(assetPath),
                null,
                partial ? 206 : 200,
                partial ? "Partial Content" : "OK",
                headers,
                body
        );
    }

    private void skipFully(InputStream stream, long bytes) throws IOException {
        long remaining = bytes;
        while (remaining > 0) {
            long skipped = stream.skip(remaining);
            if (skipped <= 0) {
                if (stream.read() < 0) throw new IOException("Unexpected end of asset");
                remaining -= 1;
            } else {
                remaining -= skipped;
            }
        }
    }

    private static class LimitedInputStream extends InputStream {
        private final InputStream inner;
        private final AssetFileDescriptor descriptor;
        private long remaining;

        LimitedInputStream(InputStream inner, long length, AssetFileDescriptor descriptor) {
            this.inner = inner;
            this.descriptor = descriptor;
            this.remaining = length;
        }

        @Override
        public int read() throws IOException {
            if (remaining <= 0) return -1;
            int value = inner.read();
            if (value >= 0) remaining -= 1;
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (remaining <= 0) return -1;
            int limit = (int) Math.min(length, remaining);
            int read = inner.read(buffer, offset, limit);
            if (read > 0) remaining -= read;
            return read;
        }

        @Override
        public int available() throws IOException {
            return (int) Math.min(inner.available(), remaining);
        }

        @Override
        public void close() throws IOException {
            try {
                inner.close();
            } finally {
                descriptor.close();
            }
        }
    }

    private WebResourceResponse responseError() {
        return new WebResourceResponse(
                "text/plain",
                "UTF-8",
                404,
                "Not Found",
                null,
                new ByteArrayInputStream(new byte[0])
        );
    }

    private boolean isMediaAsset(String path) {
        String lower = path.toLowerCase(java.util.Locale.US);
        return lower.endsWith(".mp3")
                || lower.endsWith(".m4a")
                || lower.endsWith(".wav")
                || lower.endsWith(".ogg")
                || lower.endsWith(".aac")
                || lower.endsWith(".mp4");
    }

    private String mimeType(String path) {
        String lower = path.toLowerCase(java.util.Locale.US);
        // PDF.js is loaded as an ES module. WebView enforces strict MIME checks
        // for module scripts, so .mjs must never fall through to octet-stream.
        if (lower.endsWith(".mjs") || lower.endsWith(".js")) {
            return "application/javascript";
        }
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".json") || lower.endsWith(".map")) return "application/json";
        if (lower.endsWith(".wasm")) return "application/wasm";
        if (lower.endsWith(".webmanifest")) return "application/manifest+json";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".otf")) return "font/otf";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".m4a")) return "audio/mp4";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        String guessed = URLConnection.guessContentTypeFromName(path);
        if (guessed != null) return guessed;
        return "application/octet-stream";
    }

    private void setupTextToSpeech() {
        ttsReady = false;
        ttsInitializing = true;
        textToSpeech = new TextToSpeech(getApplicationContext(), new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int status) {
                ttsInitializing = false;
                if (status == TextToSpeech.SUCCESS) {
                    ttsReady = true;
                    PendingSpeech pending;
                    synchronized (speechLock) {
                        pending = pendingSpeech;
                        pendingSpeech = null;
                    }
                    if (pending != null) {
                        final PendingSpeech next = pending;
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                speakNow(next);
                            }
                        });
                    }
                } else {
                    ttsReady = false;
                    Toast.makeText(
                            MainActivity.this,
                            "未检测到系统语音引擎，请在系统设置中安装“文字转语音”服务",
                            Toast.LENGTH_LONG
                    ).show();
                    String language;
                    synchronized (speechLock) {
                        language = currentSpeechLanguage;
                    }
                    notifySpeechStatus("error", "engine-unavailable", language, "");
                }
            }
        });
        textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {
                notifySpeechStatus("started", "", languageOf(utteranceId), utteranceId);
            }

            @Override
            public void onDone(String utteranceId) {
                notifySpeechStatus("done", "", languageOf(utteranceId), utteranceId);
                forgetUtterance(utteranceId);
            }

            @Override
            public void onError(String utteranceId) {
                notifySpeechStatus(
                        "error",
                        "voice-unavailable",
                        languageOf(utteranceId),
                        utteranceId
                );
                forgetUtterance(utteranceId);
            }

            @Override
            public void onError(String utteranceId, int errorCode) {
                notifySpeechStatus(
                        "error",
                        speechErrorCode(errorCode),
                        languageOf(utteranceId),
                        utteranceId
                );
                forgetUtterance(utteranceId);
            }

            @Override
            public void onStop(String utteranceId, boolean interrupted) {
                notifySpeechStatus(
                        interrupted ? "error" : "done",
                        interrupted ? "interrupted" : "canceled",
                        languageOf(utteranceId),
                        utteranceId
                );
                forgetUtterance(utteranceId);
            }
        });
    }

    private String requestSpeech(String text, String language, float rate, String wordId) {
        String value = text == null ? "" : text.trim();
        if (value.isEmpty()) return "";
        String normalized = normalizeLanguage(language);
        String utteranceId = nextUtteranceId(wordId);
        PendingSpeech request = new PendingSpeech(
                value,
                normalized,
                clampSpeechRate(rate),
                utteranceId,
                wordId == null ? "" : wordId
        );
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                speakOnUi(request);
            }
        });
        return utteranceId;
    }

    private String nextUtteranceId(String wordId) {
        synchronized (speechLock) {
            utteranceCounter += 1;
            String suffix = wordId == null ? "" : wordId;
            return "word:" + utteranceCounter + ":" + suffix;
        }
    }

    private void speakOnUi(PendingSpeech request) {
        synchronized (speechLock) {
            currentSpeechLanguage = request.language;
            currentUtteranceId = request.utteranceId;
            utteranceLanguages.put(request.utteranceId, request.language);
        }
        if (textToSpeech == null) {
            notifySpeechStatus(
                    "error",
                    "engine-unavailable",
                    request.language,
                    request.utteranceId
            );
            return;
        }
        if (!ttsReady) {
            synchronized (speechLock) {
                pendingSpeech = request;
            }
            if (!ttsInitializing) {
                notifySpeechStatus(
                        "error",
                        "engine-unavailable",
                        request.language,
                        request.utteranceId
                );
            }
            return;
        }
        speakNow(request);
    }

    private void speakNow(PendingSpeech request) {
        Locale locale = localeFor(request.language);
        int availability;
        try {
            availability = textToSpeech.setLanguage(locale);
        } catch (Exception error) {
            availability = TextToSpeech.LANG_NOT_SUPPORTED;
        }
        if (availability == TextToSpeech.LANG_MISSING_DATA
                || availability == TextToSpeech.LANG_NOT_SUPPORTED) {
            Toast.makeText(
                    this,
                    "当前手机没有可用的" + languageLabel(request.language)
                            + "语音，请在系统“文字转语音”中安装语音包",
                    Toast.LENGTH_LONG
            ).show();
            notifySpeechStatus(
                    "error",
                    "language-unavailable",
                    request.language,
                    request.utteranceId
            );
            return;
        }

        Voice voice = pickBestVoice(locale);
        if (voice != null) {
            try {
                textToSpeech.setVoice(voice);
            } catch (Exception ignored) {
                // Keep the engine's default voice for this locale.
            }
            if (voice.isNetworkConnectionRequired()) {
                Toast.makeText(
                        this,
                        "当前语音需要网络，建议在系统“文字转语音”中安装离线语音包",
                        Toast.LENGTH_LONG
                ).show();
            }
        }

        boolean started;
        try {
            // 切换单词时先停掉上一条，再以 QUEUE_FLUSH 播放新内容，避免叠音。
            textToSpeech.stop();
            textToSpeech.setSpeechRate(clampSpeechRate(request.rate));
            started = textToSpeech.speak(
                    request.text,
                    TextToSpeech.QUEUE_FLUSH,
                    null,
                    request.utteranceId
            ) != TextToSpeech.ERROR;
        } catch (Exception error) {
            started = false;
        }
        if (!started) {
            notifySpeechStatus(
                    "error",
                    "voice-unavailable",
                    request.language,
                    request.utteranceId
            );
        }
    }

    private Voice pickBestVoice(Locale target) {
        Set<Voice> voices;
        try {
            voices = textToSpeech.getVoices();
        } catch (Exception error) {
            return null;
        }
        if (voices == null || voices.isEmpty()) return null;

        Voice best = null;
        int bestScore = Integer.MIN_VALUE;
        for (Voice voice : voices) {
            if (voice == null) continue;
            Locale locale = voice.getLocale();
            if (locale == null || !target.getLanguage().equals(locale.getLanguage())) continue;
            try {
                Set<String> features = voice.getFeatures();
                if (features != null
                        && features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) {
                    continue;
                }
            } catch (Exception ignored) {
                // Older engines may not report installation state.
            }
            int score = 0;
            if (!voice.isNetworkConnectionRequired()) score += 10000;
            if (target.getCountry().equalsIgnoreCase(locale.getCountry())) score += 4000;
            score += voice.getQuality() * 100;
            score += Math.max(0, 1000 - voice.getLatency());
            String name = voice.getName() == null
                    ? ""
                    : voice.getName().toLowerCase(Locale.ROOT);
            if (name.contains("natural") || name.contains("neural")) score += 1500;
            if (score > bestScore) {
                bestScore = score;
                best = voice;
            }
        }
        return best;
    }

    private static float clampSpeechRate(float rate) {
        if (Float.isNaN(rate)) return 0.88f;
        return Math.max(0.5f, Math.min(1.5f, rate));
    }

    private static String normalizeLanguage(String language) {
        if (language == null) return DEFAULT_LANGUAGE;
        String value = language.trim().replace('_', '-');
        String lower = value.toLowerCase(Locale.ROOT);
        if (lower.startsWith("fr")) return "fr-FR";
        // 粤语必须先于通用中文判断，否则会被当成普通话朗读。
        if (lower.startsWith("yue") || lower.startsWith("zh-hk")) return "zh-HK";
        if (lower.startsWith("zh")) return "zh-CN";
        if (lower.startsWith("en-gb")) return "en-GB";
        if (lower.startsWith("en")) return "en-US";
        if (lower.startsWith("es")) return "es-ES";
        if (lower.startsWith("de")) return "de-DE";
        if (lower.startsWith("it")) return "it-IT";
        if (lower.startsWith("ja")) return "ja-JP";
        if (lower.startsWith("ko")) return "ko-KR";
        if (lower.startsWith("ru")) return "ru-RU";
        // 系统一般没有拉丁语语音包，沿用意大利语读音兜底。
        if (lower.startsWith("la")) return "it-IT";
        return "en-US";
    }

    private static Locale localeFor(String language) {
        if ("fr-FR".equals(language)) return Locale.FRANCE;
        if ("en-GB".equals(language)) return Locale.UK;
        if ("zh-CN".equals(language)) return Locale.SIMPLIFIED_CHINESE;
        if ("es-ES".equals(language)) return new Locale("es", "ES");
        if ("de-DE".equals(language)) return Locale.GERMANY;
        if ("it-IT".equals(language)) return Locale.ITALY;
        if ("ja-JP".equals(language)) return Locale.JAPAN;
        if ("ko-KR".equals(language)) return Locale.KOREA;
        if ("ru-RU".equals(language)) return new Locale("ru", "RU");
        if ("zh-HK".equals(language)) return new Locale("zh", "HK");
        return Locale.US;
    }

    private static String languageLabel(String language) {
        if (language == null) return "英语";
        if (language.startsWith("fr")) return "法语";
        if (language.startsWith("es")) return "西班牙语";
        if (language.startsWith("de")) return "德语";
        if (language.startsWith("it")) return "意大利语";
        if (language.startsWith("ja")) return "日语";
        if (language.startsWith("ko")) return "韩语";
        if (language.startsWith("ru")) return "俄语";
        if (language.startsWith("yue")) return "粤语";
        if (language.startsWith("zh")) return "中文";
        return "英语";
    }

    private static String speechErrorCode(int errorCode) {
        if (errorCode == TextToSpeech.ERROR_NETWORK
                || errorCode == TextToSpeech.ERROR_NETWORK_TIMEOUT) {
            return "network-voice";
        }
        return "voice-unavailable";
    }

    private String languageOf(String utteranceId) {
        synchronized (speechLock) {
            String value = utteranceLanguages.get(utteranceId);
            return value == null ? currentSpeechLanguage : value;
        }
    }

    private void forgetUtterance(String utteranceId) {
        synchronized (speechLock) {
            utteranceLanguages.remove(utteranceId);
        }
    }

    private void stopSpeechInternal() {
        synchronized (speechLock) {
            pendingSpeech = null;
        }
        if (textToSpeech != null) {
            try {
                textToSpeech.stop();
            } catch (Exception ignored) {
                // Nothing to stop.
            }
        }
        String utteranceId;
        String language;
        synchronized (speechLock) {
            utteranceId = currentUtteranceId;
            language = currentSpeechLanguage;
        }
        if (!utteranceId.isEmpty()) {
            notifySpeechStatus("done", "canceled", language, utteranceId);
        }
    }

    private void notifySpeechStatus(
            String state,
            String code,
            String language,
            String utteranceId
    ) {
        final WebView target = webView;
        if (target == null) return;
        final String script =
                "window.dispatchEvent(new CustomEvent('cike:speech-status',{detail:{state:"
                + JSONObject.quote(state)
                + ",code:"
                + JSONObject.quote(code == null ? "" : code)
                + ",language:"
                + JSONObject.quote(language == null ? DEFAULT_LANGUAGE : language)
                + ",utteranceId:"
                + JSONObject.quote(utteranceId == null ? "" : utteranceId)
                + "}}));";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    target.evaluateJavascript(script, null);
                } catch (Exception ignored) {
                    // WebView may already be destroyed.
                }
            }
        });
    }

    private void openTtsSettings() {
        try {
            startActivity(new Intent("com.android.settings.TTS_SETTINGS"));
        } catch (Exception ignored) {
            try {
                startActivity(new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA));
            } catch (Exception secondError) {
                Toast.makeText(this, "请到系统设置搜索“文字转语音”", Toast.LENGTH_LONG).show();
            }
        }
    }

    private void saveBase64File(String filename, String mime, String base64) {
        byte[] bytes;
        try {
            bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            Toast.makeText(this, "导出文件编码失败", Toast.LENGTH_SHORT).show();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveWithMediaStore(filename, mime, bytes);
            return;
        }
        if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
            pendingFilename = filename;
            pendingMime = mime;
            pendingBase64 = base64;
            requestPermissions(
                    new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                    STORAGE_REQUEST
            );
            return;
        }
        saveLegacy(filename, mime, bytes);
    }

    private void saveWithMediaStore(String filename, String mime, byte[] bytes) {
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/词刻多语词书");
        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            Toast.makeText(this, "无法创建导出文件", Toast.LENGTH_SHORT).show();
            return;
        }
        try (OutputStream stream = getContentResolver().openOutputStream(uri)) {
            if (stream == null) throw new IOException("No output stream");
            stream.write(bytes);
            Toast.makeText(this, "已保存到“下载/词刻多语词书”", Toast.LENGTH_LONG).show();
        } catch (IOException error) {
            Toast.makeText(this, "导出失败，请重试", Toast.LENGTH_SHORT).show();
        }
    }

    private void saveLegacy(String filename, String mime, byte[] bytes) {
        File directory = new File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                "词刻多语词书"
        );
        if (!directory.exists() && !directory.mkdirs()) {
            Toast.makeText(this, "无法创建下载目录", Toast.LENGTH_SHORT).show();
            return;
        }
        File output = uniqueFile(directory, filename);
        try (FileOutputStream stream = new FileOutputStream(output)) {
            stream.write(bytes);
            Toast.makeText(this, "已保存到 " + output.getAbsolutePath(), Toast.LENGTH_LONG).show();
        } catch (IOException error) {
            Toast.makeText(this, "导出失败，请检查存储权限", Toast.LENGTH_SHORT).show();
        }
    }

    private File uniqueFile(File directory, String filename) {
        File file = new File(directory, filename);
        if (!file.exists()) return file;
        int dot = filename.lastIndexOf('.');
        String base = dot > 0 ? filename.substring(0, dot) : filename;
        String extension = dot > 0 ? filename.substring(dot) : "";
        for (int index = 2; index < 1000; index++) {
            File candidate = new File(directory, base + "-" + index + extension);
            if (!candidate.exists()) return candidate;
        }
        return new File(directory, base + "-" + System.currentTimeMillis() + extension);
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == WEB_CAMERA_PERMISSION_REQUEST) {
            PermissionRequest request = pendingWebPermission;
            pendingWebPermission = null;
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (request != null) {
                if (granted) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } else {
                    request.deny();
                    Toast.makeText(this, "需要相机权限才能实时扫描", Toast.LENGTH_LONG).show();
                }
            }
            return;
        }
        if (requestCode == CAMERA_STORAGE_REQUEST) {
            ValueCallback<Uri[]> callback = pendingCameraCallback;
            pendingCameraCallback = null;
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted && callback != null) {
                openCamera(callback);
            } else {
                if (callback != null) callback.onReceiveValue(null);
                filePathCallback = null;
                Toast.makeText(this, "需要存储权限才能保存照片", Toast.LENGTH_LONG).show();
            }
            return;
        }
        if (requestCode != STORAGE_REQUEST || pendingBase64 == null) return;
        if (grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            saveBase64File(pendingFilename, pendingMime, pendingBase64);
        } else {
            Toast.makeText(this, "需要存储权限才能导出备份", Toast.LENGTH_LONG).show();
        }
        pendingBase64 = null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == CAMERA_REQUEST) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && pendingCaptureUri != null) {
                results = new Uri[]{pendingCaptureUri};
            } else if (pendingCaptureUri != null) {
                getContentResolver().delete(pendingCaptureUri, null, null);
            }
            pendingCaptureUri = null;
            if (filePathCallback != null) filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }
        if (requestCode != FILE_CHOOSER_REQUEST || filePathCallback == null) return;
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getData() != null) {
                results = new Uri[]{data.getData()};
            } else if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int index = 0; index < count; index++) {
                    results[index] = data.getClipData().getItemAt(index).getUri();
                }
            }
        }
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        // 单页应用没有 history 记录，交给网页端判断：先关弹层、再逐级返回，首页才退出。
        webView.evaluateJavascript(
                "(function(){try{return window.CikeAndroidBack?window.CikeAndroidBack():'exit';}catch(e){return 'exit';}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (value == null || value.contains("exit")) {
                            MainActivity.super.onBackPressed();
                        }
                    }
                });
    }

    @Override
    protected void onPause() {
        // 切后台或划掉任务前，让网页端立即把进度写进 localStorage / IndexedDB。
        if (webView != null) {
            webView.evaluateJavascript(
                    "(window.CikeFlushState&&window.CikeFlushState(),true)", null);
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
        }
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    private SecretKey aiMasterKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(AI_KEYSTORE_ALIAS)) {
            KeyStore.Entry entry = keyStore.getEntry(AI_KEYSTORE_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
        }
        KeyGenerator generator =
                KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(
                new KeyGenParameterSpec.Builder(
                                AI_KEYSTORE_ALIAS,
                                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build());
        return generator.generateKey();
    }

    private String encryptSecret(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, aiMasterKey());
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] payload = new byte[1 + iv.length + encrypted.length];
        payload[0] = (byte) iv.length;
        System.arraycopy(iv, 0, payload, 1, iv.length);
        System.arraycopy(encrypted, 0, payload, 1 + iv.length, encrypted.length);
        return Base64.encodeToString(payload, Base64.NO_WRAP);
    }

    private String decryptSecret(String encoded) throws Exception {
        byte[] payload = Base64.decode(encoded, Base64.NO_WRAP);
        if (payload.length < 2) throw new IllegalArgumentException("bad payload");
        int ivLength = payload[0] & 0xff;
        if (ivLength <= 0 || payload.length <= 1 + ivLength) {
            throw new IllegalArgumentException("bad iv");
        }
        byte[] iv = Arrays.copyOfRange(payload, 1, 1 + ivLength);
        byte[] encrypted = Arrays.copyOfRange(payload, 1 + ivLength, payload.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, aiMasterKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    private String readApiKey(String provider) {
        SharedPreferences preferences =
                getSharedPreferences(AI_PREFS, Context.MODE_PRIVATE);
        String stored = preferences.getString(AI_KEY_PREFIX + provider, "");
        if (stored == null || stored.isEmpty()) return "";
        try {
            return decryptSecret(stored);
        } catch (Exception error) {
            return "";
        }
    }

    private void writeApiKey(String provider, String value) {
        try {
            String encrypted = encryptSecret(value);
            getSharedPreferences(AI_PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(AI_KEY_PREFIX + provider, encrypted)
                    .commit();
        } catch (Exception error) {
            runOnUiThread(
                    new Runnable() {
                        @Override
                        public void run() {
                            Toast.makeText(MainActivity.this, "API Key 保存失败", Toast.LENGTH_SHORT)
                                    .show();
                        }
                    });
        }
    }

    private void deleteApiKey(String provider) {
        getSharedPreferences(AI_PREFS, Context.MODE_PRIVATE)
                .edit()
                .remove(AI_KEY_PREFIX + provider)
                .commit();
    }

    private static String readStream(InputStream stream) throws IOException {
        if (stream == null) return "";
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        while ((read = stream.read(chunk)) != -1) {
            buffer.write(chunk, 0, read);
        }
        return buffer.toString("UTF-8");
    }

    private String aiChatRequest(String provider, String baseUrl, String bodyJson) {
        JSONObject result = new JSONObject();
        HttpURLConnection connection = null;
        try {
            String apiKey = readApiKey(provider);
            if (apiKey.isEmpty()) {
                result.put("ok", false);
                result.put("error", "missing-key");
                return result.toString();
            }
            String base = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
            if (base.isEmpty()) {
                result.put("ok", false);
                result.put("error", "missing-base-url");
                return result.toString();
            }
            URL url = new URL(base + "/chat/completions");
            byte[] payload = bodyJson.getBytes(StandardCharsets.UTF_8);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(90000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + apiKey);
            connection.setFixedLengthStreamingMode(payload.length);
            OutputStream output = connection.getOutputStream();
            try {
                output.write(payload);
                output.flush();
            } finally {
                output.close();
            }
            int status = connection.getResponseCode();
            InputStream stream =
                    status >= 200 && status < 300
                            ? connection.getInputStream()
                            : connection.getErrorStream();
            String body = readStream(stream);
            result.put("ok", status >= 200 && status < 300);
            result.put("status", status);
            result.put("body", body);
        } catch (Exception error) {
            try {
                result.put("ok", false);
                result.put("error", String.valueOf(error));
            } catch (Exception ignored) {
                return "{\"ok\":false,\"error\":\"request-failed\"}";
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
        return result.toString();
    }

    private String onlineGetRequest(String rawUrl) {
        JSONObject result = new JSONObject();
        HttpURLConnection connection = null;
        try {
            URL url = new URL(rawUrl);
            String host = url.getHost();
            boolean allowed =
                    "api.mymemory.translated.net".equals(host)
                            || "translate.googleapis.com".equals(host)
                            || "translate.google.com".equals(host);
            if (!"https".equalsIgnoreCase(url.getProtocol()) || !allowed) {
                result.put("ok", false);
                result.put("error", "host-not-allowed");
                return result.toString();
            }
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            InputStream stream =
                    status >= 200 && status < 300
                            ? connection.getInputStream()
                            : connection.getErrorStream();
            String body = readStream(stream);
            if (body.length() > 600000) body = body.substring(0, 600000);
            result.put("ok", status >= 200 && status < 300);
            result.put("status", status);
            result.put("body", body);
        } catch (Exception error) {
            try {
                result.put("ok", false);
                result.put("error", String.valueOf(error));
            } catch (Exception ignored) {
                return "{\"ok\":false,\"error\":\"request-failed\"}";
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
        return result.toString();
    }

    private String onlinePostRequest(String rawUrl, String bodyJson) {
        JSONObject result = new JSONObject();
        HttpURLConnection connection = null;
        try {
            URL url = new URL(rawUrl);
            boolean allowed = "transmart.qq.com".equals(url.getHost());
            if (!"https".equalsIgnoreCase(url.getProtocol()) || !allowed) {
                result.put("ok", false);
                result.put("error", "host-not-allowed");
                return result.toString();
            }
            byte[] payload = (bodyJson == null ? "{}" : bodyJson).getBytes(StandardCharsets.UTF_8);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(12000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Origin", "https://transmart.qq.com");
            connection.setRequestProperty("Referer", "https://transmart.qq.com/");
            connection.setFixedLengthStreamingMode(payload.length);
            OutputStream output = connection.getOutputStream();
            try {
                output.write(payload);
                output.flush();
            } finally {
                output.close();
            }
            int status = connection.getResponseCode();
            InputStream stream =
                    status >= 200 && status < 300
                            ? connection.getInputStream()
                            : connection.getErrorStream();
            String body = readStream(stream);
            if (body.length() > 600000) body = body.substring(0, 600000);
            result.put("ok", status >= 200 && status < 300);
            result.put("status", status);
            result.put("body", body);
        } catch (Exception error) {
            try {
                result.put("ok", false);
                result.put("error", String.valueOf(error));
            } catch (Exception ignored) {
                return "{\"ok\":false,\"error\":\"request-failed\"}";
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
        return result.toString();
    }

    // 英文朗读音频体积很小（几十到几百 KB），整体取回后交给网页端以 Blob 播放，
    // 这样 WebView 仍然保持断网状态（blockNetworkLoads），也不必改动资源拦截逻辑。
    private static final int AUDIO_MAX_BYTES = 350 * 1024;

    private String fetchAudioRequest(String rawUrl) {
        JSONObject result = new JSONObject();
        HttpURLConnection connection = null;
        try {
            URL url = new URL(rawUrl);
            boolean allowed = "fanyi.baidu.com".equals(url.getHost());
            if (!"https".equalsIgnoreCase(url.getProtocol()) || !allowed) {
                result.put("ok", false);
                result.put("error", "host-not-allowed");
                return result.toString();
            }
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(15000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "*/*");
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android)");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                result.put("ok", false);
                result.put("error", "HTTP " + status);
                return result.toString();
            }
            InputStream stream = connection.getInputStream();
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = stream.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
                if (buffer.size() > AUDIO_MAX_BYTES) {
                    result.put("ok", false);
                    result.put("error", "audio-too-large");
                    return result.toString();
                }
            }
            if (buffer.size() < 500) {
                result.put("ok", false);
                result.put("error", "audio-empty");
                return result.toString();
            }
            result.put("ok", true);
            result.put(
                    "base64",
                    Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP)
            );
        } catch (Exception error) {
            try {
                result.put("ok", false);
                result.put("error", String.valueOf(error));
            } catch (Exception ignored) {
                return "{\"ok\":false,\"error\":\"request-failed\"}";
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
        return result.toString();
    }

    private class AndroidBridge {
        @JavascriptInterface
        public int getSpeechStatus() {
            if (ttsReady) return 1;
            return ttsInitializing ? 0 : -1;
        }

        @JavascriptInterface
        public String speak(String text, String language, float rate) {
            return speakWord(text, language, rate, "");
        }

        @JavascriptInterface
        public String speakWord(String text, String language, float rate, String wordId) {
            return requestSpeech(text, language, rate, wordId);
        }

        @JavascriptInterface
        public void stopSpeech() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    stopSpeechInternal();
                }
            });
        }

        @JavascriptInterface
        public void saveFile(final String filename, final String mime, final String base64) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    saveBase64File(filename, mime, base64);
                }
            });
        }

        @JavascriptInterface
        public void setScannerMode(final boolean enabled) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (webView != null) {
                        webView.getSettings().setMediaPlaybackRequiresUserGesture(!enabled);
                    }
                }
            });
        }

        @JavascriptInterface
        public void openVoiceSettings() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    openTtsSettings();
                }
            });
        }

        @JavascriptInterface
        public boolean saveApiKey(String provider, String key) {
            if (provider == null || provider.isEmpty() || key == null || key.isEmpty()) {
                return false;
            }
            writeApiKey(provider, key);
            return true;
        }

        @JavascriptInterface
        public String getApiKey(String provider) {
            return readApiKey(provider == null ? "" : provider);
        }

        @JavascriptInterface
        public boolean hasApiKey(String provider) {
            return !readApiKey(provider == null ? "" : provider).isEmpty();
        }

        @JavascriptInterface
        public void clearApiKey(String provider) {
            deleteApiKey(provider == null ? "" : provider);
        }

        @JavascriptInterface
        public void finish() {
            runOnUiThread(
                    new Runnable() {
                        @Override
                        public void run() {
                            MainActivity.this.finish();
                        }
                    });
        }

        @JavascriptInterface
        public void httpGet(final String requestId, final String rawUrl) {
            final String safeId = requestId == null ? "" : requestId;
            final String safeUrl = rawUrl == null ? "" : rawUrl;
            new Thread(
                            new Runnable() {
                                @Override
                                public void run() {
                                    final String payload = onlineGetRequest(safeUrl);
                                    runOnUiThread(
                                            new Runnable() {
                                                @Override
                                                public void run() {
                                                    if (webView == null) return;
                                                    webView.evaluateJavascript(
                                                            "(window.CikeOnline&&window.CikeOnline.onResult("
                                                                    + JSONObject.quote(safeId)
                                                                    + ","
                                                                    + JSONObject.quote(payload)
                                                                    + "))",
                                                            null);
                                                }
                                            });
                                }
                            },
                            "cike-online-get")
                    .start();
        }

        @JavascriptInterface
        public void httpPost(final String requestId, final String rawUrl, final String bodyJson) {
            final String safeId = requestId == null ? "" : requestId;
            final String safeUrl = rawUrl == null ? "" : rawUrl;
            final String safeBody = bodyJson == null ? "{}" : bodyJson;
            new Thread(
                            new Runnable() {
                                @Override
                                public void run() {
                                    final String payload = onlinePostRequest(safeUrl, safeBody);
                                    runOnUiThread(
                                            new Runnable() {
                                                @Override
                                                public void run() {
                                                    if (webView == null) return;
                                                    webView.evaluateJavascript(
                                                            "(window.CikeOnline&&window.CikeOnline.onResult("
                                                                    + JSONObject.quote(safeId)
                                                                    + ","
                                                                    + JSONObject.quote(payload)
                                                                    + "))",
                                                            null);
                                                }
                                            });
                                }
                            },
                            "cike-online-post")
                    .start();
        }

        @JavascriptInterface
        public void fetchAudio(final String requestId, final String rawUrl) {
            final String safeId = requestId == null ? "" : requestId;
            final String safeUrl = rawUrl == null ? "" : rawUrl;
            new Thread(
                            new Runnable() {
                                @Override
                                public void run() {
                                    final String payload = fetchAudioRequest(safeUrl);
                                    runOnUiThread(
                                            new Runnable() {
                                                @Override
                                                public void run() {
                                                    if (webView == null) return;
                                                    webView.evaluateJavascript(
                                                            "(window.CikeSpeechAudio&&window.CikeSpeechAudio.onResult("
                                                                    + JSONObject.quote(safeId)
                                                                    + ","
                                                                    + JSONObject.quote(payload)
                                                                    + "))",
                                                            null
                                                    );
                                                }
                                            });
                                }
                            },
                            "cike-speech-audio")
                    .start();
        }

        @JavascriptInterface
        public void aiChat(
                final String requestId, final String provider, final String baseUrl, final String bodyJson) {
            final String safeProvider = provider == null ? "" : provider;
            final String safeBase = baseUrl == null ? "" : baseUrl;
            final String safeBody = bodyJson == null ? "{}" : bodyJson;
            new Thread(
                            new Runnable() {
                                @Override
                                public void run() {
                                    final String payload = aiChatRequest(safeProvider, safeBase, safeBody);
                                    runOnUiThread(
                                            new Runnable() {
                                                @Override
                                                public void run() {
                                                    if (webView == null) return;
                                                    webView.evaluateJavascript(
                                                            "(window.CikeAI&&window.CikeAI.onBridgeResult("
                                                                    + JSONObject.quote(requestId)
                                                                    + ","
                                                                    + JSONObject.quote(payload)
                                                                    + "))",
                                                            null);
                                                }
                                            });
                                }
                            },
                            "cike-ai-chat")
                    .start();
        }
    }
}
