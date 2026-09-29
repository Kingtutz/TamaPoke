#!/usr/bin/env bash
# Ejecuta toda la bateria de tests (logica del firmware + herramientas).
#   ./test/run_tests.sh          normal
#   ./test/run_tests.sh --asan   ademas con AddressSanitizer + UBSan
set -uo pipefail
cd "$(dirname "$0")"

fail=0

# python3 en Linux/macOS; en Windows "python3" suele ser el acceso directo de la
# Microsoft Store (no ejecuta nada), asi que se usa el primero que funcione
if python3 -c "" >/dev/null 2>&1; then PY=python3; else PY=python; fi

echo "== logica del firmware (pet.cpp / i18n.cpp / dex.h) =="
make --no-print-directory run || fail=1

if [[ "${1:-}" == "--asan" ]]; then
  echo
  echo "== la misma bateria con AddressSanitizer + UBSan =="
  make --no-print-directory asan || fail=1
fi

echo
echo "== herramientas y ficheros generados (tools/) =="
"$PY" test_tools.py || fail=1

echo
if [[ $fail -eq 0 ]]; then
  echo "TODO OK"
else
  echo "HAY FALLOS"
fi
exit $fail
