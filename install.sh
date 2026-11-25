#!/usr/bin/env bash
set -euo pipefail

bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
payload_dir=$bundle_dir/payload
target_dir=/data/uuplugin-webcontrol
unit=/etc/systemd/system/uu-control.service
portal=/usr/share/unifi-core/app/node_modules/@ubnt/unifi-portal/dist/local/index.html
nginx_defaults=/usr/share/unifi-core/http/shared-server-defaults.conf
marker=$target_dir/.installed-by-uuplugin-webcontrol
mode=${1:---install}

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ $mode == --check || $mode == --install ]] || fail 'Usage: bash install.sh [--check|--install]'
[[ $EUID -eq 0 ]] || fail 'Run as root on the UniFi OS gateway'
[[ -d /usr/share/unifi-core ]] || fail 'UniFi OS core files not found'
[[ -d $payload_dir && -f $bundle_dir/portal_hooks.js ]] || fail 'Incomplete webcontrol bundle'
for cmd in node24 systemctl nginx install cp mktemp; do
    command -v "$cmd" >/dev/null || fail "Missing command: $cmd"
done
for file in uu-control.js uu-control.service uu-gameacc.js uu-gameacc.nginx.conf games.svg; do
    [[ -f $payload_dir/$file && ! -L $payload_dir/$file ]] || fail "Missing or symlinked payload: $file"
done
for file in /usr/share/unifi-core/http/security.conf /usr/share/unifi-core/http/auth.conf /usr/share/unifi-core/http/proxy.conf; do
    [[ -f $file ]] || fail "Missing UniFi Nginx include: $file"
done
[[ -f $portal && -f $nginx_defaults ]] || fail 'UniFi portal or Nginx defaults not found'
[[ ! -L $target_dir && ! -L $unit ]] || fail 'Webcontrol directory or unit is a symlink'
[[ ! -e $target_dir || -f $marker || $bundle_dir == "$target_dir" ]] || \
    fail "$target_dir exists but is not this installer's directory"
if [[ -e $unit ]]; then
    grep -Fqx 'ExecStart=/usr/bin/node24 /data/uuplugin-webcontrol/uu-control.js' "$unit" || \
    grep -Fqx 'ExecStart=/usr/bin/perl /data/uuplugin-webcontrol/uu-control.pl' "$unit" || \
    grep -Fqx 'ExecStart=/usr/bin/python3 /data/uuplugin-webcontrol/uu-control.py' "$unit" || \
        fail 'Existing uu-control.service belongs to another installation'
fi
systemctl cat uuplugin.service >/dev/null 2>&1 || fail 'Install the original uuplugin.service first'
node24 --check "$bundle_dir/portal_hooks.js"
node24 --check "$payload_dir/uu-control.js"
node24 "$bundle_dir/portal_hooks.js" check
nginx -t >/dev/null 2>&1 || fail 'Existing Nginx configuration is invalid'

if [[ $mode == --check ]]; then
    printf 'Ready: UniFi OS portal, Nginx, original UU service, and webcontrol bundle checked.\n'
    exit 0
fi

backup=$(mktemp -d /tmp/uu-webcontrol-install.XXXXXXXX)
begun=0
committed=0
had_target=0
had_unit=0
was_active=0
was_enabled=0

cleanup() {
    result=$?
    trap - EXIT
    if [[ $begun -eq 1 && $committed -eq 0 ]]; then
        printf 'Install failed; restoring previous webcontrol files and UniFi hooks.\n' >&2
        systemctl disable --now uu-control.service >/dev/null 2>&1 || true
        cp -a "$backup/portal" "$portal" || true
        cp -a "$backup/nginx-defaults" "$nginx_defaults" || true
        rm -rf -- "$target_dir"
        if [[ $had_target -eq 1 ]]; then cp -a "$backup/target" "$target_dir"; fi
        rm -f -- "$unit"
        if [[ $had_unit -eq 1 ]]; then cp -a "$backup/unit" "$unit"; fi
        systemctl daemon-reload || true
        if [[ $had_unit -eq 1 ]]; then
            if [[ $was_enabled -eq 1 ]]; then systemctl enable uu-control.service >/dev/null 2>&1 || true; fi
            if [[ $was_active -eq 1 ]]; then systemctl start uu-control.service || true; fi
        fi
        nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
    fi
    rm -rf -- "$backup"
    exit "$result"
}
trap cleanup EXIT

cp -a "$portal" "$backup/portal"
cp -a "$nginx_defaults" "$backup/nginx-defaults"
if [[ -e $target_dir ]]; then cp -a "$target_dir" "$backup/target"; had_target=1; fi
if [[ -e $unit ]]; then
    cp -a "$unit" "$backup/unit"
    had_unit=1
    systemctl is-active --quiet uu-control.service && was_active=1 || true
    systemctl is-enabled --quiet uu-control.service && was_enabled=1 || true
fi
begun=1

install -d -m 0755 "$target_dir"
if [[ $bundle_dir != "$target_dir" ]]; then
    cp -a "$bundle_dir/." "$target_dir/"
fi
for file in uu-control.js uu-gameacc.js uu-gameacc.nginx.conf games.svg; do
    install -m 0644 "$payload_dir/$file" "$target_dir/$file"
done
if [[ -f $marker ]]; then
    rm -f -- "$target_dir/uu-game-booster.js" "$target_dir/uu-game-booster.nginx.conf" \
        "$target_dir/payload/uu-game-booster.js" "$target_dir/payload/uu-game-booster.nginx.conf" \
        "$target_dir/uu-control.py" "$target_dir/payload/uu-control.py" "$target_dir/portal_hooks.py"
    rm -f -- "$target_dir/uu-control.pl" "$target_dir/payload/uu-control.pl" \
        "$target_dir/portal_hooks.pl"
fi
install -m 0644 "$payload_dir/uu-control.service" "$unit"
: > "$marker"
chmod 0644 "$marker"
node24 "$bundle_dir/portal_hooks.js" install
nginx -t
systemctl daemon-reload
systemctl reload nginx
systemctl enable uu-control.service
systemctl restart uu-control.service
systemctl is-active --quiet uu-control.service || fail 'UU control API did not start'
committed=1
printf 'UU GameAcc webcontrol installed. Original uuplugin.service and /data/uuplugin were not changed.\n'
printf 'Open UniFi Network > Settings > UU GameAcc.\n'
