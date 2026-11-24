#!/bin/bash
# Installs the RPMail Proton helper on this Mac as the LaunchAgent com.trae.rpmail-relay (starts at login, restarts if it stops).
# Needs: Proton Bridge running, ~/rps-inbox/config.json (the local RPMail's Proton accounts), and the Keychain item
# service "rpmail-relay", account "secret" (the same value as RPMAIL_RELAY_SECRET on the website).
set -e
DIR="$HOME/rpmail-relay"
mkdir -p "$DIR"
cp "$(dirname "$0")/relay.py" "$DIR/relay.py"
PLIST="$HOME/Library/LaunchAgents/com.trae.rpmail-relay.plist"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.trae.rpmail-relay</string>
  <key>ProgramArguments</key><array><string>/usr/bin/python3</string><string>-I</string><string>$DIR/relay.py</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$DIR/stdout.log</string>
  <key>StandardErrorPath</key><string>$DIR/stderr.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/com.trae.rpmail-relay" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed: $DIR/relay.py, LaunchAgent com.trae.rpmail-relay"
