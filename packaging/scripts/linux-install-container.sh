#!/usr/bin/env bash
# Only inside a disposable container; never execute this on the developer/owner host.
set -euo pipefail
[[ -f /.dockerenv && -d /packages && -d /test-scripts ]] || { echo 'Disposable test container required.' >&2; exit 2; }
export PATH="/test-tools:$PATH"
export DEBIAN_FRONTEND=noninteractive
rtk proxy apt-get update -qq
rtk proxy apt-get install -y --no-install-recommends xvfb xauth xdotool imagemagick desktop-file-utils dbus-x11 x11-utils /packages/practice-institute_0.1.0_amd64.deb > /results/apt-install.log 2>&1
rtk proxy useradd --create-home --shell /bin/bash owner
rtk proxy chmod 1777 /results
ENTRY='/usr/share/applications/practice-institute.desktop'
[[ -f "$ENTRY" ]] || ENTRY='/usr/share/applications/practice-institute-desktop.desktop'
rtk proxy desktop-file-validate "$ENTRY"
rtk proxy cp "$ENTRY" /results/installed.desktop
rtk proxy runuser -u owner -- env PATH="$PATH" xvfb-run -a -s '-screen 0 1024x768x24' \
  '/opt/Practice Institute/resources/runtime/python/bin/python3' -I -B /test-scripts/linux-installed-gui.py
# Exercise the full owner/two-browser spec against the installed .deb runtime.
# Node/browser bundles are read-only developer test instruments, never owner requirements.
rtk proxy env PATH="/test-node/bin:$PATH" node /project/app/node_modules/playwright/cli.js install-deps chromium > /results/browser-test-deps.log 2>&1
rtk proxy cp -a /project/app /tmp/packaged-app
rtk proxy mkdir -p /tmp/reports /tmp/screenshots
rtk proxy chmod -R a+rwX /tmp/packaged-app /tmp/reports /tmp/screenshots
BROWSER_EXIT=0
rtk proxy runuser -u owner -- env PATH="/test-node/bin:$PATH" \
  PLAYWRIGHT_BROWSERS_PATH=/test-browsers PI_PACKAGED_ROOT='/opt/Practice Institute/resources/runtime' \
  PW_CHROMIUM=/test-browsers/chromium-1243/chrome-linux64/chrome \
  bash -c 'cd /tmp/packaged-app && rtk proxy node node_modules/@playwright/test/cli.js test -c playwright.packaged.config.ts' > /results/packaged-installed.log 2>&1 || BROWSER_EXIT=$?
rtk proxy cp -a /tmp/reports/packaged-playwright-results /results/
[[ "$BROWSER_EXIT" == 0 ]] || exit "$BROWSER_EXIT"
# A separately built 0.1.1 fixture exercises apt's real version upgrade path.
rtk proxy sha256sum /home/owner/.local/share/practice-institute/data/practice-institute.sqlite3 /home/owner/.config/practice-institute/config.json > /results/profile-before-upgrade.sha256
rtk proxy apt-get install -y /upgrade/practice-institute_0.1.1_amd64.deb > /results/apt-upgrade.log 2>&1
[[ "$(rtk proxy dpkg-query -W -f='${Version}' practice-institute-desktop)" == '0.1.1' ]]
rtk proxy cp "$ENTRY" /results/installed.desktop
rtk proxy runuser -u owner -- env PATH="$PATH" xvfb-run -a -s '-screen 0 1024x768x24' \
  '/opt/Practice Institute/resources/runtime/python/bin/python3' -I -B /test-scripts/linux-installed-gui.py
rtk proxy runuser -u owner -- env PI_DATA_DIR=/home/owner/.local/share/practice-institute/data \
  '/opt/Practice Institute/resources/runtime/python/bin/python3' -I -B -m practice_institute.cli owner-status > /results/owner-after-upgrade.json
rtk proxy sha256sum -c /results/profile-before-upgrade.sha256
rtk proxy apt-get purge -y practice-institute-desktop > /results/apt-uninstall.log 2>&1
[[ -f /home/owner/.local/share/practice-institute/data/practice-institute.sqlite3 ]]
[[ -d /home/owner/.config/practice-institute ]]
rtk proxy sha256sum -c /results/profile-before-upgrade.sha256
echo 'Ubuntu real apt install/0.1.0-to-0.1.1 upgrade/purge preserved owner data and config PASS; installed packaged browser suite PASS. OS sandbox remains unverified.'
