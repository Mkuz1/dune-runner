package dev.dunerunner.game;

import android.app.Activity;
import android.content.Intent;

/**
 * Google Play build: no in-app updater.
 *
 * Play policy forbids an app from updating itself outside Google Play, so
 * the Play flavor ships this no-op in place of the GitHub updater
 * (src/github/.../Updater.java). Play delivers updates itself. The play
 * manifest also removes the INTERNET and REQUEST_INSTALL_PACKAGES
 * permissions, which only that updater used.
 */
final class Updater {
    static final String ACTION_INSTALL_STATUS = "dev.dunerunner.game.INSTALL_STATUS";

    Updater(Activity activity) { }

    void onResume() { }

    void onInstallStatus(Intent intent) { }
}
