#!/usr/bin/perl
# AridMap — local service for macOS (same job as tools/admin_server.ps1 on Windows). Uses only the Perl built into macOS.
#  - Serves the map files at http://localhost:47613/ (this computer only).
#  - Saves the admin store to data/admin/admin_store.json + admin_store.js (atomic write), keeps a backup of every
#    previous version in data/admin/backups/ (last 300 + first copy of each day), appends operations to data/admin/audit_log.jsonl.
#  - Never writes plan files or data/sales_status.csv. Started by start_mac.command.
use strict; use warnings;
use IO::Socket::INET; use File::Copy qw(copy); use File::Basename qw(dirname); use Cwd qw(abs_path); use POSIX qw(strftime);
use Time::HiRes qw(time);
use JSON::PP (); use Digest::SHA qw(hmac_sha256); use MIME::Base64 qw(encode_base64 decode_base64);

my $PORT = 47613;
my $root = abs_path(dirname(abs_path($0)) . '/..');
my $admin = "$root/data/admin"; my $backups = "$admin/backups";
my ($storeJson, $storeJs, $revFile, $auditFile, $logFile) = map { "$admin/$_" } qw(admin_store.json admin_store.js admin_store.rev audit_log.jsonl service_log.txt);
my ($authJson, $authJs, $settingsJson, $settingsJs) = map { "$admin/$_" } qw(admin_auth.json admin_auth.js settings.json settings.js);
mkdir $admin; mkdir $backups;
(my $rootJson = $root) =~ s/(["\\])/\\$1/g;

sub logm { if (open(my $f, '>>:raw', $logFile)) { print $f strftime('%Y-%m-%d %H:%M:%S', localtime) . "  $_[0]\n"; close $f } }
sub stamp { my $t = time; strftime('%Y%m%d-%H%M%S', localtime($t)) . sprintf('-%03d', ($t - int($t)) * 1000) }
sub slurp { my $p = shift; open(my $f, '<:raw', $p) or return undef; local $/; my $d = <$f>; close $f; $d }
sub spit { my ($p, $d) = @_; open(my $f, '>:raw', "$p.tmp") or die "write $p: $!"; print $f $d; close $f; rename("$p.tmp", $p) or die "rename $p: $!" }
sub cur_rev { my $t = slurp($revFile); return (defined $t && $t =~ /(\d+)/) ? $1 : 0 }

# one-time safety copies
my $baseCsv = "$root/data/sales_status.csv"; my $baseBak = "$backups/baseline_sales_status_before_v1_14.csv";
copy($baseCsv, $baseBak) if -f $baseCsv && !-f $baseBak;
copy($storeJson, "$backups/startup_" . stamp() . ".json") if -f $storeJson;
my @st = sort { $b cmp $a } glob("$backups/startup_*.json"); unlink @st[60 .. $#st] if @st > 60;

my %MIME = (html => 'text/html; charset=utf-8', js => 'text/javascript; charset=utf-8', css => 'text/css; charset=utf-8', json => 'application/json; charset=utf-8',
  csv => 'text/csv; charset=utf-8', svg => 'image/svg+xml', png => 'image/png', jpg => 'image/jpeg', jpeg => 'image/jpeg', webp => 'image/webp',
  woff2 => 'font/woff2', txt => 'text/plain; charset=utf-8', md => 'text/plain; charset=utf-8', pbf => 'application/x-protobuf', ico => 'image/x-icon');

my $srv;
for (1 .. 10) { $srv = IO::Socket::INET->new(LocalAddr => '127.0.0.1', LocalPort => $PORT, Proto => 'tcp', Listen => 64, ReuseAddr => 1) and last; select(undef, undef, undef, 0.5) }
unless ($srv) { logm("could not start on port $PORT: $!"); exit 1 }
logm("service started on http://localhost:$PORT/ (root $root, disk rev " . cur_rev() . ")");
$SIG{PIPE} = 'IGNORE';

sub respond {
  my ($c, $code, $type, $body, $extra) = @_;
  my %txt = (200 => 'OK', 304 => 'Not Modified', 400 => 'Bad Request', 401 => 'Unauthorized', 403 => 'Forbidden', 404 => 'Not Found', 405 => 'Method Not Allowed', 409 => 'Conflict', 429 => 'Too Many Requests', 500 => 'Server Error');
  $body = '' unless defined $body;
  print $c "HTTP/1.1 $code $txt{$code}\r\nContent-Type: $type\r\nContent-Length: " . length($body) . "\r\nConnection: close\r\n" . ($extra || "Cache-Control: no-store\r\n") . "\r\n" . $body;
}
sub json { respond($_[0], $_[1], 'application/json; charset=utf-8', $_[2]) }

# ---------------- v1.25: admin password (salted PBKDF2-SHA256; the password itself is never stored) ----------------
my %sessions; my $fails = 0; my $lockUntil = 0; my $SESSION_HOURS = 12;
sub rand_bytes { my $n = shift; my $b = '';
  if (open(my $r, '<:raw', '/dev/urandom')) { read($r, $b, $n); close $r }
  $b .= chr(int(rand(256))) while length($b) < $n; return $b }
sub pbkdf2 { my ($pw, $salt, $iter) = @_; utf8::encode($pw) if utf8::is_utf8($pw);
  my $u = hmac_sha256($salt . pack('N', 1), $pw); my $t = $u;
  for (2 .. $iter) { $u = hmac_sha256($u, $pw); $t ^= $u } return $t }
sub same_bytes { my ($a, $b) = @_; return 0 unless length($a) == length($b); my $d = 0; $d |= ord(substr($a, $_, 1)) ^ ord(substr($b, $_, 1)) for 0 .. length($a) - 1; return $d == 0 }
sub read_auth { my $t = slurp($authJson); return undef unless defined $t; my $o = eval { JSON::PP->new->decode($t) };
  return ($o && ($o->{algo} // '') eq 'pbkdf2-sha256' && $o->{salt} && $o->{hash} && ($o->{iter} // 0) >= 10000) ? $o : undef }
sub check_password { my $pw = shift; my $a = read_auth() or return 0;
  return same_bytes(pbkdf2($pw, decode_base64($a->{salt}), $a->{iter}), decode_base64($a->{hash})) }
sub write_auth { my $pw = shift; my $salt = rand_bytes(16); my $iter = 150000; my $k = pbkdf2($pw, $salt, $iter);
  my $json = '{"schema":"aridmap-admin-auth","algo":"pbkdf2-sha256","iter":' . $iter . ',"salt":"' . encode_base64($salt, '') . '","hash":"' . encode_base64($k, '') . '","changedAt":"' . strftime('%Y-%m-%dT%H:%M:%SZ', gmtime) . '","default":false}';
  copy($authJson, "$backups/admin_auth_" . stamp() . ".json") if -f $authJson;
  spit($authJson, $json);
  spit($authJs, "/* written by tools/admin_server.pl — admin password as a salted PBKDF2-SHA256 hash (the password itself is not stored). Do not edit by hand. */\nwindow.ADMIN_AUTH = $json;\n") }
sub token_ok { my $t = shift // ''; return 0 unless $t ne '' && exists $sessions{$t}; if ($sessions{$t} < time) { delete $sessions{$t}; return 0 } return 1 }
sub json_body { my $b = shift; my $o = eval { JSON::PP->new->utf8->decode($b) }; return ref($o) eq 'HASH' ? $o : undef }
sub throttled { my $c = shift; if (time < $lockUntil) { my $w = int($lockUntil - time) + 1; json($c, 429, qq({"ok":false,"error":"wait","wait":$w})); return 1 } return 0 }
sub bad_password { my $c = shift; $fails++; if ($fails >= 5) { $lockUntil = time + 30; $fails = 0; logm('admin login: 5 wrong passwords, locked for 30 s') } json($c, 401, '{"ok":false,"error":"password"}') }
sub login { my ($c, $body) = @_; return if throttled($c);
  my $b = json_body($body); my $pw = $b ? ($b->{password} // '') : '';
  return bad_password($c) unless check_password($pw);
  $fails = 0; my $t = unpack('H*', rand_bytes(32)); $sessions{$t} = time + $SESSION_HOURS * 3600; logm('admin login');
  my $a = read_auth(); my $def = ($a && $a->{default} && "$a->{default}" ne '0') ? 'true' : 'false';
  json($c, 200, qq({"ok":true,"token":"$t","hours":$SESSION_HOURS,"default":$def})) }
sub change_password { my ($c, $body, $tok) = @_; return if throttled($c);
  my $b = json_body($body) or return json($c, 400, '{"ok":false,"error":"invalid"}');
  my $new = $b->{new} // ''; my $len = length($new);
  return json($c, 400, '{"ok":false,"error":"length"}') if $len < 4 || $len > 64;
  return bad_password($c) unless check_password($b->{current} // '');
  write_auth($new); %sessions = map { $_ => $sessions{$_} } grep { $_ eq $tok } keys %sessions; logm('admin password changed');
  json($c, 200, '{"ok":true}') }
sub save_settings { my ($c, $body) = @_; my $b = json_body($body) or return json($c, 400, '{"ok":false,"error":"invalid"}');
  my $key = $b->{esri_api_key} // ''; $key =~ s/^\s+|\s+$//g;
  return json($c, 400, '{"ok":false,"error":"key"}') unless $key =~ /^[A-Za-z0-9_\-\.]{0,400}$/;
  my $json = '{"esri_api_key":"' . $key . '","savedAt":"' . strftime('%Y-%m-%dT%H:%M:%SZ', gmtime) . '"}';
  spit($settingsJson, $json); spit($settingsJs, "/* written by tools/admin_server.pl — settings saved from the admin panel. Do not edit by hand. */\nwindow.ADMIN_SETTINGS = $json;\n");
  logm('settings saved'); json($c, 200, '{"ok":true}') }

sub ensure_auth { return if -f $authJson; my $d = slurp(dirname(abs_path($0)) . '/admin_auth_default.json'); return unless defined $d; $d =~ s/\s+$//;
  spit($authJson, $d); spit($authJs, "/* written by tools/admin_server.pl — admin password as a salted PBKDF2-SHA256 hash (the password itself is not stored). Do not edit by hand. */\nwindow.ADMIN_AUTH = $d;\n");
  logm('admin password file created with the default password') }
ensure_auth();

sub save {
  my ($c, $q, $body) = @_;
  my ($rev) = ($q =~ /(?:^|&)rev=(\d+)/); my ($base) = ($q =~ /(?:^|&)base=(\d+)/);
  return json($c, 400, '{"ok":false,"error":"invalid store"}') unless $body =~ /^\{/ && substr($body, 0, 300) =~ /"schema":"aridmap-admin-store"/ && $body =~ /\}\s*$/;
  my $cur = cur_rev();
  if (!defined $base || $base != $cur) { logm("save refused: base " . ($base // '?') . " <> disk $cur"); return json($c, 409, qq({"ok":false,"error":"conflict","rev":$cur})) }
  return json($c, 400, '{"ok":false,"error":"rev must increase"}') unless defined $rev && $rev > $cur;
  if (-f $storeJson) {
    copy($storeJson, "$backups/admin_store_" . stamp() . "_rev$cur.json");
    my $day = "$backups/daily_" . strftime('%Y-%m-%d', localtime) . ".json"; copy($storeJson, $day) unless -f $day;
    my @b = sort { $b cmp $a } glob("$backups/admin_store_*.json"); unlink @b[300 .. $#b] if @b > 300;
  }
  spit($storeJson, $body);
  spit($storeJs, "/* written by tools/admin_server.pl — do not edit by hand; a backup of every version is in data/admin/backups/ */\nwindow.ADMIN_STORE_DISK = $body;\n");
  spit($revFile, $rev);
  logm("saved rev $rev (" . length($body) . " bytes)");
  json($c, 200, qq({"ok":true,"rev":$rev}));
}

sub static {
  my ($c, $path, $hdr, $head) = @_;
  $path =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge; $path = '/index.html' if $path eq '/';
  return respond($c, 404, 'text/plain', 'not found') if $path =~ /\.\./ || $path =~ /\0/;
  return respond($c, 403, 'text/plain', 'forbidden') if $path =~ m{^/data/admin/(admin_auth\.|admin_store\.rev|service_log|audit_log|backups/)}i;   # v1.25: password hash and logs are not served
  my $full = $root . $path;
  return respond($c, 404, 'text/plain', 'not found') unless -f $full;
  my ($ext) = ($full =~ /\.([^.\/]+)$/); my $type = $MIME{lc($ext // '')} || 'application/octet-stream';
  my $mtime = (stat $full)[9]; my $lm = strftime('%a, %d %b %Y %H:%M:%S GMT', gmtime $mtime);
  my $cache = "Cache-Control: no-cache\r\nLast-Modified: $lm\r\n";
  if (($hdr->{'if-modified-since'} // '') eq $lm && $path !~ m{^/data/admin/}) { print $c "HTTP/1.1 304 Not Modified\r\nConnection: close\r\n$cache\r\n"; return }
  my $data = slurp($full); return respond($c, 500, 'text/plain', 'read error') unless defined $data;
  respond($c, 200, $type, $head ? '' : $data, $path =~ m{^/data/admin/} ? undef : $cache);
}

while (my $c = $srv->accept) {
  eval {
    binmode $c; $c->autoflush(1);
    local $SIG{ALRM} = sub { die "timeout\n" }; alarm 20;
    my $line = <$c>; die "empty\n" unless defined $line;
    my ($m, $uri) = $line =~ /^(\w+)\s+(\S+)/; die "bad request\n" unless $m;
    my %h; while (my $l = <$c>) { $l =~ s/\r?\n$//; last if $l eq ''; my ($k, $v) = split /:\s*/, $l, 2; $h{lc $k} = $v // '' }
    my $body = ''; my $len = $h{'content-length'} || 0; while (length($body) < $len) { my $r = read($c, $body, $len - length($body), length($body)); last unless $r }
    my ($path, $q) = split /\?/, $uri, 2; $q //= '';
    my $host = $h{host} // ''; $host =~ s/:\d+$//;
    if ($host ne 'localhost' && $host ne '127.0.0.1') { respond($c, 403, 'text/plain', 'forbidden') }
    elsif ($path eq '/__admin/ping') { json($c, 200, '{"ok":true,"service":"aridmap-admin","auth":true,"rev":' . cur_rev() . ',"root":"' . $rootJson . '"}') }
    elsif ($m eq 'POST' && $path =~ m{^/__admin/}) {
      my $o = $h{origin} // ''; my $tok = $h{'x-admin-token'} // '';
      if ($o ne '' && $o ne "http://localhost:$PORT" && $o ne "http://127.0.0.1:$PORT") { json($c, 403, '{"ok":false,"error":"origin"}') }
      elsif ($path eq '/__admin/login') { login($c, $body) }
      elsif ($path eq '/__admin/logout') { if (exists $sessions{$tok}) { delete $sessions{$tok}; logm('admin locked') } json($c, 200, '{"ok":true}') }
      elsif ($path eq '/__admin/password') { if (token_ok($tok)) { change_password($c, $body, $tok) } else { json($c, 401, '{"ok":false,"error":"login"}') } }
      elsif (!token_ok($tok)) { json($c, 401, '{"ok":false,"error":"login"}') }   # v1.25: no write without an admin session
      elsif ($path eq '/__admin/settings') { save_settings($c, $body) }
      elsif ($path eq '/__admin/save') { save($c, $q, $body) }
      elsif ($path ne '/__admin/audit') { respond($c, 404, 'text/plain', 'not found') }
      else {
        my @l = grep { /^\s*\{/ } split /\n/, $body;
        if (@l && open(my $f, '>>:raw', $auditFile)) { print $f join("\n", @l) . "\n"; close $f }
        json($c, 200, '{"ok":true}');
      }
    }
    elsif ($m eq 'GET' || $m eq 'HEAD') { static($c, $path, \%h, $m eq 'HEAD') }
    else { respond($c, 405, 'text/plain', 'method not allowed') }
    alarm 0;
  };
  if ($@ && $@ !~ /^(empty|timeout)/) { logm("request error: $@") }
  close $c;
}
