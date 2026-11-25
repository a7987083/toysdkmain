#!/bin/sh
set -eu
doctor=${1:?pass pinned toy_doctor.py}
digest=cbbf1244fff1179cfa48272cddb2cbcbd870da73d5fff1c5f30720231d6eeb0c
printf '%s  %s\n' "$digest" "$doctor" | sha256sum -c -
for artifact in dist/ToyGameKit-SDK-Test-Lab.zip dist/sdk-consumer dist/vite-consumer; do
  python3 "$doctor" "$artifact"
done
