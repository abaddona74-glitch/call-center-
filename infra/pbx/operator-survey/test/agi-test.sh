#!/bin/bash
# Runs test/agi-test.php in the official PHP 5.6 image (the oldest one Docker still pulls; the PBX has PHP 5.4 on CentOS 7 — keep the AGI to 5.4 syntax) against a MariaDB that has
# asteriskcdrdb.operator_baho, e.g. a throwaway copy of the dev PBX DB (infra/dev-pbx/mariadb-init creates the table).
# Never point it at the real PBX. Usage (from the repo root):
#   TEST_DB_HOST=host.docker.internal TEST_DB_PORT=33061 TEST_USER=baho_writer TEST_PASS=... \
#     bash infra/pbx/operator-survey/test/agi-test.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
docker run --rm --platform linux/amd64 --add-host=host.docker.internal:host-gateway \
  -v "$HERE:/s:ro" \
  -e TEST_DSN="mysql:host=${TEST_DB_HOST:-host.docker.internal};port=${TEST_DB_PORT:-33061};dbname=asteriskcdrdb;charset=utf8" \
  -e TEST_USER -e TEST_PASS \
  php:5.6-cli bash -c '
    set -e
    docker-php-ext-install pdo_mysql >/dev/null 2>&1
    php -l /s/agi-bin/operator_baho.php
    printf "AMPDBHOST=%s\nAMPDBUSER=%s\nAMPDBPASS=%s\n" "'"${TEST_DB_HOST:-host.docker.internal}"';port='"${TEST_DB_PORT:-33061}"'" "$TEST_USER" "$TEST_PASS" > /tmp/amportal.conf
    export BAHO_AMPORTAL=/tmp/amportal.conf BAHO_LOG=/tmp/operator_baho.log BAHO_QUEUE_LOG=/tmp/queue_log
    php /s/test/agi-test.php
    echo "--- AGI log"; cat /tmp/operator_baho.log'
