# lib-conf.sh — pure helpers for the Asterisk config files (no side effects; tests: test/conf-test.sh).
# Sourced by install.sh and status.sh.

MARK_BEGIN='==== OPERATOR-BAHO BOSHI ===='
MARK_END='==== OPERATOR-BAHO OXIRI ===='

# Queue names defined by IssabelPBX (queues_additional.conf categories), one per line.
list_queues() {
  [ -f "$1" ] || return 0
  sed -nE 's/^\[([^]]+)\].*$/\1/p' "$1" | grep -vx 'general' | sort -u
}

# The failover destination IssabelPBX generated for queue $2 in extensions_additional.conf ($1), as
# "context^exten^priority" — the branch ext-queues takes when VQ_DEST/QDEST is empty, e.g.
#   exten => 2020159,n,GotoIf($["${QDEST}" = ""]?ivr-4,s,1:${CUT(QDEST,^,1)},...)
# Prints nothing when the line is not found or does not look like a plain destination.
detect_failover() {
  local f=$1 q=$2 dest
  [ -f "$f" ] || return 0
  dest=$(sed -nE "s/^exten => ${q},n,GotoIf\(\\\$\[\"\\\$\{(QDEST|VQ_DEST)\}\" *= *\"\"\]\?([^:)]+).*/\2/p" "$f" | head -1)
  dest=$(printf '%s' "$dest" | tr -d ' ' | tr ',' '^')
  valid_dest "$dest" && printf '%s\n' "$dest"
}

# "context^exten^priority" with plain names only (no ${...}, no commas).
valid_dest() {
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9_-]+\^[A-Za-z0-9_+*#.-]+\^[A-Za-z0-9_-]+$' || return 1
  case "$1" in operator-baho^*) return 1 ;; esac
}

# Lines of our block in a file (0 when absent).
block_lines() {
  [ -f "$1" ] || { echo 0; return; }
  sed -n "/$MARK_BEGIN/,/$MARK_END/p" "$1" | wc -l | tr -d ' '
}

# replace_block DST PART: drop an earlier OPERATOR-BAHO block from DST (if any) and append PART.
# Keeps DST's inode, owner and mode; prints "added", "updated" or "unchanged". Re-running is a no-op.
replace_block() {
  local dst=$1 part=$2 tmp had=0
  tmp=$(mktemp)
  if [ -f "$dst" ]; then
    [ "$(block_lines "$dst")" -gt 0 ] && had=1
    sed "/$MARK_BEGIN/,/$MARK_END/d" "$dst" > "$tmp"
    # one blank line between the previous content and our block (not one more per re-run)
    if [ -s "$tmp" ] && [ -n "$(tail -n 1 "$tmp")" ]; then echo >> "$tmp"; fi
  fi
  cat "$part" >> "$tmp"
  if [ -f "$dst" ] && cmp -s "$tmp" "$dst"; then
    rm -f "$tmp"; echo unchanged; return 0
  fi
  if [ -f "$dst" ]; then cat "$tmp" > "$dst"; else cp "$tmp" "$dst"; fi
  rm -f "$tmp"
  if [ "$had" = 1 ]; then echo updated; else echo added; fi
}

# remove_block DST: delete our block (rollback). Prints "removed" or "absent".
remove_block() {
  local dst=$1 tmp
  [ "$(block_lines "$dst")" -gt 0 ] || { echo absent; return 0; }
  tmp=$(mktemp)
  sed "/$MARK_BEGIN/,/$MARK_END/d" "$dst" > "$tmp"
  cat "$tmp" > "$dst"
  rm -f "$tmp"
  echo removed
}

# Mask password hashes / auth strings in SHOW GRANTS output (stdin → stdout):
#   IDENTIFIED BY PASSWORD '*AB12…'  ->  IDENTIFIED BY PASSWORD '***'   (also IDENTIFIED VIA … USING '…')
mask_secrets() {
  sed -E "s/(PASSWORD|USING|BY) +'[^']*'/\1 '***'/g"
}
