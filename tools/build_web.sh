#!/bin/bash
# Regenera web/firmware/tamapoke.bin (firmware combinado) para el instalador web.
# Uso: bash tools/build_web.sh
set -e
cd "$(dirname "$0")/.."
FQBN="esp32:esp32:esp32s3:CDCOnBoot=cdc,FlashSize=16M,PSRAM=opi,PartitionScheme=app3M_fat9M_16MB"

# python3 en Linux/macOS; en Windows "python3" suele ser el acceso directo de la
# Microsoft Store (no ejecuta nada), asi que se usa el primero que funcione
if python3 -c "" >/dev/null 2>&1; then PY=python3; else PY=python; fi

echo "Compilando..."
arduino-cli compile --fqbn "$FQBN" --export-binaries .

B=build/esp32.esp32.esp32s3
echo "Fusionando binarios..."
"$PY" -m esptool --chip esp32s3 merge-bin -o web/firmware/tamapoke.bin \
  0x0     "$B/TamaPoke.ino.bootloader.bin" \
  0x8000  "$B/TamaPoke.ino.partitions.bin" \
  0xe000  "$B/boot_app0.bin" \
  0x10000 "$B/TamaPoke.ino.bin"

echo "OK -> web/firmware/tamapoke.bin ($(du -h web/firmware/tamapoke.bin | cut -f1))"

echo "Empaquetando sprites..."
"$PY" tools/pack_bundle.py
