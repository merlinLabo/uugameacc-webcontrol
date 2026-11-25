#!/usr/bin/env bash
set -euo pipefail

bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
target_dir=/data/uuplugin-webcontrol
unit=/etc/systemd/system/uu-control.service
portal=/usr/share/unifi-core/app/node_modules/@ubnt/unifi-portal/dist/local/index.html
nginx_defaults=/usr/share/unifi-core/http/shared-server-defaults.conf
mode=${1:---uninstall}

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ $mode == --check || $mode == --uninstall ]] || fail 'Usage: bash uninstall.sh [--check|--uninstall]'
[[ $EUID -eq 0 ]] || fail 'Run as root on the UniFi OS gateway'
command -v node24 >/dev/null || fail 'Missing command: node24'
[[ -f $bundle_dir/portal_hooks.js ]] || fail 'Missing portal_hooks.js'
[[ -f $target_dir/.installed-by-uuplugin-webcontrol && ! -L $target_dir ]] || fail 'Webcontrol install marker not found'
[[ -f $unit && ! -L $unit ]] || fail 'UU control service not found'
grep -Fqx 'ExecStart=/usr/bin/node24 /data/uuplugin-webcontrol/uu-control.js' "$unit" || \
grep -Fqx 'ExecStart=/usr/bin/perl /data/uuplugin-webcontrol/uu-control.pl' "$unit" || \
grep -Fqx 'ExecStart=/usr/bin/python3 /data/uuplugin-webcontrol/uu-control.py' "$unit" || \
    fail 'uu-control.service does not belong to this webcontrol installation'
for file in "$portal" "$nginx_defaults"; do
    [[ -f $file && ! -L $file ]] || fail "Missing or symlinked UniFi file: $file"
done
if [[ $mode == --check ]]; then
    printf 'Webcontrol installation found; original UU program and service will be kept.\n'
    exit 0
fi

backup=$(mktemp -d /tmp/uu-webcontrol-uninstall.XXXXXXXX)
begun=0
committed=0
was_active=0
was_enabled=0

cleanup() {
    result=$?
    trap - EXIT
    if [[ $begun -eq 1 && $committed -eq 0 ]]; then
        printf 'Uninstall failed; restoring webcontrol files and UniFi hooks.\n' >&2
        cp -a "$backup/portal" "$portal" || true
        cp -a "$backup/nginx-defaults" "$nginx_defaults" || true
        if [[ ! -e $target_dir ]]; then cp -a "$backup/target" "$target_dir"; fi
        cp -a "$backup/unit" "$unit" || true
        systemctl daemon-reload || true
        if [[ $was_enabled -eq 1 ]]; then systemctl enable uu-control.service >/dev/null 2>&1 || true; fi
        if [[ $was_active -eq 1 ]]; then systemctl start uu-control.service || true; fi
        nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
    fi
    rm -rf -- "$backup"
    exit "$result"
}
trap cleanup EXIT

cp -a "$portal" "$backup/portal"
cp -a "$nginx_defaults" "$backup/nginx-defaults"
cp -a "$target_dir" "$backup/target"
cp -a "$unit" "$backup/unit"
systemctl is-active --quiet uu-control.service && was_active=1 || true
systemctl is-enabled --quiet uu-control.service && was_enabled=1 || true
begun=1

node24 "$bundle_dir/portal_hooks.js" uninstall
nginx -t
systemctl disable --now uu-control.service
rm -f -- "$unit"
systemctl daemon-reload
systemctl reload nginx
rm -rf -- "$target_dir"
committed=1
printf 'UU GameAcc webcontrol removed. Original uuplugin.service and /data/uuplugin were not changed.\n'
