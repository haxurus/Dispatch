#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi

command -v iptables >/dev/null 2>&1 || { echo "iptables is required" >&2; exit 1; }

add_input_drop() {
  iface="$1"
  iptables -C INPUT -i "$iface" -j DROP 2>/dev/null || iptables -I INPUT 1 -i "$iface" -j DROP
}

add_forward_drop() {
  iface="$1"
  cidr="$2"
  iptables -C DOCKER-USER -i "$iface" -d "$cidr" -j REJECT 2>/dev/null || iptables -I DOCKER-USER 1 -i "$iface" -d "$cidr" -j REJECT
}

for iface in dispatch-api-eg dispatch-bot-eg; do
  add_input_drop "$iface"
  for cidr in 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 240.0.0.0/4; do
    add_forward_drop "$iface" "$cidr"
  done
done

echo "Dispatch container-to-host/private-network blocking rules installed."
